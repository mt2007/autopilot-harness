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

/** Gemini BeforeAgent stdin (camelCase + snake_case). */
export interface GeminiSubmitPayload {
  session_id?: string;
  sessionId?: string;
  prompt?: string;
  cwd?: string;
  transcript_path?: string;
  transcriptPath?: string;
  hook_event_name?: string;
  hookEventName?: string;
  timestamp?: string;
  conversation_id?: string;
  conversationId?: string;
}

/** Gemini AfterTool stdin. */
export interface GeminiEditPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown> | string;
  toolInput?: Record<string, unknown> | string;
  tool_response?: Record<string, unknown>;
  toolResponse?: Record<string, unknown>;
  hook_event_name?: string;
  hookEventName?: string;
}

/** Gemini AfterAgent stdin. */
export interface GeminiStopPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  transcript_path?: string;
  transcriptPath?: string;
  prompt?: string;
  prompt_response?: string;
  promptResponse?: string;
  stop_hook_active?: boolean;
  stopHookActive?: boolean;
  hook_event_name?: string;
  hookEventName?: string;
  timestamp?: string;
  status?: string;
  error?: unknown;
  message?: unknown;
  reason?: unknown;
}

export interface GeminiPortConfig {
  phaseActions?: PhaseActionConfig;
}

export const GEMINI_PLATFORM = "gemini-cli";

/**
 * Public research (2026-09): MAX_TURNS=100 shared with AfterAgent retries;
 * no raise knob. See plans/v0.7-gemini-cli/research-stop-cap.md.
 */
export const GEMINI_STOP_CAP_RAISE_FOUND = false;
/** Host turn budget (MAX_TURNS) shared with AfterAgent deny→retry. */
export const GEMINI_AFTER_AGENT_TURN_CAP = 100;
/** Soft doctor tip — CLI with stopHookActive retry fix (#20439 era). */
export const GEMINI_MIN_CLI_VERSION_HINT = "0.31.0";

/**
 * AfterTool matcher draft (Gemini built-in edit tools).
 * Live smoke may widen; ReviewEngine dirty-arm covers shell edits on Stop.
 */
export const GEMINI_AFTER_TOOL_MATCHER = "write_file|replace";

export const MAX_NEED_PICK_SLUGS = 40;
export const MAX_NEED_PICK_CONTEXT_CHARS = 2_000;
export const MAX_HOOK_STDIO_CHARS = 8_192;
export const MAX_TOOL_ARGS_JSON_CHARS = 1_048_576;

/** BeforeAgent stdout — emit deny or inject; never primary `block` / clearContext. */
export interface GeminiSubmitResult {
  decision?: "deny" | "allow";
  reason?: string;
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
  };
}

/**
 * AfterAgent stdout — continue with deny+reason; hard-stop with continue:false.
 * Do not put clearContext on this type (Autopilot must never clear LLM memory).
 */
export interface GeminiStopResult {
  decision?: "deny" | "allow";
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
      // Align with StateStore.isInvalidConversationId — reject C0/DEL so we
      // fail-soft as {} instead of throw→catch false-success mid-mutation.
      if (t && !/[\u0000-\u001f\u007f]/.test(t)) return t;
    }
  }
  return "";
}

function clipText(text: string, max = MAX_HOOK_STDIO_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function denyReason(message: string | undefined, fallback: string): string {
  const m = typeof message === "string" ? message.trim() : "";
  return m || fallback;
}

/**
 * Map stop_hook_active → ReviewEngine loopCount.
 * true ⇒ already in AfterAgent retry chain this turn.
 */
export function loopCountFromStopHookActive(
  payload: GeminiStopPayload,
): number {
  const active = payload.stop_hook_active ?? payload.stopHookActive;
  return active === true ? 1 : 0;
}

export function collectGeminiStopErrorText(payload: GeminiStopPayload): string {
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

export function normalizeGeminiStopStatus(
  payload: GeminiStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): "completed" | "error" | "aborted" {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return opts?.status ?? "completed";
  }
  const statusRaw = String(payload.status ?? "")
    .toLowerCase()
    .trim();
  const errText = collectGeminiStopErrorText(payload);
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
  // AfterAgent fires after a finished response — default completed.
  return "completed";
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

/** Prefer Channel A inject (writing-hooks shape with hookEventName). */
export function injectNeedPickContext(
  userMessage: unknown,
  candidates?: ReadonlyArray<{ slug?: string }>,
): GeminiSubmitResult {
  const ctx = buildNeedPickContext(userMessage, candidates);
  return {
    hookSpecificOutput: {
      hookEventName: "BeforeAgent",
      additionalContext: ctx,
    },
  };
}

/** Fallback: deny discards user message (user re-submits with slug). */
export function denySubmit(
  userMessage: unknown,
  fallback: string,
): GeminiSubmitResult {
  return {
    decision: "deny",
    reason: clipText(
      denyReason(
        typeof userMessage === "string" ? userMessage : undefined,
        fallback,
      ),
      MAX_NEED_PICK_CONTEXT_CHARS + 256,
    ),
  };
}

function toolInputObject(
  payload: GeminiEditPayload,
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

export function filePathsFromGeminiEdit(payload: GeminiEditPayload): string[] {
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

/** File-mutating tools Autopilot arms (shell → ReviewEngine dirty-arm on Stop). */
export function isGeminiEditTool(toolName: string): boolean {
  const n = toolName.trim();
  return n === "write_file" || n === "replace";
}

function stampGeminiPlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  if (!session || session.platform === GEMINI_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: GEMINI_PLATFORM,
  });
}

/**
 * BeforeAgent → core triggers / FSM.
 * Success allow → {} (Silence). Prefer inject for needPick; fallback deny.
 * Harness followups (AfterAgent reason re-entry): no ON/RUN; do not clear pending.
 */
export function handleUserPromptSubmit(
  store: StateStore,
  payload: GeminiSubmitPayload,
  projectRoot: string,
  portConfig?: GeminiPortConfig,
): GeminiSubmitResult {
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

/** Aliased export for vendor (never collide with Claude bare names). */
export const handleGeminiUserPromptSubmit = handleUserPromptSubmit;

function handleUserPromptSubmitInner(
  store: StateStore,
  payload: GeminiSubmitPayload,
  projectRoot: string,
  portConfig?: GeminiPortConfig,
): GeminiSubmitResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  // Never trust process.cwd alone — projectRoot is install-root from hook runner.
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
      stampGeminiPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
        platform: GEMINI_PLATFORM,
      });
      if (!result.ok) {
        stampGeminiPlatform(store, conversationId, projectRoot);
        return denySubmit(result.userMessage, gateFallback);
      }
      stampGeminiPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug,
      });
      if (!result.ok) {
        stampGeminiPlatform(store, conversationId, projectRoot);
        return denySubmit(result.userMessage, gateFallback);
      }
      stampGeminiPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      stampGeminiPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: GEMINI_PLATFORM,
      });
      if (!result.ok) {
        stampGeminiPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return injectNeedPickContext(
            result.userMessage,
            result.candidates,
          );
        }
        return denySubmit(result.userMessage, gateFallback);
      }
      stampGeminiPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: GEMINI_PLATFORM,
      });
      if (!result.ok) {
        stampGeminiPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return injectNeedPickContext(
            result.userMessage,
            result.candidates,
          );
        }
        return denySubmit(result.userMessage, gateFallback);
      }
      stampGeminiPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig, platform: GEMINI_PLATFORM },
      );
      if (!result.ok) {
        stampGeminiPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return injectNeedPickContext(
            result.userMessage,
            result.candidates,
          );
        }
        return denySubmit(result.userMessage, gateFallback);
      }
      stampGeminiPlatform(store, conversationId, projectRoot);
      return {};
    }
    return {};
  }

  // AfterAgent reason re-enters BeforeAgent as prompt — treat harness followups
  // as owned (do not clear pending/chain). Do not use AfterAgent.prompt here.
  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  stampGeminiPlatform(store, conversationId, projectRoot);
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
      GEMINI_PLATFORM,
    );
  }
  stampGeminiPlatform(store, conversationId, projectRoot);
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

/** AfterTool → markCodeEdited for write_file / replace only (never deny/hide). */
export function handlePostToolUse(
  store: StateStore,
  payload: GeminiEditPayload,
  projectRoot: string,
): void {
  try {
    handlePostToolUseInner(store, payload, projectRoot);
  } catch {
    /* fail-open */
  }
}

export const handleGeminiPostToolUse = handlePostToolUse;

function handlePostToolUseInner(
  store: StateStore,
  payload: GeminiEditPayload,
  projectRoot: string,
): void {
  const conversationId = sid(payload);
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  if (!conversationId || !isGeminiEditTool(toolName)) return;

  const filePaths = filePathsFromGeminiEdit(payload);
  if (filePaths.length === 0) {
    stampGeminiPlatform(store, conversationId, projectRoot);
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
    stampGeminiPlatform(store, conversationId, projectRoot);
  }
}

/**
 * AfterAgent → ReviewEngine.
 * Continue: decision:deny + reason (primary; never clearContext; never primary block).
 * Hard stop: continue:false + stopReason.
 * Multi-deny across stop_hook_active=true until FSM done.
 * Dirty-arm for shell edits is inside ReviewEngine.handleStop.
 */
export function handleStop(
  engine: ReviewEngine,
  payload: GeminiStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): GeminiStopResult {
  try {
    return handleStopInner(engine, payload, opts);
  } catch {
    return {};
  }
}

export const handleGeminiStop = handleStop;

function handleStopInner(
  engine: ReviewEngine,
  payload: GeminiStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): GeminiStopResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  const status = normalizeGeminiStopStatus(payload, opts);

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
    platform: GEMINI_PLATFORM,
  });

  if (!action?.message) return {};

  const reason = clipText(
    denyReason(action.message, "Autopilot followup"),
    MAX_HOOK_STDIO_CHARS,
  );

  if (!action.loop) {
    return { continue: false, stopReason: reason };
  }

  // Primary continue channel — never emit clearContext; never prefer block.
  return {
    decision: "deny",
    reason,
  };
}
