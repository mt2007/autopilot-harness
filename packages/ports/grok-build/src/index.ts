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

/** Grok Build UserPromptSubmit stdin (camelCase + snake_case). */
export interface GrokSubmitPayload {
  session_id?: string;
  sessionId?: string;
  prompt?: string;
  /** Informational — store uses install-root projectRoot. */
  cwd?: string;
  workspaceRoot?: string;
  workspace_root?: string;
  transcript_path?: string;
  transcriptPath?: string;
  conversation_id?: string;
  conversationId?: string;
  permission_mode?: string;
  permissionMode?: string;
  promptId?: string;
  turn_id?: string;
  model?: string;
  hook_event_name?: string;
  hookEventName?: string;
}

/** Grok Build PostToolUse stdin. */
export interface GrokEditPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  workspaceRoot?: string;
  workspace_root?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown> | string;
  toolInput?: Record<string, unknown> | string;
}

/** Grok Build Stop stdin (no StopFailure / StopCancelled in this port). */
export interface GrokStopPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  workspaceRoot?: string;
  workspace_root?: string;
  transcript_path?: string;
  transcriptPath?: string;
  status?: string;
  stop_hook_active?: boolean;
  stopHookActive?: boolean;
  hook_event_name?: string;
  hookEventName?: string;
  last_assistant_message?: string;
  lastAssistantMessage?: string;
  turn_id?: string;
  promptId?: string;
  /** Gate only genuine completions (`end_turn`); session-end reasons must not continue. */
  reason?: unknown;
  error?: unknown;
  message?: unknown;
}

export interface GrokPortConfig {
  phaseActions?: PhaseActionConfig;
}

export const GROK_PLATFORM = "grok-build";

/**
 * Public research (2026-09): hard cap 8 Stop continuations / turn; no raise/disable
 * knob found. See plans/v0.6-grok-build/research-stop-cap.md.
 */
export const GROK_STOP_CAP_RAISE_FOUND = false;
/** Host per-turn Stop continue cap when raise is absent. */
export const GROK_STOP_PER_TURN_BLOCK_CAP = 8;

/**
 * PostToolUse matcher draft (Grok native + Claude aliases).
 * Live smoke may widen; dirty-arm covers shell edits.
 */
export const GROK_POST_TOOL_USE_MATCHER =
  "search_replace|Edit|Write|MultiEdit|write_file|WriteFile";

export const MAX_NEED_PICK_SLUGS = 40;
export const MAX_NEED_PICK_CONTEXT_CHARS = 2_000;
export const MAX_HOOK_STDIO_CHARS = 8_192;
export const MAX_TOOL_ARGS_JSON_CHARS = 1_048_576;

export interface GrokSubmitResult {
  decision?: "block";
  reason?: string;
}

export interface GrokStopResult {
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
 * Map stopHookActive → ReviewEngine loopCount.
 * true ⇒ already in auto-continuation chain this turn.
 */
export function loopCountFromStopHookActive(
  payload: GrokStopPayload,
): number {
  const active = payload.stop_hook_active ?? payload.stopHookActive;
  return active === true ? 1 : 0;
}

export function collectGrokStopErrorText(payload: GrokStopPayload): string {
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

export function normalizeGrokStopStatus(
  payload: GrokStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): "completed" | "error" | "aborted" {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return opts?.status ?? "completed";
  }
  const statusRaw = String(payload.status ?? "")
    .toLowerCase()
    .trim();
  const errText = collectGrokStopErrorText(payload);
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
 * Unknown or non-string reasons: do not continue (fail closed on continue).
 */
export function isGrokStopCompletionReason(payload: GrokStopPayload): boolean {
  const raw = payload?.reason;
  if (raw == null) return true;
  if (typeof raw !== "string") return false;
  const r = raw.trim().toLowerCase();
  if (!r) return true;
  if (r === "end_turn" || r === "endturn" || r === "completed") return true;
  // channel_closed / shutdown / anything else → do not continue
  return false;
}

/**
 * needPick / busy / hard-error body for UPS decision:block (user-visible).
 * Grok allowing UPS discards stdout — no additionalContext Channel A.
 */
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

/** UPS block result — preferred Grok channel for needPick / busy / hard errors. */
export function blockSubmit(
  userMessage: unknown,
  fallback: string,
): GrokSubmitResult {
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

function toolInputObject(
  payload: GrokEditPayload,
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

export function filePathsFromGrokEdit(payload: GrokEditPayload): string[] {
  const input = toolInputObject(payload);
  if (!input) return [];
  const candidates = [
    input.file_path,
    input.filePath,
    input.path,
    input.target_file,
    input.targetFile,
    input.notebook_path,
    input.notebookPath,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && !/[\0\r\n]/.test(c)) {
      return [c.trim()];
    }
  }
  return [];
}

/** File-mutating tools Autopilot arms (shell → dirty-arm on Stop). */
export function isGrokEditTool(toolName: string): boolean {
  const n = toolName.trim();
  return (
    n === "search_replace" ||
    n === "Edit" ||
    n === "Write" ||
    n === "MultiEdit" ||
    n === "write_file" ||
    n === "WriteFile"
  );
}

function stampGrokPlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  if (!session || session.platform === GROK_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: GROK_PLATFORM,
  });
}

/**
 * UserPromptSubmit → core triggers / FSM.
 * Allowing UPS stdout is discarded by Grok — ON/RUN success returns {}.
 * needPick / busy / hard errors → decision:block + reason (user-visible).
 * permission_mode is ignored (no auto-ON).
 */
export function handleUserPromptSubmit(
  store: StateStore,
  payload: GrokSubmitPayload,
  projectRoot: string,
  portConfig?: GrokPortConfig,
): GrokSubmitResult {
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

function handleUserPromptSubmitInner(
  store: StateStore,
  payload: GrokSubmitPayload,
  projectRoot: string,
  portConfig?: GrokPortConfig,
): GrokSubmitResult {
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
      stampGrokPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
        platform: GROK_PLATFORM,
      });
      if (!result.ok) {
        stampGrokPlatform(store, conversationId, projectRoot);
        return blockSubmit(result.userMessage, gateFallback);
      }
      stampGrokPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug,
      });
      if (!result.ok) {
        stampGrokPlatform(store, conversationId, projectRoot);
        return blockSubmit(result.userMessage, gateFallback);
      }
      stampGrokPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      stampGrokPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: GROK_PLATFORM,
      });
      if (!result.ok) {
        stampGrokPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return blockSubmit(
            buildNeedPickContext(result.userMessage, result.candidates),
            gateFallback,
          );
        }
        return blockSubmit(result.userMessage, gateFallback);
      }
      stampGrokPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: GROK_PLATFORM,
      });
      if (!result.ok) {
        stampGrokPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return blockSubmit(
            buildNeedPickContext(result.userMessage, result.candidates),
            gateFallback,
          );
        }
        return blockSubmit(result.userMessage, gateFallback);
      }
      stampGrokPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig, platform: GROK_PLATFORM },
      );
      if (!result.ok) {
        stampGrokPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return blockSubmit(
            buildNeedPickContext(result.userMessage, result.candidates),
            gateFallback,
          );
        }
        return blockSubmit(result.userMessage, gateFallback);
      }
      stampGrokPlatform(store, conversationId, projectRoot);
      return {};
    }
    return {};
  }

  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  stampGrokPlatform(store, conversationId, projectRoot);
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
      GROK_PLATFORM,
    );
  }
  stampGrokPlatform(store, conversationId, projectRoot);
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

/** PostToolUse → markCodeEdited for search_replace / Edit / Write / …. */
export function handlePostToolUse(
  store: StateStore,
  payload: GrokEditPayload,
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
  payload: GrokEditPayload,
  projectRoot: string,
): void {
  const conversationId = sid(payload);
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  if (!conversationId || !isGrokEditTool(toolName)) return;

  const filePaths = filePathsFromGrokEdit(payload);
  if (filePaths.length === 0) {
    stampGrokPlatform(store, conversationId, projectRoot);
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
    stampGrokPlatform(store, conversationId, projectRoot);
  }
}

/**
 * Stop → ReviewEngine.
 * Continue: decision:block + reason only (never also additionalContext).
 * Hard stop: continue:false when loop ends (Grok-supported).
 * Host caps ≤8/turn when GROK_STOP_CAP_RAISE_FOUND is false.
 */
export function handleStop(
  engine: ReviewEngine,
  payload: GrokStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): GrokStopResult {
  try {
    return handleStopInner(engine, payload, opts);
  } catch {
    return {};
  }
}

function handleStopInner(
  engine: ReviewEngine,
  payload: GrokStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): GrokStopResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  if (!isGrokStopCompletionReason(payload)) {
    return {};
  }

  const status = normalizeGrokStopStatus(payload, opts);

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
    platform: GROK_PLATFORM,
  });

  if (!action?.message) return {};

  const reason = clipText(
    blockReason(action.message, "Autopilot followup"),
    MAX_HOOK_STDIO_CHARS,
  );

  if (!action.loop) {
    return { continue: false, stopReason: reason };
  }

  return {
    decision: "block",
    reason,
  };
}
