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
  isHarnessFollowupMessage,
  isProductCodeEdit,
  isRecoverOrStuckFollowupMessage,
  loadProjectReviewConfig,
  parseAdvanceNextItemId,
  parseChecklist,
  parseTrigger,
  type FollowupAction,
  type PhaseActionConfig,
  type ReviewEngine,
  type StateStore,
} from "@autopilot-harness/core";

/** Claude Code UserPromptSubmit (and compatible) stdin fields. */
export interface ClaudeSubmitPayload {
  session_id?: string;
  sessionId?: string;
  prompt?: string;
  /** Session cwd from Claude (informational). Store/checklist always use install root. */
  cwd?: string;
  transcript_path?: string;
  transcriptPath?: string;
  /** Some hosts may still send Cursor-shaped ids. */
  conversation_id?: string;
  conversationId?: string;
}

/** Claude Code PostToolUse stdin (Edit / Write / NotebookEdit). */
export interface ClaudeEditPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown>;
  toolInput?: Record<string, unknown>;
}

/** Claude Code Stop / StopFailure stdin. */
export interface ClaudeStopPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  transcript_path?: string;
  transcriptPath?: string;
  /** True when this stop is already a stop-hook continuation. */
  stop_hook_active?: boolean;
  stopHookActive?: boolean;
  hook_event_name?: string;
  hookEventName?: string;
  last_assistant_message?: string;
  /** StopFailure may carry error detail. */
  error?: unknown;
  message?: unknown;
  reason?: unknown;
}

export interface ClaudePortConfig {
  phaseActions?: PhaseActionConfig;
}

const CLAUDE_PLATFORM = "claude-code";

/** Claude UserPromptSubmit / decision-control stdout. */
export interface ClaudeSubmitResult {
  decision?: "block";
  reason?: string;
  continue?: boolean;
  stopReason?: string;
  hookSpecificOutput?: {
    hookEventName: "UserPromptSubmit";
    additionalContext?: string;
  };
}

/** Claude Stop / StopFailure stdout. */
export interface ClaudeStopResult {
  decision?: "block";
  reason?: string;
  continue?: boolean;
  stopReason?: string;
  hookSpecificOutput?: {
    hookEventName: "Stop" | "StopFailure";
    additionalContext?: string;
  };
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
 * Map Claude stop_hook_active → ReviewEngine loopCount.
 * true ⇒ in auto-continuation chain (same role as Cursor loop_count > 0).
 */
export function loopCountFromStopHookActive(
  payload: ClaudeStopPayload,
): number {
  const active = payload.stop_hook_active ?? payload.stopHookActive;
  return active === true ? 1 : 0;
}

/** Non-empty reason required by Claude when decision is "block". */
function blockReason(message: string | undefined, fallback: string): string {
  const m = typeof message === "string" ? message.trim() : "";
  return m || fallback;
}

/** Extract edited file path from PostToolUse tool_input. */
export function filePathFromClaudeEdit(
  payload: ClaudeEditPayload,
): string {
  const input = payload.tool_input ?? payload.toolInput ?? {};
  // Reject null / arrays / non-objects (hostile or malformed PostToolUse).
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const candidates = [
    input.file_path,
    input.filePath,
    input.notebook_path,
    input.notebookPath,
    input.path,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

/** Whether this PostToolUse tool should arm product-edit detection. */
export function isClaudeEditTool(toolName: string): boolean {
  const n = toolName.trim();
  return n === "Edit" || n === "Write" || n === "NotebookEdit";
}

/** Persist host id on the session row (core defaults to "cursor"). */
function stampClaudePlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  // Raw equality so mixed-case / scrubbed hosts still get canonicalized.
  if (!session || session.platform === CLAUDE_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: CLAUDE_PLATFORM,
  });
}

/**
 * UserPromptSubmit → core triggers / fail-closed.
 * Fail-closed uses Claude `decision: "block"` (erases prompt) + `reason`.
 */
export function handleUserPromptSubmit(
  store: StateStore,
  payload: ClaudeSubmitPayload,
  projectRoot: string,
  portConfig?: ClaudePortConfig,
): ClaudeSubmitResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  // Always use install-root projectRoot from the hook (like Cursor). Never
  // trust payload.cwd — a subdirectory or hostile cwd would mis-bind state.db.
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
  const trigger = parseTrigger({
    prompt,
    conversationId,
    projectRoot,
    pendingAction: session?.pending_action,
  });

  const actionConfig = portConfig?.phaseActions;
  const gateFallback =
    "Autopilot rejected this prompt. Check `npx autopilot-harness status`.";

  if (trigger) {
    if (trigger.kind === "off") {
      applyOff(store, conversationId);
      stampClaudePlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
        platform: CLAUDE_PLATFORM,
      });
      if (!result.ok) {
        stampClaudePlatform(store, conversationId, projectRoot);
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
        stampClaudePlatform(store, conversationId, projectRoot);
        return {
          decision: "block",
          reason: blockReason(result.userMessage, gateFallback),
        };
      }
      stampClaudePlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      stampClaudePlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: CLAUDE_PLATFORM,
      });
      if (!result.ok) {
        stampClaudePlatform(store, conversationId, projectRoot);
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
        platform: CLAUDE_PLATFORM,
      });
      if (!result.ok) {
        stampClaudePlatform(store, conversationId, projectRoot);
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
        { config: actionConfig, platform: CLAUDE_PLATFORM },
      );
      if (!result.ok) {
        stampClaudePlatform(store, conversationId, projectRoot);
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
  stampClaudePlatform(store, conversationId, projectRoot);
  return {};
}

/** PostToolUse (Edit|Write|NotebookEdit) → markCodeEdited. */
export function handlePostToolUse(
  store: StateStore,
  payload: ClaudeEditPayload,
  projectRoot: string,
): void {
  const conversationId = sid(payload);
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  if (!conversationId || !isClaudeEditTool(toolName)) return;

  const filePath = filePathFromClaudeEdit(payload);
  if (!filePath) return;

  if (!isProductCodeEdit(filePath, { projectRoot })) return;

  const cfg = loadProjectReviewConfig(projectRoot);
  if (cfg.reviewScope === "project") {
    ensureAmbientReviewSession(
      store,
      conversationId,
      projectRoot,
      cfg.reviewScope,
      CLAUDE_PLATFORM,
    );
  }
  stampClaudePlatform(store, conversationId, projectRoot);
  const session = store.getSession(conversationId);
  const checklistPath = session?.checklist_path?.trim() ?? "";
  let checklistSnap: ReturnType<typeof parseChecklist> | null = null;
  if (checklistPath) {
    try {
      checklistSnap = parseChecklist(checklistPath, { projectRoot });
    } catch {
      /* checklist unreadable — still arm code_edited */
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
 * Stop / StopFailure → ReviewEngine.
 * Continuing followups use decision:block + reason (Autopilot chain text).
 * No followup → {}.
 */
export function handleStop(
  engine: ReviewEngine,
  payload: ClaudeStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): ClaudeStopResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  const hookName = String(
    payload.hook_event_name ?? payload.hookEventName ?? "",
  ).trim();
  const status: "completed" | "error" | "aborted" =
    opts?.status ??
    (hookName === "StopFailure" ? "error" : "completed");

  const transcriptRaw =
    payload.transcript_path ?? payload.transcriptPath;
  const transcriptPath =
    typeof transcriptRaw === "string" && transcriptRaw.trim()
      ? transcriptRaw.trim()
      : undefined;

  const action: FollowupAction | null = engine.handleStop({
    conversationId,
    status,
    loopCount: loopCountFromStopHookActive(payload),
    transcriptPath,
    platform: CLAUDE_PLATFORM,
  });

  if (!action?.message) return {};

  const reason = blockReason(action.message, "Autopilot followup");

  // loop:false = deliver once without requesting another agent turn (e.g.
  // stuck after pause-threshold upsert failed). decision:block would keep
  // continuing — disastrous with CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0.
  if (!action.loop) {
    return { continue: false, stopReason: reason };
  }

  return {
    decision: "block",
    reason,
  };
}

/** Convenience: StopFailure event → handleStop(status=error). */
export function handleStopFailure(
  engine: ReviewEngine,
  payload: ClaudeStopPayload,
): ClaudeStopResult {
  return handleStop(engine, payload, { status: "error" });
}
