import {
  applyOff,
  applyOn,
  applyReplan,
  applyResume,
  applyResumeReview,
  applyRun,
  applyTrackPick,
  ensureAmbientReviewSession,
  isHarnessFollowupMessage,
  isProductCodeEdit,
  isRecoverOrStuckFollowupMessage,
  isUserAbortText,
  loadProjectReviewConfig,
  parseTrigger,
  ReviewEngine,
  StateStore,
  type FollowupAction,
  type PhaseActionConfig,
} from "@autopilot-harness/core";

export interface CursorSubmitPayload {
  conversation_id?: string;
  conversationId?: string;
  prompt?: string;
  content?: string;
  workspace_roots?: string[];
  session_title?: string;
}

export interface CursorEditPayload {
  conversation_id?: string;
  conversationId?: string;
  file_path?: string;
  filePath?: string;
}

export interface CursorStopPayload {
  conversation_id?: string;
  conversationId?: string;
  status?: string;
  loop_count?: number;
  loopCount?: number;
  transcript_path?: string;
  transcriptPath?: string;
  /** Host error / abort detail (Cursor may put user-stop text here). */
  error?: unknown;
  message?: unknown;
  status_message?: unknown;
  reason?: unknown;
  detail?: unknown;
  title?: unknown;
}

export interface CursorPortConfig {
  phaseActions?: PhaseActionConfig;
}

function cid(p: { conversation_id?: string; conversationId?: string }): string {
  return (p.conversation_id ?? p.conversationId ?? "").trim();
}

/** Flatten common Cursor stop error fields for abort-marker checks. */
export function collectStopErrorText(payload: CursorStopPayload): string {
  if (!payload || typeof payload !== "object") return "";
  const MAX_CHARS = 8_192;
  const parts: string[] = [];
  try {
    const push = (value: unknown) => {
      if (typeof value === "string" && value.trim()) {
        parts.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 8)) {
          if (typeof item === "string" && item.trim()) parts.push(item);
        }
        return;
      }
      if (value && typeof value === "object") {
        const o = value as Record<string, unknown>;
        for (const key of ["message", "error", "name", "stack", "detail", "title"]) {
          const nested = o[key];
          if (typeof nested === "string" && nested.trim()) parts.push(nested);
        }
      }
    };
    push(payload.error);
    push(payload.message);
    push(payload.status_message);
    push(payload.reason);
    push(payload.detail);
    push(payload.title);
  } catch {
    return "";
  }
  const joined = parts.join("\n");
  return joined.length > MAX_CHARS ? joined.slice(0, MAX_CHARS) : joined;
}

/**
 * Map host stop status → engine status.
 * User Stop is often `aborted` / `cancelled`; Cursor may also send `error` with
 * abort markers — those must not inject recover.
 */
export function normalizeCursorStopStatus(
  payload: CursorStopPayload,
): "completed" | "error" | "aborted" {
  if (!payload || typeof payload !== "object") return "completed";
  const statusRaw = String(payload.status ?? "completed").toLowerCase().trim();
  const errText = collectStopErrorText(payload);
  if (
    statusRaw === "aborted" ||
    statusRaw === "cancelled" ||
    statusRaw === "canceled"
  ) {
    return "aborted";
  }
  if (statusRaw === "error" || statusRaw === "failed") {
    if (isUserAbortText(errText)) return "aborted";
    return "error";
  }
  return "completed";
}

export function handleBeforeSubmitPrompt(
  store: StateStore,
  payload: CursorSubmitPayload,
  projectRoot: string,
  portConfig?: CursorPortConfig,
): { continue: boolean; userMessage?: string } {
  const conversationId = cid(payload);
  if (!conversationId) return { continue: true };

  const prompt = payload.prompt ?? payload.content ?? "";

  // Any user submit (ordinary chat, triggers, or a just-delivered recover) must
  // drop recover/stuck pending. Trigger handlers return early and used to skip
  // this — RESUME/RUN-same-track then redelivered「恢复：上一回合出错」after revert.
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

  if (trigger) {
    if (trigger.kind === "off") {
      applyOff(store, conversationId);
      return { continue: true };
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
      });
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    if (trigger.kind === "resume") {
      applyResume(store, conversationId);
      return { continue: true };
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      return { continue: true };
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
      });
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
      });
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig },
      );
      if (!result.ok) {
        return { continue: false, userMessage: result.userMessage };
      }
      return { continue: true };
    }
    return { continue: true };
  }

  // E8: non-harness user message clears chain_pending; keep fix/confirm pending
  // for lens redelivery (recover/stuck already cleared above).
  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  return { continue: true };
}

export function handleAfterFileEdit(
  store: StateStore,
  payload: CursorEditPayload,
  projectRoot: string,
): void {
  const conversationId = cid(payload);
  const filePath = payload.file_path ?? payload.filePath ?? "";
  if (!conversationId || !filePath) return;
  if (!isProductCodeEdit(filePath)) return;
  const cfg = loadProjectReviewConfig(projectRoot);
  if (cfg.reviewScope === "project") {
    ensureAmbientReviewSession(
      store,
      conversationId,
      projectRoot,
      cfg.reviewScope,
    );
  }
  store.markCodeEdited(conversationId);
}

export function handleStop(
  engine: ReviewEngine,
  payload: CursorStopPayload,
): { followup_message?: string; loop?: true } {
  const conversationId = cid(payload);
  if (!conversationId) return {};

  const status = normalizeCursorStopStatus(payload);
  const loopCount = payload.loop_count ?? payload.loopCount ?? 0;
  const transcriptPath = payload.transcript_path ?? payload.transcriptPath;

  const action: FollowupAction | null = engine.handleStop({
    conversationId,
    status,
    loopCount,
    transcriptPath,
  });

  if (!action) return {};
  // Honor loop:false (e.g. pause-threshold upsert failed → stuck halt text).
  if (!action.loop) {
    return { followup_message: action.message };
  }
  return { followup_message: action.message, loop: true };
}
