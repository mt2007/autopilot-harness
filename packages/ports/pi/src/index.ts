/**
 * @autopilot-harness/port-pi — in-process Pi extension adapters (no shell stdin stamp).
 * Research: plans/v0.14-pi/research-pi-hooks.md (Pi 0.85.1).
 */

import path from "node:path";
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
  type PhaseActionConfig,
  type ReviewEngine,
  type StateStore,
} from "@autopilot-harness/core";

export const PI_PLATFORM = "pi";
/** Soft doctor tip — probed API surface. */
export const PI_SOFT_MIN_VERSION = "0.85.1";
/** Pi package.json engines.node. */
export const PI_SOFT_MIN_NODE = "22.19.0";
/** sendMessage customType for Autopilot continue. */
export const PI_CONTINUE_CUSTOM_TYPE = "autopilot-harness";
/** Locked continue delivery (research). */
export const PI_CONTINUE_DELIVER = {
  deliverAs: "followUp" as const,
  triggerTurn: true as const,
};
/** Built-in edit tools that arm review (research). */
export const PI_EDIT_TOOLS = Object.freeze(["write", "edit"] as const);

export const MAX_NEED_PICK_SLUGS = 40;
export const MAX_NEED_PICK_CONTEXT_CHARS = 2_000;
export const MAX_HOOK_TEXT_CHARS = 8_192;
export const MAX_PI_PATH_CHARS = 4_096;
export const MAX_PI_PATHS = 256;

export interface PiPortConfig {
  phaseActions?: PhaseActionConfig;
}

/** Thin payload from Pi extension handlers (not shell stdin). */
export interface PiInputPayload {
  text?: string;
  /** Pi `input` event.source */
  source?: "interactive" | "rpc" | "extension" | string;
  sessionFile?: string | null;
  sessionId?: string | null;
  cwd?: string;
  mode?: "tui" | "rpc" | "json" | "print" | string;
}

export interface PiBeforeAgentStartPayload {
  prompt?: string;
  sessionFile?: string | null;
  sessionId?: string | null;
  cwd?: string;
  mode?: string;
}

export interface PiToolResultPayload {
  toolName?: string;
  tool_name?: string;
  input?: Record<string, unknown> | null;
  sessionFile?: string | null;
  sessionId?: string | null;
  cwd?: string;
}

export interface PiAgentSettledPayload {
  sessionFile?: string | null;
  sessionId?: string | null;
  cwd?: string;
  mode?: string;
}

export interface PiInputResult {
  /** Extension source / harness followup — skip ON/RUN / clear-pending. */
  harnessOwned?: boolean;
  /** Unsupported mode (print/json) — fail-open no-op tip for extension. */
  unsupportedMode?: boolean;
}

export interface PiSubmitResult {
  /** Inject via before_agent_start `message.content` (needPick / gate). */
  message?: string;
}

export interface PiSettledResult {
  /**
   * If set, extension MUST `pi.sendMessage` with PI_CONTINUE_DELIVER.
   * R1: only when Autopilot has a looping pending followup.
   * R9: extension must not call blocking ctx.ui on this path.
   */
  continueMessage?: string;
}

function clipText(text: string, max = MAX_HOOK_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function isSafePath(p: string): boolean {
  if (!p || p.length > MAX_PI_PATH_CHARS) return false;
  if (/[\u0000-\u001f\u007f]/.test(p)) return false;
  return true;
}

/**
 * R2 — Autopilot conversation_id.
 * `pi:<sessionFile ?? sessionId>`; empty if neither usable.
 */
export function buildPiConversationId(
  sessionFile?: string | null,
  sessionId?: string | null,
): string {
  const file =
    typeof sessionFile === "string" && sessionFile.trim()
      ? sessionFile.trim()
      : "";
  const id =
    typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : "";
  const raw = file || id;
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return "";
  return `pi:${raw}`;
}

export function conversationIdFromPiPayload(p: {
  sessionFile?: string | null;
  sessionId?: string | null;
}): string {
  return buildPiConversationId(p.sessionFile, p.sessionId);
}

export function isPiEditTool(toolName: string): boolean {
  const n = toolName.trim();
  return n === "write" || n === "edit";
}

export function isPiUnsupportedAutopilotMode(mode: unknown): boolean {
  return mode === "print" || mode === "json";
}

export function resolvePiWorkspaceRoot(opts: {
  installRoot?: string | null;
  cwd?: string | null;
}): string | null {
  for (const v of [opts.installRoot, opts.cwd]) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function stampPiPlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  if (!session || session.platform === PI_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: PI_PLATFORM,
  });
}

function blockReason(userMessage: unknown, fallback: string): string {
  if (typeof userMessage === "string" && userMessage.trim()) {
    return clipText(userMessage.trim());
  }
  return fallback;
}

export function buildNeedPickMessage(
  userMessage: unknown,
  candidates?: ReadonlyArray<{ slug?: string }>,
): string {
  const fromMessage =
    typeof userMessage === "string" && userMessage.trim()
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
      ? `[Autopilot] Select a plan to execute:\n\n${slugs
          .map((s, i) => `  ${i + 1}. ${s}`)
          .join("\n")}\n\nReply with a number or /autopilot-run <slug>.`
      : "[Autopilot] Select a plan to execute. Reply with a number or /autopilot-run <slug>.");

  if (ctx.length > MAX_NEED_PICK_CONTEXT_CHARS) {
    ctx = `${ctx.slice(0, MAX_NEED_PICK_CONTEXT_CHARS - 1)}…`;
  }
  return ctx;
}

function injectMessage(text: string): PiSubmitResult {
  const t = text.trim();
  if (!t) return {};
  return { message: clipText(t, MAX_NEED_PICK_CONTEXT_CHARS + 256) };
}

function gateMessage(userMessage: unknown, fallback: string): PiSubmitResult {
  return injectMessage(blockReason(userMessage, fallback));
}

/**
 * `input` event — R10 mode tip; harness-owned when source=extension or followup text.
 */
export function handlePiInput(
  store: StateStore,
  payload: PiInputPayload,
  projectRoot: string,
): PiInputResult {
  try {
    return handlePiInputInner(store, payload, projectRoot);
  } catch {
    return {};
  }
}

export const handlePiUserInput = handlePiInput;

function handlePiInputInner(
  store: StateStore,
  payload: PiInputPayload,
  projectRoot: string,
): PiInputResult {
  if (isPiUnsupportedAutopilotMode(payload.mode)) {
    return { unsupportedMode: true };
  }

  const conversationId = conversationIdFromPiPayload(payload);
  const text = typeof payload.text === "string" ? payload.text : "";

  if (payload.source === "extension" || isHarnessFollowupMessage(text)) {
    return { harnessOwned: true };
  }

  if (!conversationId) return {};

  try {
    store.clearPendingFollowupIf(
      conversationId,
      isRecoverOrStuckFollowupMessage,
    );
  } catch {
    /* best-effort */
  }

  stampPiPlatform(store, conversationId, projectRoot);
  return {};
}

/**
 * `before_agent_start` — ON/RUN triggers + inject guidance (cannot discard prompt).
 */
export function handlePiBeforeAgentStart(
  store: StateStore,
  payload: PiBeforeAgentStartPayload,
  projectRoot: string,
  portConfig?: PiPortConfig,
): PiSubmitResult {
  try {
    return handlePiBeforeAgentStartInner(
      store,
      payload,
      projectRoot,
      portConfig,
    );
  } catch {
    return {};
  }
}

export const handlePiSubmit = handlePiBeforeAgentStart;

function handlePiBeforeAgentStartInner(
  store: StateStore,
  payload: PiBeforeAgentStartPayload,
  projectRoot: string,
  portConfig?: PiPortConfig,
): PiSubmitResult {
  if (isPiUnsupportedAutopilotMode(payload.mode)) return {};

  const conversationId = conversationIdFromPiPayload(payload);
  if (!conversationId) return {};

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";

  // Continuations injected via sendMessage / sendUserMessage — harness-owned.
  if (isHarnessFollowupMessage(prompt)) {
    stampPiPlatform(store, conversationId, projectRoot);
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
    "[Autopilot] Rejected this prompt. Check `npx autopilot-harness status`.";

  if (trigger) {
    if (trigger.kind === "off") {
      applyOff(store, conversationId);
      stampPiPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
        platform: PI_PLATFORM,
      });
      stampPiPlatform(store, conversationId, projectRoot);
      if (!result.ok) return gateMessage(result.userMessage, gateFallback);
      return {};
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug,
      });
      stampPiPlatform(store, conversationId, projectRoot);
      if (!result.ok) return gateMessage(result.userMessage, gateFallback);
      return {};
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      stampPiPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: PI_PLATFORM,
      });
      stampPiPlatform(store, conversationId, projectRoot);
      if (!result.ok) {
        if (isChannelANeedPick(result)) {
          return injectMessage(
            buildNeedPickMessage(result.userMessage, result.candidates),
          );
        }
        return gateMessage(result.userMessage, gateFallback);
      }
      return {};
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: PI_PLATFORM,
      });
      stampPiPlatform(store, conversationId, projectRoot);
      if (!result.ok) {
        if (isChannelANeedPick(result)) {
          return injectMessage(
            buildNeedPickMessage(result.userMessage, result.candidates),
          );
        }
        return gateMessage(result.userMessage, gateFallback);
      }
      return {};
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig, platform: PI_PLATFORM },
      );
      stampPiPlatform(store, conversationId, projectRoot);
      if (!result.ok) {
        if (isChannelANeedPick(result)) {
          return injectMessage(
            buildNeedPickMessage(result.userMessage, result.candidates),
          );
        }
        return gateMessage(result.userMessage, gateFallback);
      }
      return {};
    }
    return {};
  }

  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  stampPiPlatform(store, conversationId, projectRoot);
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
      PI_PLATFORM,
    );
  }
  stampPiPlatform(store, conversationId, projectRoot);
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

export function filePathsFromPiToolInput(
  input: Record<string, unknown> | null | undefined,
  cwd?: string | null,
): string[] {
  if (!input || typeof input !== "object") return [];
  const raw = input.path;
  if (typeof raw !== "string") return [];
  let p = raw.trim();
  if (!isSafePath(p)) return [];
  // Pi may pass cwd-relative paths; resolve before product-code checks.
  if (!path.isAbsolute(p)) {
    const base =
      typeof cwd === "string" && cwd.trim() ? cwd.trim() : undefined;
    if (base && isSafePath(base)) {
      p = path.resolve(base, p);
    }
  }
  if (!isSafePath(p)) return [];
  return [p].slice(0, MAX_PI_PATHS);
}

function armPaths(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
  filePaths: readonly string[],
): void {
  if (filePaths.length === 0) {
    stampPiPlatform(store, conversationId, projectRoot);
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
      notePlansDirEdit(store, conversationId, projectRoot, filePath, plansDir);
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
    stampPiPlatform(store, conversationId, projectRoot);
  }
}

/**
 * `tool_result` — arm write/edit; never blocks.
 */
export function handlePiToolResult(
  store: StateStore,
  payload: PiToolResultPayload,
  projectRoot: string,
): void {
  try {
    handlePiToolResultInner(store, payload, projectRoot);
  } catch {
    /* fail-open */
  }
}

export const handlePiPostTool = handlePiToolResult;

function handlePiToolResultInner(
  store: StateStore,
  payload: PiToolResultPayload,
  projectRoot: string,
): void {
  const conversationId = conversationIdFromPiPayload(payload);
  const toolName = String(payload.toolName ?? payload.tool_name ?? "").trim();
  if (!conversationId || !isPiEditTool(toolName)) return;
  armPaths(
    store,
    conversationId,
    projectRoot,
    filePathsFromPiToolInput(payload.input, payload.cwd ?? projectRoot),
  );
}

/**
 * `agent_settled` — ReviewEngine.handleStop (includes dirty-tree arm / R8).
 * R1: only return continueMessage when action.loop + message (pending followup).
 * R9: callers must not use blocking UI when delivering continueMessage.
 */
export function handlePiAgentSettled(
  engine: ReviewEngine,
  store: StateStore,
  payload: PiAgentSettledPayload,
  projectRoot: string,
  opts?: { loopCount?: number; status?: "completed" | "error" | "aborted" },
): PiSettledResult {
  try {
    return handlePiAgentSettledInner(
      engine,
      store,
      payload,
      projectRoot,
      opts,
    );
  } catch {
    return {};
  }
}

export const handlePiStop = handlePiAgentSettled;

function handlePiAgentSettledInner(
  engine: ReviewEngine,
  store: StateStore,
  payload: PiAgentSettledPayload,
  projectRoot: string,
  opts?: { loopCount?: number; status?: "completed" | "error" | "aborted" },
): PiSettledResult {
  if (isPiUnsupportedAutopilotMode(payload.mode)) return {};

  const conversationId = conversationIdFromPiPayload(payload);
  if (!conversationId) return {};

  stampPiPlatform(store, conversationId, projectRoot);

  const action = engine.handleStop({
    conversationId,
    status: opts?.status ?? "completed",
    loopCount: opts?.loopCount ?? 0,
    platform: PI_PLATFORM,
  });

  // R1: no pending / non-looping / blank message → empty (extension must not inject).
  const msg =
    typeof action?.message === "string" ? action.message.trim() : "";
  if (!msg || !action?.loop) return {};

  return {
    continueMessage: clipText(msg, MAX_HOOK_TEXT_CHARS),
  };
}
