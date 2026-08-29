import {
  applyOff,
  applyOn,
  applyReplan,
  applyResume,
  applyResumeReview,
  applyRun,
  applyTrackPick,
  isHarnessFollowupMessage,
  isProductCodeEdit,
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
}

export interface CursorPortConfig {
  phaseActions?: PhaseActionConfig;
}

function cid(p: { conversation_id?: string; conversationId?: string }): string {
  return (p.conversation_id ?? p.conversationId ?? "").trim();
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

  // E8: non-harness user message clears chain_pending only
  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  return { continue: true };
}

export function handleAfterFileEdit(
  store: StateStore,
  payload: CursorEditPayload,
): void {
  const conversationId = cid(payload);
  const filePath = payload.file_path ?? payload.filePath ?? "";
  if (!conversationId || !filePath) return;
  if (isProductCodeEdit(filePath)) {
    store.markCodeEdited(conversationId);
  }
}

export function handleStop(
  engine: ReviewEngine,
  payload: CursorStopPayload,
): { followup_message?: string; loop?: true } {
  const conversationId = cid(payload);
  if (!conversationId) return {};

  const statusRaw = payload.status ?? "completed";
  const status =
    statusRaw === "error" || statusRaw === "aborted" ? statusRaw : "completed";
  const loopCount = payload.loop_count ?? payload.loopCount ?? 0;

  const action: FollowupAction | null = engine.handleStop({
    conversationId,
    status,
    loopCount,
  });

  if (!action) return {};
  return { followup_message: action.message, loop: true };
}
