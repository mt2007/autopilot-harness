import {
  applyOff,
  applyOn,
  applyResume,
  applyResumeReview,
  isHarnessFollowupMessage,
  isProductCodeEdit,
  parseTrigger,
  ReviewEngine,
  StateStore,
  type FollowupAction,
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

function cid(p: { conversation_id?: string; conversationId?: string }): string {
  return (p.conversation_id ?? p.conversationId ?? "").trim();
}

export function handleBeforeSubmitPrompt(
  store: StateStore,
  payload: CursorSubmitPayload,
  projectRoot: string,
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
    // run / replan / track_pick handled by higher-level init wiring later
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
