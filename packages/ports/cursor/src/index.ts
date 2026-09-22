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
  extractParentConversationId,
  firstUnchecked,
  isChannelANeedPick,
  isHarnessFollowupMessage,
  isProductCodeEdit,
  isRecoverOrStuckFollowupMessage,
  isUserAbortText,
  loadProjectHookConfig,
  loadProjectReviewConfig,
  notePlansDirEdit,
  parseAdvanceNextItemId,
  parseChecklist,
  parseTrigger,
  resolveEditArmTarget,
  resolveSubagentStopArmTarget,
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
  /** When set, arm the parent session if it already exists (exist-only). */
  parent_conversation_id?: string;
  parentConversationId?: string;
  parent_session_id?: string;
  parentSessionId?: string;
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

/** Cursor subagentStop — arm parent only; never continue / followup. */
export interface CursorSubagentStopPayload {
  conversation_id?: string;
  conversationId?: string;
  parent_conversation_id?: string;
  parentConversationId?: string;
  parent_session_id?: string;
  parentSessionId?: string;
  modified_files?: string[];
  modifiedFiles?: string[];
  status?: string;
  subagent_id?: string;
  subagentId?: string;
  subagent_type?: string;
  subagentType?: string;
}

export interface CursorPortConfig {
  phaseActions?: PhaseActionConfig;
}

/** Cursor beforeSubmitPrompt stdout — snake_case user_message is the host contract. */
export type CursorSubmitResult = {
  continue: boolean;
  user_message?: string;
  /** Dual-key for older readers; prefer user_message. */
  userMessage?: string;
};

/** @internal Empty/blank/non-string → stable toast; never omit a visible block reason. */
export function normalizeBlockSubmitMessage(message: unknown): string {
  return typeof message === "string" && message.trim().length > 0
    ? message
    : "Request blocked.";
}

function blockSubmit(message: string): CursorSubmitResult {
  // Cursor host contract: snake_case `user_message` on blocked submits.
  // Keep camelCase dual-key for older readers; never omit snake_case.
  const text = normalizeBlockSubmitMessage(message);
  return {
    continue: false,
    user_message: text,
    userMessage: text,
  };
}

function allowSubmit(): CursorSubmitResult {
  return { continue: true };
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
): CursorSubmitResult {
  const conversationId = cid(payload);
  if (!conversationId) return allowSubmit();

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
      return allowSubmit();
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
      });
      if (!result.ok) {
        return blockSubmit(result.userMessage);
      }
      return allowSubmit();
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug,
      });
      if (!result.ok) {
        return blockSubmit(result.userMessage);
      }
      return allowSubmit();
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      return allowSubmit();
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
      });
      if (!result.ok) {
        // Channel A only when needPick and not busy (busy-keep-block).
        // Busy / hard fail → channel C; never continue:true for visibility.
        if (isChannelANeedPick(result)) {
          return allowSubmit();
        }
        return blockSubmit(result.userMessage);
      }
      return allowSubmit();
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
      });
      if (!result.ok) {
        // Keep REPLAN needPick as block for now (OOS to align with RUN channel A).
        return blockSubmit(result.userMessage);
      }
      return allowSubmit();
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
        if (isChannelANeedPick(result)) {
          return allowSubmit();
        }
        return blockSubmit(result.userMessage);
      }
      return allowSubmit();
    }
    return allowSubmit();
  }

  // E8: non-harness user message clears chain_pending; keep fix/confirm pending
  // for lens redelivery (recover/stuck already cleared above).
  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  return allowSubmit();
}

export function handleAfterFileEdit(
  store: StateStore,
  payload: CursorEditPayload,
  projectRoot: string,
): void {
  const conversationId = cid(payload);
  const filePath = payload.file_path ?? payload.filePath ?? "";
  if (!conversationId || !filePath) return;

  // bind-plans-dedicated-path: independent of isProductCodeEdit (plans/** ignored).
  try {
    const hookCfg = loadProjectHookConfig(projectRoot);
    notePlansDirEdit(
      store,
      conversationId,
      projectRoot,
      filePath,
      hookCfg.plansDir,
    );
  } catch {
    /* best-effort */
  }

  if (!isProductCodeEdit(filePath, { projectRoot })) return;

  const arm = resolveEditArmTarget(store, {
    conversationId,
    parentConversationId: extractParentConversationId(payload),
  });
  if (arm.kind === "noop") return;

  const armCid = arm.conversationId;
  const cfg = loadProjectReviewConfig(projectRoot);
  // Ambient create only for self (no distinct parent). Never invent a missing parent.
  if (arm.kind === "self" && cfg.reviewScope === "project") {
    ensureAmbientReviewSession(
      store,
      armCid,
      projectRoot,
      cfg.reviewScope,
    );
  }
  const session = store.getSession(armCid);
  const checklistPath = session?.checklist_path?.trim() ?? "";
  let checklistSnap: ReturnType<typeof parseChecklist> | null = null;
  if (checklistPath) {
    try {
      checklistSnap = parseChecklist(checklistPath, { projectRoot });
    } catch {
      /* checklist unreadable — still arm code_edited */
    }
  }
  store.markCodeEdited(armCid, (chain) => {
    // Live pending under lock; checklist snapshot is best-effort from outside.
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

/**
 * Cursor `subagentStop` → arm existing parent only (no followup / no block-continue).
 * Fail-open: any error → `{}`. Review continues on parent `stop`.
 */
export function handleSubagentStop(
  store: StateStore,
  payload: CursorSubagentStopPayload,
  projectRoot: string,
): Record<string, never> {
  try {
    // Host may deliver null / array / primitive — fail-open without throwing.
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return {};
    }
    const conversationId = cid(payload);
    const modifiedFiles = Array.isArray(payload.modified_files)
      ? payload.modified_files
      : Array.isArray(payload.modifiedFiles)
        ? payload.modifiedFiles
        : null;
    const target = resolveSubagentStopArmTarget(store, {
      conversationId,
      parentConversationId: extractParentConversationId(payload),
      projectRoot,
      modifiedFiles,
    });
    if (target.kind !== "parent") return {};

    const armCid = target.conversationId;
    const session = store.getSession(armCid);
    const checklistPath = session?.checklist_path?.trim() ?? "";
    let checklistSnap: ReturnType<typeof parseChecklist> | null = null;
    if (checklistPath) {
      try {
        checklistSnap = parseChecklist(checklistPath, { projectRoot });
      } catch {
        /* checklist unreadable — still arm code_edited */
      }
    }
    store.markCodeEdited(armCid, (chain) => {
      const fromPending = parseAdvanceNextItemId(chain.pending_followup);
      if (checklistSnap) {
        if (
          fromPending &&
          effectiveReviewingItemId(checklistSnap, fromPending)
        ) {
          return fromPending;
        }
        return firstUnchecked(checklistSnap)?.id ?? null;
      }
      return fromPending;
    });
  } catch {
    /* fail-open — never block / continue from subagentStop */
  }
  return {};
}
