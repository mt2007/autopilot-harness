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

/** Codex UserPromptSubmit stdin fields. */
export interface CodexSubmitPayload {
  session_id?: string;
  sessionId?: string;
  prompt?: string;
  /** Informational only — store always uses install-root projectRoot. */
  cwd?: string;
  transcript_path?: string;
  transcriptPath?: string;
  conversation_id?: string;
  conversationId?: string;
  /** Codex may send plan/default/… — Autopilot ignores (no auto-ON). */
  permission_mode?: string;
  permissionMode?: string;
  turn_id?: string;
  model?: string;
}

/** Codex PostToolUse stdin (apply_patch / Edit / Write / exec / js / …). */
export interface CodexEditPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown> | string;
  toolInput?: Record<string, unknown> | string;
}

/** Codex Stop stdin (no StopFailure event in this port). */
export interface CodexStopPayload {
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
  hook_event_name?: string;
  hookEventName?: string;
  last_assistant_message?: string;
  turn_id?: string;
  error?: unknown;
  message?: unknown;
  reason?: unknown;
}

export interface CodexPortConfig {
  phaseActions?: PhaseActionConfig;
}

export const CODEX_PLATFORM = "codex";

/** Cap needPick list for Codex ~2500-token hook-output budget. */
export const MAX_NEED_PICK_SLUGS = 40;
export const MAX_NEED_PICK_CONTEXT_CHARS = 2_000;
/** Bound hostile/huge apply_patch command parsing. */
export const MAX_APPLY_PATCH_COMMAND_CHARS = 1_048_576;
export const MAX_APPLY_PATCH_PATHS = 256;

export interface CodexSubmitResult {
  decision?: "block";
  reason?: string;
  continue?: boolean;
  stopReason?: string;
  hookSpecificOutput?: {
    hookEventName: "UserPromptSubmit";
    additionalContext?: string;
  };
}

export interface CodexStopResult {
  decision?: "block";
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

/**
 * Map Codex stop_hook_active → ReviewEngine loopCount.
 * true ⇒ in auto-continuation chain.
 */
export function loopCountFromStopHookActive(
  payload: CodexStopPayload,
): number {
  const active = payload.stop_hook_active ?? payload.stopHookActive;
  return active === true ? 1 : 0;
}

export function collectCodexStopErrorText(payload: CodexStopPayload): string {
  if (!payload || typeof payload !== "object") return "";
  const MAX_CHARS = 8_192;
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
  const joined = parts.join("\n");
  return joined.length > MAX_CHARS ? joined.slice(0, MAX_CHARS) : joined;
}

export function normalizeCodexStopStatus(
  payload: CodexStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): "completed" | "error" | "aborted" {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return opts?.status ?? "completed";
  }
  const statusRaw = String(payload.status ?? "")
    .toLowerCase()
    .trim();
  const errText = collectCodexStopErrorText(payload);
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

function blockReason(message: string | undefined, fallback: string): string {
  const m = typeof message === "string" ? message.trim() : "";
  return m || fallback;
}

/**
 * Channel A needPick via additionalContext — never decision:block for pick.
 * Slugs capped for Codex hook output budget.
 * @internal Exported for tests.
 */
export function allowNeedPickContext(
  userMessage: unknown,
  candidates?: ReadonlyArray<{ slug?: string }>,
): CodexSubmitResult {
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

  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: ctx,
    },
  };
}

/**
 * Parse file paths from Codex apply_patch `tool_input.command` text.
 * Supports `*** Add|Update|Delete File:`, `*** Rename File: a -> b`, and `+++` lines.
 */
export function pathsFromApplyPatchCommand(command: string): string[] {
  if (typeof command !== "string" || !command.trim()) return [];
  // Truncate oversized payloads before split (DoS / hostile hooks).
  const text =
    command.length > MAX_APPLY_PATCH_COMMAND_CHARS
      ? command.slice(0, MAX_APPLY_PATCH_COMMAND_CHARS)
      : command;
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    if (found.length >= MAX_APPLY_PATCH_PATHS) return;
    let p = raw.trim();
    if (!p || p === "/dev/null") return;
    // Reject NULs / newlines smuggled into a "path".
    if (/[\0\r\n]/.test(p)) return;
    // Strip optional a/ or b/ prefix from diff paths.
    p = p.replace(/^[ab]\//, "");
    if (!p || seen.has(p)) return;
    seen.add(p);
    found.push(p);
  };

  for (const line of text.split(/\r?\n/)) {
    if (found.length >= MAX_APPLY_PATCH_PATHS) break;
    const rename = line.match(
      /^\*\*\*\s+Rename\s+File:\s*(.+?)\s*->\s*(.+?)\s*$/i,
    );
    if (rename?.[1] && rename[2]) {
      push(rename[1]);
      push(rename[2]);
      continue;
    }
    const header = line.match(
      /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+?)\s*$/i,
    );
    if (header?.[1]) {
      push(header[1]);
      continue;
    }
    const plus = line.match(/^\+\+\+\s+(?:[ab]\/)?(.+?)\s*$/);
    if (plus?.[1] && plus[1] !== "/dev/null") {
      push(plus[1]);
    }
  }
  return found;
}

/** Bound nested tool_input walks for exec/js-wrapped patches. */
export const MAX_TOOL_INPUT_STRINGS = 64;
export const MAX_TOOL_INPUT_DEPTH = 6;
/** Cap total characters collected across nested strings (DoS). */
export const MAX_TOOL_INPUT_SCAN_CHARS = MAX_APPLY_PATCH_COMMAND_CHARS;

function collectNestedStrings(
  value: unknown,
  out: string[],
  depth: number,
  seen: WeakSet<object>,
  totalChars: { n: number },
): void {
  if (out.length >= MAX_TOOL_INPUT_STRINGS) return;
  if (totalChars.n >= MAX_TOOL_INPUT_SCAN_CHARS) return;
  if (depth > MAX_TOOL_INPUT_DEPTH) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return;
    const room = MAX_TOOL_INPUT_SCAN_CHARS - totalChars.n;
    if (room <= 0) return;
    const slice = value.length > room ? value.slice(0, room) : value;
    totalChars.n += slice.length;
    out.push(slice);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (
        out.length >= MAX_TOOL_INPUT_STRINGS ||
        totalChars.n >= MAX_TOOL_INPUT_SCAN_CHARS
      ) {
        break;
      }
      collectNestedStrings(item, out, depth + 1, seen, totalChars);
    }
    return;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (
      out.length >= MAX_TOOL_INPUT_STRINGS ||
      totalChars.n >= MAX_TOOL_INPUT_SCAN_CHARS
    ) {
      break;
    }
    collectNestedStrings(nested, out, depth + 1, seen, totalChars);
  }
}

/**
 * Scan full tool_input (root string + nested string fields) for Begin Patch
 * headers. Used when Codex wraps apply_patch inside `exec` / `js`.
 */
export function pathsFromWrappedPatchToolInput(rawInput: unknown): string[] {
  const strings: string[] = [];
  collectNestedStrings(rawInput, strings, 0, new WeakSet<object>(), { n: 0 });
  const found: string[] = [];
  const seen = new Set<string>();
  for (const s of strings) {
    for (const p of pathsFromApplyPatchCommand(s)) {
      if (found.length >= MAX_APPLY_PATCH_PATHS) return found;
      if (seen.has(p)) continue;
      seen.add(p);
      found.push(p);
    }
  }
  return found;
}

function toolInputObject(
  payload: CodexEditPayload,
): Record<string, unknown> | null {
  const input = payload.tool_input ?? payload.toolInput;
  if (!input) return null;
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return null;
}

/**
 * Paths touched by this PostToolUse (0..n).
 * apply_patch → parse command; Edit/Write → file_path-style fields;
 * exec/js → full tool_input string scan for Begin Patch.
 */
export function filePathsFromCodexEdit(payload: CodexEditPayload): string[] {
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  const rawInput = payload.tool_input ?? payload.toolInput;

  if (toolName === "exec" || toolName === "js") {
    return pathsFromWrappedPatchToolInput(rawInput);
  }

  if (toolName === "apply_patch" || toolName === "ApplyPatch") {
    // Object `{ command }` or rare stringified command body.
    if (typeof rawInput === "string") {
      return pathsFromApplyPatchCommand(rawInput);
    }
    const input = toolInputObject(payload);
    if (!input) return [];
    const cmd = input.command;
    if (typeof cmd === "string") return pathsFromApplyPatchCommand(cmd);
    return [];
  }

  const input = toolInputObject(payload);
  if (!input) return [];

  const candidates = [
    input.file_path,
    input.filePath,
    input.path,
    input.notebook_path,
    input.notebookPath,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return [c.trim()];
  }
  return [];
}

/** File-mutating tools Autopilot arms from (bare shell still relies on dirty-arm). */
export function isCodexEditTool(toolName: string): boolean {
  const n = toolName.trim();
  return (
    n === "apply_patch" ||
    n === "ApplyPatch" ||
    n === "Edit" ||
    n === "Write" ||
    n === "exec" ||
    n === "js"
  );
}

function stampCodexPlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  if (!session || session.platform === CODEX_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: CODEX_PLATFORM,
  });
}

/**
 * UserPromptSubmit → core triggers / fail-closed.
 * needPick → additionalContext (Channel A). Busy/errors → decision:block.
 * permission_mode is ignored (no auto-ON).
 */
export function handleUserPromptSubmit(
  store: StateStore,
  payload: CodexSubmitPayload,
  projectRoot: string,
  portConfig?: CodexPortConfig,
): CodexSubmitResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

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
  const gateFallback =
    "Autopilot rejected this prompt. Check `npx autopilot-harness status`.";

  if (trigger) {
    if (trigger.kind === "off") {
      applyOff(store, conversationId);
      stampCodexPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
        platform: CODEX_PLATFORM,
      });
      if (!result.ok) {
        stampCodexPlatform(store, conversationId, projectRoot);
        return {
          decision: "block",
          reason: blockReason(result.userMessage, gateFallback),
        };
      }
      return {};
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug,
      });
      if (!result.ok) {
        stampCodexPlatform(store, conversationId, projectRoot);
        return {
          decision: "block",
          reason: blockReason(result.userMessage, gateFallback),
        };
      }
      stampCodexPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      stampCodexPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: CODEX_PLATFORM,
      });
      if (!result.ok) {
        stampCodexPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return allowNeedPickContext(result.userMessage, result.candidates);
        }
        return {
          decision: "block",
          reason: blockReason(result.userMessage, gateFallback),
        };
      }
      return {};
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: CODEX_PLATFORM,
      });
      if (!result.ok) {
        stampCodexPlatform(store, conversationId, projectRoot);
        return {
          decision: "block",
          reason: blockReason(result.userMessage, gateFallback),
        };
      }
      return {};
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig, platform: CODEX_PLATFORM },
      );
      if (!result.ok) {
        stampCodexPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return allowNeedPickContext(result.userMessage, result.candidates);
        }
        return {
          decision: "block",
          reason: blockReason(result.userMessage, gateFallback),
        };
      }
      return {};
    }
    return {};
  }

  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  stampCodexPlatform(store, conversationId, projectRoot);
  return {};
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
      CODEX_PLATFORM,
    );
  }
  stampCodexPlatform(store, conversationId, projectRoot);
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

/** PostToolUse → markCodeEdited when any product path is touched. */
export function handlePostToolUse(
  store: StateStore,
  payload: CodexEditPayload,
  projectRoot: string,
): void {
  const conversationId = sid(payload);
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  if (!conversationId || !isCodexEditTool(toolName)) return;

  const filePaths = filePathsFromCodexEdit(payload);
  if (filePaths.length === 0) {
    // apply_patch / exec / js with unparsable or empty patch text: stamp
    // platform; dirty-arm on Stop covers product paths. Do not false-arm.
    stampCodexPlatform(store, conversationId, projectRoot);
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
    stampCodexPlatform(store, conversationId, projectRoot);
  }
}

/**
 * Stop → ReviewEngine.
 * Continuing followups: decision:block + reason only (never continue:false to keep going).
 * loop:false hard-stop may use continue:false (Codex stop precedence).
 * No StopFailure handler in this port — hook boundary fail-open.
 */
export function handleStop(
  engine: ReviewEngine,
  payload: CodexStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): CodexStopResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  const status = normalizeCodexStopStatus(payload, opts);

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
    platform: CODEX_PLATFORM,
  });

  if (!action?.message) return {};

  const reason = blockReason(action.message, "Autopilot followup");

  if (!action.loop) {
    return { continue: false, stopReason: reason };
  }

  return {
    decision: "block",
    reason,
  };
}
