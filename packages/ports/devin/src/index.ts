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

/** Devin CLI UserPromptSubmit stdin. Conversation key is `session_id` only. */
export interface DevinSubmitPayload {
  session_id?: string;
  sessionId?: string;
  prompt?: string;
  /** Informational. Store always uses the install-root projectRoot. */
  cwd?: string;
  prompt_id?: string;
  hook_event_name?: string;
  hookEventName?: string;
}

/** Devin CLI PostToolUse stdin. */
export interface DevinEditPayload {
  session_id?: string;
  sessionId?: string;
  cwd?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown> | string;
  toolInput?: Record<string, unknown> | string;
  hook_event_name?: string;
  hookEventName?: string;
}

/** Devin CLI Stop stdin. No SubagentStop event in this port. */
export interface DevinStopPayload {
  session_id?: string;
  sessionId?: string;
  cwd?: string;
  transcript_path?: string;
  transcriptPath?: string;
  status?: string;
  /** Boolean. `true` means a Stop hook is already active (not a numeric cap). */
  stop_hook_active?: boolean;
  stopHookActive?: boolean;
  hook_event_name?: string;
  hookEventName?: string;
}

export interface DevinPortConfig {
  phaseActions?: PhaseActionConfig;
}

/**
 * UPS / Stop stdout. Allow is an empty object (runner writes zero-byte stdout,
 * exit 0). Optional `{decision:"approve"}` is also allow. Continue is
 * `{decision:"block", reason}`. Never exit 2 — that blocks, and harness
 * errors must fail open.
 */
export interface DevinSubmitResult {
  decision?: "block" | "approve";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: "UserPromptSubmit";
    additionalContext?: string;
  };
}

export interface DevinStopResult {
  decision?: "block" | "approve";
  reason?: string;
  /** Deliver-once (loop:false). Not the continue contract. */
  continue?: boolean;
  stopReason?: string;
}

export const DEVIN_PLATFORM = "devin";

/** Hook child env. Stock command quotes this, not a relative `.autopilot/bin`. */
export const DEVIN_PROJECT_DIR_ENV = "DEVIN_PROJECT_DIR";

/** The file is the event map. Do not nest under `"hooks"`. */
export const DEVIN_HOOKS_REL_PATH = ".devin/hooks.v1.json";

/** Seconds. No documented host default — init writes this. */
export const DEVIN_HOOK_TIMEOUT_SEC = 120;

/**
 * Soft min from research probe (3000.10.31). Below → doctor WARN.
 * Unparseable version → tip to trust the live CLI; do not invent a lower floor.
 */
export const DEVIN_SOFT_MIN_VERSION = "3000.10.31";

/**
 * Public research: no documented numeric Stop-continue hard-cap / raise knob.
 * Live smoke decides full vs degraded.
 */
export const DEVIN_STOP_CAP_RAISE_FOUND = false;

/**
 * Anchored PostToolUse matcher. `"edit"` alone is a substring and also
 * matches names that merely contain `edit`. `exec` is intentionally absent
 * (dirty-arm on Stop, never a Post block).
 */
export const DEVIN_POST_TOOL_USE_MATCHER =
  "^(write|edit|apply_patch|notebook_edit)$";

const DEVIN_EDIT_TOOL_RE = new RegExp(DEVIN_POST_TOOL_USE_MATCHER);
const DEVIN_EXEC_TOOL_RE = /^exec$/;

export const DEVIN_AUTOPILOT_EVENTS = [
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
] as const;

export type DevinHookEvent = (typeof DEVIN_AUTOPILOT_EVENTS)[number];

/** Runner must use this on throw / empty allow. Never 2. */
export const DEVIN_FAIL_OPEN_EXIT = 0 as const;

export const MAX_NEED_PICK_SLUGS = 40;
export const MAX_NEED_PICK_CONTEXT_CHARS = 2_000;
export const MAX_HOOK_TEXT_CHARS = 8_192;
/** Refuse huge stringified `tool_input` before JSON.parse. */
export const MAX_TOOL_INPUT_JSON_CHARS = 1_048_576;

const PATH_KEYS = [
  "file_path",
  "filePath",
  "path",
  "notebook_path",
  "notebookPath",
  "target_file",
  "targetFile",
] as const;

/**
 * Distinct from the Claude stamp (`--platform claude-code`, relative bin).
 * `$DEVIN_PROJECT_DIR` is required because the hook cwd is not the repo root.
 */
export function devinHookCommandLine(event: string): string {
  if (typeof event !== "string") {
    throw new Error("devinHookCommandLine: invalid event");
  }
  const safeEvent = event.replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 64);
  if (
    !safeEvent ||
    safeEvent !== event ||
    !DEVIN_AUTOPILOT_EVENTS.includes(event as DevinHookEvent)
  ) {
    throw new Error("devinHookCommandLine: invalid event");
  }
  return `node "$${DEVIN_PROJECT_DIR_ENV}"/.autopilot/bin/autopilot-harness-hook.mjs --platform ${DEVIN_PLATFORM} --event ${safeEvent}`;
}

/** True only for this port's command stamp. Claude lines are not a match. */
export function isDevinHookFingerprint(command: string | undefined): boolean {
  if (typeof command !== "string") return false;
  if (!command.includes("autopilot-harness-hook.mjs")) return false;
  if (/(?:^|\s)--platform claude-code(?:\s|$)/.test(command)) return false;
  return /(?:^|\s)--platform devin(?:\s|$)/.test(command);
}

/**
 * Install root, then `DEVIN_PROJECT_DIR`, then stdin cwd.
 * Never `process.cwd()` and never payload `cwd`.
 */
export function resolveDevinWorkspaceRoot(
  opts?: {
    installRoot?: string;
    env?: NodeJS.ProcessEnv;
    stdinCwd?: string;
  } | null,
): string | null {
  if (!opts) return null;
  const env = opts.env ?? {};
  const candidates = [
    opts.installRoot,
    env[DEVIN_PROJECT_DIR_ENV],
    opts.stdinCwd,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed && !/[\u0000-\u001f\u007f]/.test(trimmed)) return trimmed;
  }
  return null;
}

/**
 * Either boolean form strictly `true` → loopCount ≥ 1.
 * Missing, false, or a non-boolean (including `"true"`) → 0.
 */
export function loopCountFromDevinStopHookActive(
  payload: DevinStopPayload | null | undefined,
): number {
  if (!payload || typeof payload !== "object") return 0;
  return payload.stop_hook_active === true || payload.stopHookActive === true
    ? 1
    : 0;
}

export function isDevinEditTool(toolName: string): boolean {
  if (typeof toolName !== "string") return false;
  return DEVIN_EDIT_TOOL_RE.test(toolName.trim());
}

/** Shell tool. Not in the Post matcher. Stop dirty-arm covers its edits. */
export function isDevinExecTool(toolName: string): boolean {
  if (typeof toolName !== "string") return false;
  return DEVIN_EXEC_TOOL_RE.test(toolName.trim());
}

/** Empty object → runner zero-byte stdout + exit 0. */
export function isDevinSilentAllow(
  result: DevinSubmitResult | DevinStopResult | null | undefined,
): boolean {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  for (const value of Object.values(result)) {
    if (value !== undefined && value !== null) return false;
  }
  return true;
}

function sessionIdOnly(
  payload:
    | {
        session_id?: string;
        sessionId?: string;
      }
    | null
    | undefined,
): string {
  if (!payload || typeof payload !== "object") return "";
  for (const raw of [payload.session_id, payload.sessionId]) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    // Match StateStore: control chars are not a conversation key.
    if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) continue;
    return trimmed;
  }
  return "";
}

function clipText(text: string, max = MAX_HOOK_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function blockReason(message: unknown, fallback: string): string {
  const text = typeof message === "string" ? message.trim() : "";
  return clipText(text || fallback);
}

function firstNonBlankString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function toolNameOf(payload: DevinEditPayload | null | undefined): string {
  if (!payload || typeof payload !== "object") return "";
  return firstNonBlankString(payload.tool_name, payload.toolName);
}

function asToolInputObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  if (value.length > MAX_TOOL_INPUT_JSON_CHARS) return null;
  const text = value.trim();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pathText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return "";
  return trimmed;
}

function objectHasPath(input: Record<string, unknown>): boolean {
  return PATH_KEYS.some((key) => pathText(input[key]).length > 0);
}

function toolInputObject(
  payload: DevinEditPayload,
): Record<string, unknown> | null {
  const snake = asToolInputObject(payload.tool_input);
  const camel = asToolInputObject(payload.toolInput);
  if (snake && objectHasPath(snake)) return snake;
  if (camel && objectHasPath(camel)) return camel;
  return snake ?? camel;
}

function pathsFromToolInput(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of PATH_KEYS) {
    const filePath = pathText(input[key]);
    if (!filePath || out.includes(filePath)) continue;
    out.push(filePath);
  }
  return out;
}

function editPaths(
  payload: DevinEditPayload | null | undefined,
): string[] {
  if (!payload || typeof payload !== "object") return [];
  if (!isDevinEditTool(toolNameOf(payload))) return [];
  const input = toolInputObject(payload);
  if (!input) return [];
  return pathsFromToolInput(input);
}

/** First usable path. A bad earlier key does not hide a later one. */
export function filePathFromDevinEdit(
  payload: DevinEditPayload | null | undefined,
): string {
  return editPaths(payload)[0] ?? "";
}

function allowNeedPick(
  userMessage: unknown,
  candidates?: ReadonlyArray<{ slug?: string }>,
): DevinSubmitResult {
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

function blockSubmit(message: unknown, fallback: string): DevinSubmitResult {
  return { decision: "block", reason: blockReason(message, fallback) };
}

function stampDevinPlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  if (!session || session.platform === DEVIN_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: DEVIN_PLATFORM,
  });
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
      DEVIN_PLATFORM,
    );
  }
  stampDevinPlatform(store, conversationId, projectRoot);
  const session = store.getSession(conversationId);
  const checklistPath = session?.checklist_path?.trim() ?? "";
  let checklistSnap: ReturnType<typeof parseChecklist> | null = null;
  if (checklistPath) {
    try {
      checklistSnap = parseChecklist(checklistPath, { projectRoot });
    } catch {
      /* still arm code_edited */
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

/**
 * UserPromptSubmit. Harness followups are not ON/RUN.
 * Fail-open: throw → `{}` (exit 0), never exit 2.
 */
export function handleDevinUserPromptSubmit(
  store: StateStore,
  payload: DevinSubmitPayload,
  projectRoot: string,
  portConfig?: DevinPortConfig,
): DevinSubmitResult {
  try {
    return handleDevinUserPromptSubmitInner(
      store,
      payload,
      projectRoot,
      portConfig,
    );
  } catch {
    return {};
  }
}

function handleDevinUserPromptSubmitInner(
  store: StateStore,
  payload: DevinSubmitPayload,
  projectRoot: string,
  portConfig?: DevinPortConfig,
): DevinSubmitResult {
  const conversationId = sessionIdOnly(payload);
  if (!conversationId) return {};

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (isHarnessFollowupMessage(prompt)) {
    stampDevinPlatform(store, conversationId, projectRoot);
    return {};
  }

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

  if (trigger?.kind === "off") {
    applyOff(store, conversationId);
    stampDevinPlatform(store, conversationId, projectRoot);
    return {};
  }
  if (trigger?.kind === "on") {
    const result = applyOn(store, conversationId, projectRoot, {
      initialBrief: trigger.initialBrief,
      slug: trigger.slug,
      platform: DEVIN_PLATFORM,
    });
    stampDevinPlatform(store, conversationId, projectRoot);
    if (!result.ok) return blockSubmit(result.userMessage, gateFallback);
    return {};
  }
  if (trigger?.kind === "resume") {
    const result = applyResume(store, conversationId, { slug: trigger.slug });
    stampDevinPlatform(store, conversationId, projectRoot);
    if (!result.ok) return blockSubmit(result.userMessage, gateFallback);
    return {};
  }
  if (trigger?.kind === "resume_review") {
    applyResumeReview(store, conversationId);
    stampDevinPlatform(store, conversationId, projectRoot);
    return {};
  }
  if (trigger?.kind === "run") {
    const result = applyRun(store, conversationId, projectRoot, {
      slug: trigger.slug,
      config: actionConfig,
      platform: DEVIN_PLATFORM,
    });
    stampDevinPlatform(store, conversationId, projectRoot);
    if (!result.ok) {
      if (isChannelANeedPick(result)) {
        return allowNeedPick(result.userMessage, result.candidates);
      }
      return blockSubmit(result.userMessage, gateFallback);
    }
    return {};
  }
  if (trigger?.kind === "replan") {
    const result = applyReplan(store, conversationId, projectRoot, {
      slug: trigger.slug,
      config: actionConfig,
      platform: DEVIN_PLATFORM,
    });
    stampDevinPlatform(store, conversationId, projectRoot);
    if (!result.ok) {
      if (isChannelANeedPick(result)) {
        return allowNeedPick(result.userMessage, result.candidates);
      }
      return blockSubmit(result.userMessage, gateFallback);
    }
    return {};
  }
  if (trigger?.kind === "track_pick" && trigger.trackPick) {
    const result = applyTrackPick(
      store,
      conversationId,
      projectRoot,
      trigger.trackPick,
      { config: actionConfig, platform: DEVIN_PLATFORM },
    );
    stampDevinPlatform(store, conversationId, projectRoot);
    if (!result.ok) {
      if (isChannelANeedPick(result)) {
        return allowNeedPick(result.userMessage, result.candidates);
      }
      return blockSubmit(result.userMessage, gateFallback);
    }
    return {};
  }

  store.clearChainPending(conversationId);
  stampDevinPlatform(store, conversationId, projectRoot);
  return {};
}

/**
 * PostToolUse. Matcher tools arm `code_edited`. `exec` does not (Stop
 * dirty-arm). This function never returns a block decision.
 */
export function handleDevinPostToolUse(
  store: StateStore,
  payload: DevinEditPayload,
  projectRoot: string,
): void {
  try {
    handleDevinPostToolUseInner(store, payload, projectRoot);
  } catch {
    /* fail-open exit 0 */
  }
}

function handleDevinPostToolUseInner(
  store: StateStore,
  payload: DevinEditPayload,
  projectRoot: string,
): void {
  if (!payload || typeof payload !== "object") return;
  const conversationId = sessionIdOnly(payload);
  const toolName = toolNameOf(payload);
  if (!conversationId || !isDevinEditTool(toolName)) return;

  const paths = editPaths(payload);
  if (paths.length === 0) {
    stampDevinPlatform(store, conversationId, projectRoot);
    return;
  }

  let plansDir: string | undefined;
  try {
    plansDir = loadProjectHookConfig(projectRoot).plansDir;
  } catch {
    plansDir = undefined;
  }

  let armed = false;
  for (const filePath of paths) {
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
    if (armed || !isProductCodeEdit(filePath, { projectRoot })) continue;
    armCodeEdited(store, conversationId, projectRoot);
    armed = true;
  }
  if (!armed) stampDevinPlatform(store, conversationId, projectRoot);
}

export function normalizeDevinStopStatus(
  payload: DevinStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): "completed" | "error" | "aborted" {
  const statusRaw = String(payload?.status ?? "")
    .toLowerCase()
    .trim();
  if (
    statusRaw === "aborted" ||
    statusRaw === "cancelled" ||
    statusRaw === "canceled" ||
    opts?.status === "aborted"
  ) {
    return "aborted";
  }
  if (
    statusRaw === "error" ||
    statusRaw === "failed" ||
    opts?.status === "error"
  ) {
    return "error";
  }
  return "completed";
}

/**
 * Stop → ReviewEngine. Continue is stdout `{decision:"block", reason}`.
 * `stop_hook_active: true` maps to loopCount 1. Fail-open returns `{}`.
 */
export function handleDevinStop(
  engine: ReviewEngine,
  payload: DevinStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): DevinStopResult {
  try {
    return handleDevinStopInner(engine, payload, opts);
  } catch {
    return {};
  }
}

function handleDevinStopInner(
  engine: ReviewEngine,
  payload: DevinStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): DevinStopResult {
  const conversationId = sessionIdOnly(payload);
  if (!conversationId) return {};

  const transcriptTrimmed = firstNonBlankString(
    payload.transcript_path,
    payload.transcriptPath,
  );
  const transcriptPath =
    transcriptTrimmed && !/[\u0000-\u001f\u007f]/.test(transcriptTrimmed)
      ? transcriptTrimmed
      : undefined;

  const action: FollowupAction | null = engine.handleStop({
    conversationId,
    status: normalizeDevinStopStatus(payload, opts),
    loopCount: loopCountFromDevinStopHookActive(payload),
    transcriptPath,
    platform: DEVIN_PLATFORM,
  });

  if (!action?.message) return {};

  const reason = blockReason(action.message, "Autopilot followup");
  if (!action.loop) {
    return { continue: false, stopReason: reason };
  }
  return { decision: "block", reason };
}
