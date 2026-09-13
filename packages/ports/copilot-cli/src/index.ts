import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  applyOff,
  applyOn,
  applyReplan,
  applyResume,
  applyResumeReview,
  applyRun,
  applyTrackPick,
  ensureAmbientReviewSession,
  effectiveReviewingItemId,
  firstUnchecked,
  isChannelANeedPick,
  isHarnessFollowupMessage,
  isProductCodeEdit,
  isRecoverOrStuckFollowupMessage,
  isSafeTrackSlug,
  isUserAbortText,
  loadProjectHookConfig,
  loadProjectReviewConfig,
  notePlansDirEdit,
  parseAdvanceNextItemId,
  parseChecklist,
  parseTrigger,
  type FollowupAction,
  type PhaseActionConfig,
  type ReviewEngine,
  type StateStore,
} from "@autopilot-harness/core";

/** Copilot CLI userPromptSubmitted stdin (camelCase + VS Code compat). */
export interface CopilotSubmitPayload {
  session_id?: string;
  sessionId?: string;
  prompt?: string;
  /** Informational — store uses install-root projectRoot. */
  cwd?: string;
  transcript_path?: string;
  transcriptPath?: string;
  conversation_id?: string;
  conversationId?: string;
  permission_mode?: string;
  permissionMode?: string;
  turn_id?: string;
  model?: string;
  hook_event_name?: string;
  hookEventName?: string;
  timestamp?: number | string;
}

/** Copilot CLI userPromptTransformed stdin. */
export interface CopilotTransformPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  prompt?: string;
  transformedPrompt?: string;
  hook_event_name?: string;
  hookEventName?: string;
  timestamp?: number | string;
}

/** Copilot CLI postToolUse stdin (edit / create / …). */
export interface CopilotEditPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown> | string;
  toolInput?: Record<string, unknown> | string;
  toolArgs?: Record<string, unknown> | string;
}

/** Copilot CLI agentStop / Stop stdin. */
export interface CopilotStopPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  transcript_path?: string;
  transcriptPath?: string;
  status?: string;
  stop_hook_active?: boolean;
  stopHookActive?: boolean;
  stop_reason?: string;
  stopReason?: string;
  hook_event_name?: string;
  hookEventName?: string;
  last_assistant_message?: string;
  turn_id?: string;
  error?: unknown;
  message?: unknown;
  reason?: unknown;
  timestamp?: number | string;
}

export interface CopilotPortConfig {
  phaseActions?: PhaseActionConfig;
}

export const COPILOT_PLATFORM = "copilot-cli";

/**
 * Public research (2026-09): no documented raise/disable for ~8 consecutive
 * agentStop blocks. Ports must not claim unlimited Stop-continue.
 */
export const COPILOT_STOP_CAP_RAISE_FOUND = false;
/** Host runaway guard (CLI ≥1.0.72) when raise is absent. */
export const COPILOT_STOP_CONSECUTIVE_BLOCK_CAP = 8;

/** PostToolUse matcher for init (runtime toolName; camelCase hooks). */
export const COPILOT_POST_TOOL_USE_MATCHER = "edit|create";

export const MAX_NEED_PICK_SLUGS = 40;
export const MAX_NEED_PICK_CONTEXT_CHARS = 2_000;
export const MAX_HOOK_STDIO_CHARS = 8_192;
/** Bound hostile/huge toolArgs JSON before parse. */
export const MAX_TOOL_ARGS_JSON_CHARS = 1_048_576;
/** Bound gate file bytes (JSON record + margin). */
export const MAX_GATE_FILE_BYTES = MAX_HOOK_STDIO_CHARS * 2 + 512;

/**
 * Durable UPS→Transform handoff (separate hook processes).
 * File under `.autopilot/copilot-gate/` — session.last_error is not writable via upsertSession.
 */
export const COPILOT_GATE_DIR = path.join(".autopilot", "copilot-gate");

/** Stash kinds: needPick prepends; block replaces model-facing prompt. */
export type CopilotGateKind = "needPick" | "block";

export interface CopilotGateRecord {
  kind: CopilotGateKind;
  text: string;
}

/** UPS stdout is dropped by Copilot command hooks — result is for tests only. */
export interface CopilotSubmitResult {
  /** Always ignored by Copilot command UPS — kept for unit tests / symmetry. */
  _sideEffectsOnly?: true;
  /** Test mirror of what was stashed for Transform. */
  _stashedGate?: string;
}

export interface CopilotTransformResult {
  modifiedTransformedPrompt?: string;
}

export interface CopilotStopResult {
  decision?: "block" | "allow";
  reason?: string;
  continue?: boolean;
  stopReason?: string;
}

function sid(p: {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
}): string {
  return (
    p.session_id ??
    p.sessionId ??
    p.conversation_id ??
    p.conversationId ??
    ""
  ).trim();
}

function clipText(text: string, max = MAX_HOOK_STDIO_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function blockReason(message: string | undefined, fallback: string): string {
  const m = typeof message === "string" ? message.trim() : "";
  return m || fallback;
}

export function loopCountFromStopHookActive(
  payload: CopilotStopPayload,
): number {
  const active = payload.stop_hook_active ?? payload.stopHookActive;
  return active === true ? 1 : 0;
}

export function collectCopilotStopErrorText(payload: CopilotStopPayload): string {
  if (!payload || typeof payload !== "object") return "";
  const parts: string[] = [];
  try {
    const push = (value: unknown) => {
      if (typeof value === "string" && value.trim()) {
        parts.push(value);
        return;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const o = value as Record<string, unknown>;
        for (const key of ["message", "error", "name", "stack", "detail"]) {
          const nested = o[key];
          if (typeof nested === "string" && nested.trim()) parts.push(nested);
        }
      }
    };
    push(payload.error);
    push(payload.message);
    push(payload.reason);
  } catch {
    return "";
  }
  return clipText(parts.join("\n"));
}

export function normalizeCopilotStopStatus(
  payload: CopilotStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): "completed" | "error" | "aborted" {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return opts?.status ?? "completed";
  }
  const statusRaw = String(payload.status ?? "")
    .toLowerCase()
    .trim();
  const errText = collectCopilotStopErrorText(payload);
  if (
    statusRaw === "aborted" ||
    statusRaw === "cancelled" ||
    statusRaw === "canceled"
  ) {
    return "aborted";
  }
  if (opts?.status === "aborted") return "aborted";
  if (statusRaw === "error" || statusRaw === "failed") {
    if (isUserAbortText(errText)) return "aborted";
    return "error";
  }
  if (opts?.status === "error") {
    if (isUserAbortText(errText)) return "aborted";
    return "error";
  }
  if (opts?.status === "completed") return "completed";
  if (!statusRaw && isUserAbortText(errText)) return "aborted";
  return "completed";
}

/** Channel A needPick body (Transform injects; UPS does not rely on stdout). */
export function buildNeedPickContext(
  userMessage: unknown,
  candidates?: ReadonlyArray<{ slug?: string }>,
): string {
  const fromMessage =
    typeof userMessage === "string" && userMessage.trim().length > 0
      ? userMessage.trim()
      : "";
  const slugs = [
    ...new Set(
      (candidates ?? [])
        .map((c) => (c && typeof c.slug === "string" ? c.slug.trim() : ""))
        .filter((s) => s.length > 0 && isSafeTrackSlug(s)),
    ),
  ].slice(0, MAX_NEED_PICK_SLUGS);

  let ctx =
    fromMessage ||
    (slugs.length > 0
      ? `Select a plan to execute:\n\n${slugs
          .map((s, i) => `  ${i + 1}. ${s}`)
          .join("\n")}\n\nReply with a number or /autopilot-run <slug>.`
      : "Select a plan to execute. Reply with a number or /autopilot-run <slug>.");

  if (ctx.length > MAX_NEED_PICK_CONTEXT_CHARS) {
    ctx = `${ctx.slice(0, MAX_NEED_PICK_CONTEXT_CHARS - 1)}…`;
  }
  return ctx;
}

function toolInputObject(
  payload: CopilotEditPayload,
): Record<string, unknown> | null {
  const input = payload.tool_input ?? payload.toolInput ?? payload.toolArgs;
  if (!input) return null;
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    if (input.length > MAX_TOOL_ARGS_JSON_CHARS) return null;
    try {
      const parsed: unknown = JSON.parse(input);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function sanitizeEditPath(raw: string): string | null {
  const p = raw.trim();
  if (!p || /[\0\r\n]/.test(p)) return null;
  return p;
}

/**
 * Paths from Copilot edit/create tools.
 * Common fields: path / filePath / file_path / target_file.
 */
export function filePathsFromCopilotEdit(payload: CopilotEditPayload): string[] {
  const input = toolInputObject(payload);
  if (!input) return [];
  const candidates = [
    input.path,
    input.file_path,
    input.filePath,
    input.target_file,
    input.targetFile,
    input.notebook_path,
    input.notebookPath,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      const p = sanitizeEditPath(c);
      if (p) return [p];
    }
  }
  return [];
}

/** File-mutating tools (bash relies on Stop dirty-arm). */
export function isCopilotEditTool(toolName: string): boolean {
  const n = toolName.trim().toLowerCase();
  return n === "edit" || n === "create";
}

function stampCopilotPlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  if (!session || session.platform === COPILOT_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: COPILOT_PLATFORM,
  });
}

/** Hash conversation id so sanitized collisions cannot cross-wire gates. */
export function safeGateFileId(conversationId: string): string {
  return createHash("sha256")
    .update(conversationId, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * Gate file path — always under `projectRoot/.autopilot/copilot-gate/`.
 * Rejects empty roots and paths that resolve outside the project.
 */
export function submitGateFilePath(
  projectRoot: string,
  conversationId: string,
): string {
  if (typeof projectRoot !== "string" || !projectRoot.trim()) {
    throw new Error("copilot gate requires a non-empty projectRoot");
  }
  const root = path.resolve(projectRoot.trim());
  const dir = path.resolve(root, COPILOT_GATE_DIR);
  const file = path.resolve(dir, `${safeGateFileId(conversationId)}.txt`);
  const relToRoot = path.relative(root, file);
  if (
    !relToRoot ||
    relToRoot.startsWith("..") ||
    path.isAbsolute(relToRoot)
  ) {
    throw new Error("copilot gate path escaped project root");
  }
  return file;
}

/** Stash gate text for Transform (busy / needPick / hard errors). Never throws. */
export function stashSubmitGate(
  projectRoot: string,
  conversationId: string,
  message: string,
  kind: CopilotGateKind = "block",
): string {
  const raw = typeof message === "string" ? message.trim() : "";
  const text = clipText(raw || "Autopilot rejected this prompt.");
  const gateKind: CopilotGateKind =
    kind === "needPick" || kind === "block" ? kind : "block";
  try {
    const file = submitGateFilePath(projectRoot, conversationId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const record: CopilotGateRecord = { kind: gateKind, text };
    const body = JSON.stringify(record);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, body, "utf8");
      try {
        fs.renameSync(tmp, file);
      } catch {
        // Windows: rename cannot replace an existing destination.
        try {
          fs.unlinkSync(file);
        } catch {
          /* ignore missing */
        }
        fs.renameSync(tmp, file);
      }
    } catch (err) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw err;
    }
  } catch {
    /* disk / path failures must not break UPS fail-open */
  }
  return text;
}

function parseGateRecord(raw: string): CopilotGateRecord | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_HOOK_STDIO_CHARS * 2) {
    return {
      kind: "block",
      text: clipText(trimmed.slice(0, MAX_HOOK_STDIO_CHARS)),
    };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object") {
      return { kind: "block", text: clipText(trimmed) };
    }
    if (Array.isArray(parsed)) return null;
    const kind = (parsed as CopilotGateRecord).kind;
    const textRaw = (parsed as CopilotGateRecord).text;
    if (
      (kind === "needPick" || kind === "block") &&
      typeof textRaw === "string" &&
      textRaw.trim()
    ) {
      return { kind, text: clipText(textRaw.trim()) };
    }
    // Object JSON that is not our record — do not treat whole blob as user text.
    return null;
  } catch {
    /* legacy plain-text stash */
    return { kind: "block", text: clipText(trimmed) };
  }
}

/** Read + clear submit gate; returns null if absent. Never throws. */
export function takeSubmitGate(
  projectRoot: string,
  conversationId: string,
): CopilotGateRecord | null {
  try {
    const file = submitGateFilePath(projectRoot, conversationId);
    if (!fs.existsSync(file)) return null;
    const st = fs.statSync(file);
    if (!st.isFile() || st.size <= 0) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
      return null;
    }
    if (st.size > MAX_GATE_FILE_BYTES) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
      return null;
    }
    const msg = fs.readFileSync(file, "utf8");
    try {
      fs.unlinkSync(file);
    } catch {
      /* best-effort clear */
    }
    return parseGateRecord(msg);
  } catch {
    return null;
  }
}

/** Drop a stale gate so a later Transform cannot inject a previous turn's notice. */
export function clearSubmitGate(
  projectRoot: string,
  conversationId: string,
): void {
  try {
    const file = submitGateFilePath(projectRoot, conversationId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* best-effort */
  }
}

function gateFail(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
  userMessage: string | undefined,
  kind: CopilotGateKind,
): CopilotSubmitResult {
  stampCopilotPlatform(store, conversationId, projectRoot);
  const stashed = stashSubmitGate(
    projectRoot,
    conversationId,
    blockReason(userMessage, "Autopilot rejected this prompt."),
    kind,
  );
  return { _sideEffectsOnly: true, _stashedGate: stashed };
}

/**
 * userPromptSubmitted → core triggers / FSM.
 * Host drops command UPS stdout — visibility via Transform stash.
 */
export function handleUserPromptSubmit(
  store: StateStore,
  payload: CopilotSubmitPayload,
  projectRoot: string,
  portConfig?: CopilotPortConfig,
): CopilotSubmitResult {
  try {
    return handleUserPromptSubmitInner(
      store,
      payload,
      projectRoot,
      portConfig,
    );
  } catch {
    return { _sideEffectsOnly: true };
  }
}

function handleUserPromptSubmitInner(
  store: StateStore,
  payload: CopilotSubmitPayload,
  projectRoot: string,
  portConfig?: CopilotPortConfig,
): CopilotSubmitResult {
  const conversationId = sid(payload);
  if (!conversationId) return { _sideEffectsOnly: true };

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";

  try {
    store.clearPendingFollowupIf(
      conversationId,
      isRecoverOrStuckFollowupMessage,
    );
  } catch {
    /* best-effort */
  }

  const session = store.getSession(conversationId);
  const hookCfg = loadProjectHookConfig(projectRoot);
  const trigger = parseTrigger({
    prompt,
    conversationId,
    projectRoot,
    pendingAction: session?.pending_action,
    triggers: hookCfg.triggers,
  });

  const actionConfig: PhaseActionConfig = {
    ...portConfig?.phaseActions,
    plansDir: portConfig?.phaseActions?.plansDir ?? hookCfg.plansDir,
  };

  if (trigger) {
    if (trigger.kind === "off") {
      applyOff(store, conversationId);
      stampCopilotPlatform(store, conversationId, projectRoot);
      clearSubmitGate(projectRoot, conversationId);
      return { _sideEffectsOnly: true };
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
        platform: COPILOT_PLATFORM,
      });
      if (!result.ok) {
        return gateFail(
          store,
          conversationId,
          projectRoot,
          result.userMessage,
          "block",
        );
      }
      stampCopilotPlatform(store, conversationId, projectRoot);
      clearSubmitGate(projectRoot, conversationId);
      return { _sideEffectsOnly: true };
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug,
      });
      if (!result.ok) {
        return gateFail(
          store,
          conversationId,
          projectRoot,
          result.userMessage,
          "block",
        );
      }
      stampCopilotPlatform(store, conversationId, projectRoot);
      clearSubmitGate(projectRoot, conversationId);
      return { _sideEffectsOnly: true };
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      stampCopilotPlatform(store, conversationId, projectRoot);
      clearSubmitGate(projectRoot, conversationId);
      return { _sideEffectsOnly: true };
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: COPILOT_PLATFORM,
      });
      if (!result.ok) {
        if (isChannelANeedPick(result)) {
          const ctx = buildNeedPickContext(
            result.userMessage,
            result.candidates,
          );
          return gateFail(store, conversationId, projectRoot, ctx, "needPick");
        }
        return gateFail(
          store,
          conversationId,
          projectRoot,
          result.userMessage,
          "block",
        );
      }
      stampCopilotPlatform(store, conversationId, projectRoot);
      clearSubmitGate(projectRoot, conversationId);
      return { _sideEffectsOnly: true };
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: COPILOT_PLATFORM,
      });
      if (!result.ok) {
        if (isChannelANeedPick(result)) {
          const ctx = buildNeedPickContext(
            result.userMessage,
            result.candidates,
          );
          return gateFail(store, conversationId, projectRoot, ctx, "needPick");
        }
        return gateFail(
          store,
          conversationId,
          projectRoot,
          result.userMessage,
          "block",
        );
      }
      stampCopilotPlatform(store, conversationId, projectRoot);
      clearSubmitGate(projectRoot, conversationId);
      return { _sideEffectsOnly: true };
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig, platform: COPILOT_PLATFORM },
      );
      if (!result.ok) {
        if (isChannelANeedPick(result)) {
          const ctx = buildNeedPickContext(
            result.userMessage,
            result.candidates,
          );
          return gateFail(store, conversationId, projectRoot, ctx, "needPick");
        }
        return gateFail(
          store,
          conversationId,
          projectRoot,
          result.userMessage,
          "block",
        );
      }
      stampCopilotPlatform(store, conversationId, projectRoot);
      clearSubmitGate(projectRoot, conversationId);
      return { _sideEffectsOnly: true };
    }
    clearSubmitGate(projectRoot, conversationId);
    return { _sideEffectsOnly: true };
  }

  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  stampCopilotPlatform(store, conversationId, projectRoot);
  clearSubmitGate(projectRoot, conversationId);
  return { _sideEffectsOnly: true };
}

/**
 * userPromptTransformed — inject stashed UPS gate (needPick / busy / errors).
 * needPick: prepend notice. block/busy: replace model-facing content (do not keep user RUN).
 */
export function handleUserPromptTransformed(
  store: StateStore,
  payload: CopilotTransformPayload,
  projectRoot: string,
): CopilotTransformResult {
  try {
    return handleUserPromptTransformedInner(store, payload, projectRoot);
  } catch {
    return {};
  }
}

function handleUserPromptTransformedInner(
  store: StateStore,
  payload: CopilotTransformPayload,
  projectRoot: string,
): CopilotTransformResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  const gate = takeSubmitGate(projectRoot, conversationId);
  if (!gate) {
    stampCopilotPlatform(store, conversationId, projectRoot);
    return {};
  }

  stampCopilotPlatform(store, conversationId, projectRoot);

  if (gate.kind === "block") {
    return {
      modifiedTransformedPrompt: clipText(
        `[Autopilot]\n${gate.text}`,
        MAX_NEED_PICK_CONTEXT_CHARS + MAX_HOOK_STDIO_CHARS,
      ),
    };
  }

  const baseRaw =
    typeof payload.transformedPrompt === "string"
      ? payload.transformedPrompt
      : typeof payload.prompt === "string"
        ? payload.prompt
        : "";
  const notice = clipText(
    `[Autopilot]\n${gate.text}\n\n---\n\n${baseRaw}`,
    MAX_NEED_PICK_CONTEXT_CHARS + MAX_HOOK_STDIO_CHARS,
  );
  return { modifiedTransformedPrompt: notice };
}

function armCodeEdited(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const cfg = loadProjectReviewConfig(projectRoot);
  if (cfg.reviewScope === "project") {
    ensureAmbientReviewSession(
      store,
      conversationId,
      projectRoot,
      cfg.reviewScope,
      COPILOT_PLATFORM,
    );
  }
  stampCopilotPlatform(store, conversationId, projectRoot);
  const session = store.getSession(conversationId);
  const checklistPath = session?.checklist_path?.trim() ?? "";
  let checklistSnap: ReturnType<typeof parseChecklist> | null = null;
  if (checklistPath) {
    try {
      checklistSnap = parseChecklist(checklistPath, { projectRoot });
    } catch {
      /* still arm */
    }
  }
  store.markCodeEdited(conversationId, (chain) => {
    const fromPending = parseAdvanceNextItemId(chain.pending_followup);
    if (checklistSnap) {
      if (fromPending && effectiveReviewingItemId(checklistSnap, fromPending)) {
        return fromPending;
      }
      return firstUnchecked(checklistSnap)?.id ?? null;
    }
    return fromPending;
  });
}

/** postToolUse → markCodeEdited for edit/create product paths. */
export function handlePostToolUse(
  store: StateStore,
  payload: CopilotEditPayload,
  projectRoot: string,
): void {
  try {
    handlePostToolUseInner(store, payload, projectRoot);
  } catch {
    /* fail-open */
  }
}

function handlePostToolUseInner(
  store: StateStore,
  payload: CopilotEditPayload,
  projectRoot: string,
): void {
  const conversationId = sid(payload);
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  if (!conversationId || !isCopilotEditTool(toolName)) return;

  const filePaths = filePathsFromCopilotEdit(payload);
  if (filePaths.length === 0) {
    stampCopilotPlatform(store, conversationId, projectRoot);
    return;
  }

  let plansDir: string | undefined;
  try {
    plansDir = loadProjectHookConfig(projectRoot).plansDir;
  } catch {
    plansDir = undefined;
  }

  let armed = false;
  for (const filePath of filePaths) {
    try {
      notePlansDirEdit(
        store,
        conversationId,
        projectRoot,
        filePath,
        plansDir,
      );
    } catch {
      /* best-effort */
    }
    if (!isProductCodeEdit(filePath, { projectRoot })) continue;
    if (!armed) {
      armCodeEdited(store, conversationId, projectRoot);
      armed = true;
    }
  }
  if (!armed) {
    stampCopilotPlatform(store, conversationId, projectRoot);
  }
}

/**
 * agentStop → ReviewEngine.
 * Continue: decision:block + reason.
 * Hard stop: empty object (Copilot has no continue:false; do not invent Claude fields).
 * Host caps ~8 consecutive blocks when COPILOT_STOP_CAP_RAISE_FOUND is false.
 */
export function handleStop(
  engine: ReviewEngine,
  payload: CopilotStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): CopilotStopResult {
  try {
    return handleStopInner(engine, payload, opts);
  } catch {
    return {};
  }
}

function handleStopInner(
  engine: ReviewEngine,
  payload: CopilotStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): CopilotStopResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  const status = normalizeCopilotStopStatus(payload, opts);

  const transcriptRaw = payload.transcript_path ?? payload.transcriptPath;
  const transcriptPath =
    typeof transcriptRaw === "string" && transcriptRaw.trim()
      ? transcriptRaw.trim()
      : undefined;

  const action: FollowupAction | null = engine.handleStop({
    conversationId,
    status,
    loopCount: loopCountFromStopHookActive(payload),
    transcriptPath,
    platform: COPILOT_PLATFORM,
  });

  if (!action?.message) return {};

  const reason = blockReason(action.message, "Autopilot followup");

  if (!action.loop) {
    // Copilot agentStop honors decision allow|block only — no continue:false.
    return {};
  }

  return {
    decision: "block",
    reason,
  };
}
