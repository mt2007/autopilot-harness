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

/** Factory Droid UserPromptSubmit stdin (camelCase + snake_case). */
export interface FactorySubmitPayload {
  session_id?: string;
  sessionId?: string;
  prompt?: string;
  has_images?: boolean;
  hasImages?: boolean;
  /** Informational — store uses install-root projectRoot. */
  cwd?: string;
  transcript_path?: string;
  transcriptPath?: string;
  conversation_id?: string;
  conversationId?: string;
  permission_mode?: string;
  permissionMode?: string;
  hook_event_name?: string;
  hookEventName?: string;
  message_id?: string;
  messageId?: string;
}

/** Factory Droid PostToolUse stdin. */
export interface FactoryEditPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown> | string;
  toolInput?: Record<string, unknown> | string;
  tool_response?: Record<string, unknown> | string;
  toolResponse?: Record<string, unknown> | string;
  hook_event_name?: string;
  hookEventName?: string;
}

/** Factory Droid Stop stdin (no SubagentStop / Session* in this port). */
export interface FactoryStopPayload {
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
  tool_execution_count?: number;
  toolExecutionCount?: number;
  elapsed_time?: number;
  elapsedTime?: number;
  hook_event_name?: string;
  hookEventName?: string;
  last_assistant_message?: string;
  lastAssistantMessage?: string;
  /** Gate only genuine completions (`end_turn`); session-end reasons must not continue. */
  reason?: unknown;
  error?: unknown;
  message?: unknown;
}

export interface FactoryPortConfig {
  phaseActions?: PhaseActionConfig;
}

export const FACTORY_PLATFORM = "factory-droid";
/** @deprecated Prefer FACTORY_PLATFORM — kept for doctor/docs naming clarity. */
export const FACTORY_DROID_PLATFORM = FACTORY_PLATFORM;

/**
 * Public research (2026-09): no documented numeric Stop cap; no raise knob.
 * Live smoke (2026-09-15) proved multi-block under stop_hook_active.
 * See plans/v0.8-factory-droid/research-stop-cap.md + live-smoke-evidence.
 */
export const FACTORY_DROID_STOP_CAP_RAISE_FOUND = false;
/** Live proved multi-block under stop_hook_active (live-factory-smoke). */
export const FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN = true;
/**
 * Multi-block when true (live-proved default; keep true).
 * Flip to false only for degraded ≤1 / natural Stop (policy or host regress).
 */
export const FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE = true;
/** Doctor / docs ceiling when ALLOW is false (degraded). */
export const FACTORY_DROID_DEGRADED_STOP_CONTINUE_CAP = 1;

/** Env keys for hook-runner root resolution (never trust process.cwd alone). */
export const FACTORY_DROID_ENV_PROJECT_DIR = "FACTORY_PROJECT_DIR";
export const FACTORY_DROID_ENV_CWD = "DROID_CWD";

/**
 * PostToolUse matcher draft (Factory tools).
 * Live smoke may widen; dirty-arm covers Execute/shell on Stop.
 */
export const FACTORY_POST_TOOL_USE_MATCHER = "Create|Edit|ApplyPatch";

export const MAX_NEED_PICK_SLUGS = 40;
export const MAX_NEED_PICK_CONTEXT_CHARS = 2_000;
export const MAX_HOOK_STDIO_CHARS = 8_192;
export const MAX_TOOL_ARGS_JSON_CHARS = 1_048_576;
export const MAX_APPLY_PATCH_COMMAND_CHARS = 1_048_576;
export const MAX_APPLY_PATCH_PATHS = 256;

/**
 * UPS stdout — inject or block.
 * Allow (no fields on this object): runner MUST write **zero-byte** stdout
 * (never `JSON.stringify({})` — Factory appends allow stdout to model context).
 */
export interface FactorySubmitResult {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
  };
}

export interface FactoryStopResult {
  decision?: "block";
  reason?: string;
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
}

/**
 * True when Factory stdout must be **zero-byte** (UPS allow / Stop silence).
 * Runner must not `JSON.stringify` these — Factory appends non-empty stdout to
 * model context on allow-like paths.
 */
export function isFactoryEmptyStdout(
  result: FactorySubmitResult | FactoryStopResult | null | undefined,
): boolean {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  // Allow only a true no-op object. Any defined field (including continue:false,
  // stopReason, whitespace reason, empty hookSpecificOutput) must keep JSON
  // stdout — never treat hard-stop / block / inject as empty-body allow.
  for (const value of Object.values(result as Record<string, unknown>)) {
    if (value !== undefined && value !== null) return false;
  }
  return true;
}

/** @deprecated Prefer {@link isFactoryEmptyStdout} — same predicate (UPS allow). */
export const isFactoryUpsAllow = isFactoryEmptyStdout;

/** True if either camelCase or snake_case flag is strictly true. */
export function isFactoryStopHookActive(payload: FactoryStopPayload): boolean {
  return (
    payload.stop_hook_active === true || payload.stopHookActive === true
  );
}

/**
 * Degraded ≤1: yield (natural Stop) when already continuing from a prior block.
 * Exported so tests can cover the branch without flipping the ship constant.
 */
export function shouldYieldFactoryStopWhenActive(
  payload: FactoryStopPayload,
  allowMultiBlock = FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE,
): boolean {
  if (allowMultiBlock) return false;
  return isFactoryStopHookActive(payload);
}

function sid(p: {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
}): string {
  for (const v of [
    p.session_id,
    p.sessionId,
    p.conversation_id,
    p.conversationId,
  ]) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
    }
  }
  return "";
}

function clipText(text: string, max = MAX_HOOK_STDIO_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function blockReason(message: string | undefined, fallback: string): string {
  const m = typeof message === "string" ? message.trim() : "";
  return m || fallback;
}

/**
 * Prefer install-root, then FACTORY_PROJECT_DIR, DROID_CWD, stdin cwd.
 * Never returns process.cwd().
 */
export function resolveFactoryWorkspaceRoot(opts: {
  installRoot?: string;
  env?: NodeJS.ProcessEnv;
  stdinCwd?: string;
}): string | null {
  const env = opts.env ?? process.env;
  const candidates = [
    opts.installRoot,
    env[FACTORY_DROID_ENV_PROJECT_DIR],
    env[FACTORY_DROID_ENV_CWD],
    opts.stdinCwd,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      const t = c.trim();
      // Reject NULs / newlines smuggled into a workspace root.
      if (t && !/[\0\r\n]/.test(t)) return t;
    }
  }
  return null;
}

/**
 * Map stop_hook_active → ReviewEngine loopCount.
 * true ⇒ already in auto-continuation chain this turn.
 */
export function loopCountFromStopHookActive(
  payload: FactoryStopPayload,
): number {
  return isFactoryStopHookActive(payload) ? 1 : 0;
}

export function collectFactoryStopErrorText(
  payload: FactoryStopPayload,
): string {
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

export function normalizeFactoryStopStatus(
  payload: FactoryStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): "completed" | "error" | "aborted" {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return opts?.status ?? "completed";
  }
  const statusRaw = String(payload.status ?? "")
    .toLowerCase()
    .trim();
  const errText = collectFactoryStopErrorText(payload);
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

/**
 * Session-end / non-completion Stop fires must not Autopilot-continue.
 * Gate only when reason is absent/empty or a known completion value (`end_turn`).
 */
export function isFactoryStopCompletionReason(
  payload: FactoryStopPayload,
): boolean {
  const raw = payload?.reason;
  if (raw == null) return true;
  if (typeof raw !== "string") return false;
  const r = raw.trim().toLowerCase();
  if (!r) return true;
  if (r === "end_turn" || r === "endturn" || r === "completed") return true;
  return false;
}

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

/** Prefer Channel A inject (Factory UPS hookSpecificOutput shape). */
export function injectNeedPickContext(
  userMessage: unknown,
  candidates?: ReadonlyArray<{ slug?: string }>,
): FactorySubmitResult {
  const ctx = buildNeedPickContext(userMessage, candidates);
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: ctx,
    },
  };
}

/** Fallback: UPS block discards prompt (user re-submits with slug). */
export function blockSubmit(
  userMessage: unknown,
  fallback: string,
): FactorySubmitResult {
  return {
    decision: "block",
    reason: clipText(
      blockReason(
        typeof userMessage === "string" ? userMessage : undefined,
        fallback,
      ),
      MAX_NEED_PICK_CONTEXT_CHARS + 256,
    ),
  };
}

/**
 * Parse paths from ApplyPatch command / patch body.
 * Supports `*** Add|Update|Delete File:`, `*** Rename File: a -> b`, and `+++` lines.
 */
export function pathsFromApplyPatchCommand(command: string): string[] {
  if (typeof command !== "string" || !command.trim()) return [];
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
    if (/[\0\r\n]/.test(p)) return;
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

function toolInputObject(
  payload: FactoryEditPayload,
): Record<string, unknown> | null {
  const input = payload.tool_input ?? payload.toolInput;
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

export function filePathsFromFactoryEdit(
  payload: FactoryEditPayload,
): string[] {
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  const rawInput = payload.tool_input ?? payload.toolInput;

  if (toolName === "ApplyPatch" || toolName === "apply_patch") {
    if (typeof rawInput === "string") {
      // Prefer patch-body parse; JSON object string falls through below.
      const fromBody = pathsFromApplyPatchCommand(rawInput);
      if (fromBody.length > 0) return fromBody;
    }
    const input = toolInputObject(payload);
    if (input) {
      for (const key of ["command", "patch", "input"] as const) {
        const v = input[key];
        if (typeof v === "string") {
          const fromCmd = pathsFromApplyPatchCommand(v);
          if (fromCmd.length > 0) return fromCmd;
        }
      }
    }
    // Fall through: some hosts put a plain path on ApplyPatch.
  }

  const input = toolInputObject(payload);
  if (!input) return [];
  const candidates = [
    input.file_path,
    input.filePath,
    input.path,
    input.target_file,
    input.targetFile,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && !/[\0\r\n]/.test(c)) {
      return [c.trim()];
    }
  }
  return [];
}

/** File-mutating tools Autopilot arms (shell → dirty-arm on Stop). */
export function isFactoryEditTool(toolName: string): boolean {
  const n = toolName.trim();
  return (
    n === "Create" ||
    n === "Edit" ||
    n === "ApplyPatch" ||
    n === "apply_patch"
  );
}

function stampFactoryPlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  if (!session || session.platform === FACTORY_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: FACTORY_PLATFORM,
  });
}

/**
 * UserPromptSubmit → core triggers / FSM.
 * Allow → empty-field object; **runner must emit zero-byte stdout** (Factory
 * adds plain/JSON allow stdout to model context — never stringify `{}`).
 * Prefer inject for needPick; fallback decision:block.
 * Stop-reason re-entry: harness followups do not clear pending/chain.
 */
export function handleUserPromptSubmit(
  store: StateStore,
  payload: FactorySubmitPayload,
  projectRoot: string,
  portConfig?: FactoryPortConfig,
): FactorySubmitResult {
  try {
    return handleUserPromptSubmitInner(
      store,
      payload,
      projectRoot,
      portConfig,
    );
  } catch {
    return {};
  }
}

/** Aliased export for vendor. */
export const handleFactoryUserPromptSubmit = handleUserPromptSubmit;

function handleUserPromptSubmitInner(
  store: StateStore,
  payload: FactorySubmitPayload,
  projectRoot: string,
  portConfig?: FactoryPortConfig,
): FactorySubmitResult {
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
      stampFactoryPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
        platform: FACTORY_PLATFORM,
      });
      if (!result.ok) {
        stampFactoryPlatform(store, conversationId, projectRoot);
        return blockSubmit(result.userMessage, gateFallback);
      }
      stampFactoryPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug,
      });
      if (!result.ok) {
        stampFactoryPlatform(store, conversationId, projectRoot);
        return blockSubmit(result.userMessage, gateFallback);
      }
      stampFactoryPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      stampFactoryPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: FACTORY_PLATFORM,
      });
      if (!result.ok) {
        stampFactoryPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return injectNeedPickContext(
            result.userMessage,
            result.candidates,
          );
        }
        return blockSubmit(result.userMessage, gateFallback);
      }
      stampFactoryPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: FACTORY_PLATFORM,
      });
      if (!result.ok) {
        stampFactoryPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return injectNeedPickContext(
            result.userMessage,
            result.candidates,
          );
        }
        return blockSubmit(result.userMessage, gateFallback);
      }
      stampFactoryPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig, platform: FACTORY_PLATFORM },
      );
      if (!result.ok) {
        stampFactoryPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return injectNeedPickContext(
            result.userMessage,
            result.candidates,
          );
        }
        return blockSubmit(result.userMessage, gateFallback);
      }
      stampFactoryPlatform(store, conversationId, projectRoot);
      return {};
    }
    return {};
  }

  // Stop reason may re-enter UPS as prompt — harness-owned: do not clear pending.
  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  stampFactoryPlatform(store, conversationId, projectRoot);
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
      FACTORY_PLATFORM,
    );
  }
  stampFactoryPlatform(store, conversationId, projectRoot);
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

/**
 * PostToolUse → markCodeEdited for Create / Edit / ApplyPatch.
 * Observe/arm only — never decision:block (would feed reason back to Droid).
 */
export function handlePostToolUse(
  store: StateStore,
  payload: FactoryEditPayload,
  projectRoot: string,
): void {
  try {
    handlePostToolUseInner(store, payload, projectRoot);
  } catch {
    /* fail-open */
  }
}

export const handleFactoryPostToolUse = handlePostToolUse;

function handlePostToolUseInner(
  store: StateStore,
  payload: FactoryEditPayload,
  projectRoot: string,
): void {
  const conversationId = sid(payload);
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  if (!conversationId || !isFactoryEditTool(toolName)) return;

  const filePaths = filePathsFromFactoryEdit(payload);
  if (filePaths.length === 0) {
    stampFactoryPlatform(store, conversationId, projectRoot);
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
    stampFactoryPlatform(store, conversationId, projectRoot);
  }
}

/**
 * Stop → ReviewEngine.
 * Continue: decision:block + reason.
 * When FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE is false (degraded):
 * allow stop if stop_hook_active (≤1 continue / natural Stop).
 */
export function handleStop(
  engine: ReviewEngine,
  payload: FactoryStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): FactoryStopResult {
  try {
    return handleStopInner(engine, payload, opts);
  } catch {
    return {};
  }
}

export const handleFactoryStop = handleStop;

function handleStopInner(
  engine: ReviewEngine,
  payload: FactoryStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): FactoryStopResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  if (!isFactoryStopCompletionReason(payload)) {
    return {};
  }

  // Degraded ≤1: yield when already continuing from a prior Stop block.
  if (shouldYieldFactoryStopWhenActive(payload)) {
    return {};
  }

  const status = normalizeFactoryStopStatus(payload, opts);

  const transcriptRaw = payload.transcript_path ?? payload.transcriptPath;
  const transcriptTrimmed =
    typeof transcriptRaw === "string" ? transcriptRaw.trim() : "";
  const transcriptPath =
    transcriptTrimmed && !/[\0\r\n]/.test(transcriptTrimmed)
      ? transcriptTrimmed
      : undefined;

  const action: FollowupAction | null = engine.handleStop({
    conversationId,
    status,
    loopCount: loopCountFromStopHookActive(payload),
    transcriptPath,
    platform: FACTORY_PLATFORM,
  });

  if (!action?.message) return {};

  const reason = clipText(
    blockReason(action.message, "Autopilot followup"),
    MAX_HOOK_STDIO_CHARS,
  );

  if (!action.loop) {
    // Hard-stop (stuck / deliver-once): continue:false + stopReason so the tip
    // still reaches Droid. Do not use decision:block (would request another turn).
    // True allow / no-followup stays {} → runner empty-body (Silence).
    return {
      continue: false,
      stopReason: reason,
    };
  }

  return {
    decision: "block",
    reason,
  };
}
