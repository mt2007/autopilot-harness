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

/** Kimi Code UserPromptSubmit stdin fields. */
export interface KimiSubmitPayload {
  session_id?: string;
  sessionId?: string;
  prompt?: string;
  /** Informational only — store always uses install-root projectRoot. */
  cwd?: string;
  transcript_path?: string;
  transcriptPath?: string;
  conversation_id?: string;
  conversationId?: string;
  /** Kimi may send plan/default/… — Autopilot ignores (no auto-ON). */
  permission_mode?: string;
  permissionMode?: string;
  turn_id?: string;
  model?: string;
}

/** Kimi Code PostToolUse stdin (Write / Edit / Bash / …). */
export interface KimiEditPayload {
  session_id?: string;
  sessionId?: string;
  conversation_id?: string;
  conversationId?: string;
  cwd?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: Record<string, unknown> | string;
  toolInput?: Record<string, unknown> | string;
}

/** Kimi Code Stop stdin (no StopFailure / SubagentStop in this port). */
export interface KimiStopPayload {
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
  hook_event_name?: string;
  hookEventName?: string;
  last_assistant_message?: string;
  turn_id?: string;
  error?: unknown;
  message?: unknown;
  reason?: unknown;
}

export interface KimiPortConfig {
  phaseActions?: PhaseActionConfig;
}

export const KIMI_PLATFORM = "kimi-code";

/** Cap needPick list for Kimi ~2500-token hook-output budget. */
export const MAX_NEED_PICK_SLUGS = 40;
export const MAX_NEED_PICK_CONTEXT_CHARS = 2_000;
/** Bound hostile/huge apply_patch command parsing. */
export const MAX_APPLY_PATCH_COMMAND_CHARS = 1_048_576;
export const MAX_APPLY_PATCH_PATHS = 256;
/** Bound followup / gate text written to Kimi stdout/stderr. */
export const MAX_HOOK_STDIO_CHARS = 8_192;

/**
 * Kimi Code hook reply — CLI uses exit code + stdio (not Claude/Codex JSON).
 * exit 0 + stdout → allow (UPS may append stdout to context).
 * exit 2 + stderr → intentional block (Stop continue injects stderr as reason).
 * Other non-zero / throw → host fail-open; Autopilot handlers should not throw.
 */
export interface KimiHookResult {
  exitCode: 0 | 2;
  /** Appended to context on UPS allow (exit 0). */
  stdout?: string;
  /** Block / Stop-continue reason (exit 2); printed via stderr by the hook entry. */
  stderr?: string;
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

function clipHookText(text: string): string {
  if (text.length <= MAX_HOOK_STDIO_CHARS) return text;
  return `${text.slice(0, MAX_HOOK_STDIO_CHARS - 1)}…`;
}

function allowResult(stdout?: string): KimiHookResult {
  if (typeof stdout === "string" && stdout.trim().length > 0) {
    return { exitCode: 0, stdout: clipHookText(stdout) };
  }
  return { exitCode: 0 };
}

function blockResult(stderr: string): KimiHookResult {
  return { exitCode: 2, stderr: clipHookText(stderr) };
}

/**
 * Map Kimi stop_hook_active → ReviewEngine loopCount.
 * true ⇒ in auto-continuation chain.
 */
export function loopCountFromStopHookActive(
  payload: KimiStopPayload,
): number {
  const active = payload.stop_hook_active ?? payload.stopHookActive;
  return active === true ? 1 : 0;
}

export function collectKimiStopErrorText(payload: KimiStopPayload): string {
  if (!payload || typeof payload !== "object") return "";
  const MAX_CHARS = 8_192;
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
  const joined = parts.join("\n");
  return joined.length > MAX_CHARS ? joined.slice(0, MAX_CHARS) : joined;
}

export function normalizeKimiStopStatus(
  payload: KimiStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): "completed" | "error" | "aborted" {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return opts?.status ?? "completed";
  }
  const statusRaw = String(payload.status ?? "")
    .toLowerCase()
    .trim();
  const errText = collectKimiStopErrorText(payload);
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

function blockReason(message: string | undefined, fallback: string): string {
  const m = typeof message === "string" ? message.trim() : "";
  return m || fallback;
}

/**
 * Channel A needPick via UPS allow + stdout context — never exit 2 for pick.
 * Slugs capped for Kimi hook-output budget.
 * @internal Exported for tests.
 */
export function allowNeedPickContext(
  userMessage: unknown,
  candidates?: ReadonlyArray<{ slug?: string }>,
): KimiHookResult {
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

  return allowResult(ctx);
}

/**
 * Parse file paths from Kimi apply_patch `tool_input.command` text.
 * Supports `*** Add|Update|Delete File:`, `*** Rename File: a -> b`, and `+++` lines.
 */
export function pathsFromApplyPatchCommand(command: string): string[] {
  if (typeof command !== "string" || !command.trim()) return [];
  // Truncate oversized payloads before split (DoS / hostile hooks).
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
    // Reject NULs / newlines smuggled into a "path".
    if (/[\0\r\n]/.test(p)) return;
    // Strip optional a/ or b/ prefix from diff paths.
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
  payload: KimiEditPayload,
): Record<string, unknown> | null {
  const input = payload.tool_input ?? payload.toolInput;
  if (!input) return null;
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return null;
}

/**
 * Paths touched by this PostToolUse (0..n).
 * apply_patch → parse command; Edit/Write → file_path-style fields.
 */
export function filePathsFromKimiEdit(payload: KimiEditPayload): string[] {
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  const rawInput = payload.tool_input ?? payload.toolInput;

  if (toolName === "apply_patch" || toolName === "ApplyPatch") {
    // Object `{ command }` or rare stringified command body.
    if (typeof rawInput === "string") {
      return pathsFromApplyPatchCommand(rawInput);
    }
    const input = toolInputObject(payload);
    if (!input) return [];
    const cmd = input.command;
    if (typeof cmd === "string") return pathsFromApplyPatchCommand(cmd);
    return [];
  }

  const input = toolInputObject(payload);
  if (!input) return [];

  const candidates = [
    input.file_path,
    input.filePath,
    input.path,
    input.notebook_path,
    input.notebookPath,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const p = c.trim();
    if (!p || /[\0\r\n]/.test(p)) continue;
    return [p];
  }
  return [];
}

/** File-mutating tools Autopilot arms from (Bash relies on dirty-arm on Stop). */
export function isKimiEditTool(toolName: string): boolean {
  const n = toolName.trim();
  return (
    n === "Write" ||
    n === "Edit" ||
    n === "StrReplace" ||
    n === "MultiEdit" ||
    n === "apply_patch" ||
    n === "ApplyPatch"
  );
}

function stampKimiPlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  if (!session || session.platform === KIMI_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: KIMI_PLATFORM,
  });
}

/**
 * UserPromptSubmit → core triggers / fail-closed.
 * needPick → exit 0 + stdout (Channel A). Busy/errors → exit 2 + stderr.
 * Does not trust payload.cwd — store uses install-root projectRoot.
 */
export function handleUserPromptSubmit(
  store: StateStore,
  payload: KimiSubmitPayload,
  projectRoot: string,
  portConfig?: KimiPortConfig,
): KimiHookResult {
  try {
    return handleUserPromptSubmitInner(
      store,
      payload,
      projectRoot,
      portConfig,
    );
  } catch {
    // Port-level fail-open (Kimi treats non-0/2 as allow; we prefer clean 0).
    return { exitCode: 0 };
  }
}

function handleUserPromptSubmitInner(
  store: StateStore,
  payload: KimiSubmitPayload,
  projectRoot: string,
  portConfig?: KimiPortConfig,
): KimiHookResult {
  const conversationId = sid(payload);
  if (!conversationId) return { exitCode: 0 };

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
      stampKimiPlatform(store, conversationId, projectRoot);
      return { exitCode: 0 };
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
        platform: KIMI_PLATFORM,
      });
      if (!result.ok) {
        stampKimiPlatform(store, conversationId, projectRoot);
        return blockResult(blockReason(result.userMessage, gateFallback));
      }
      return { exitCode: 0 };
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug,
      });
      if (!result.ok) {
        stampKimiPlatform(store, conversationId, projectRoot);
        return blockResult(blockReason(result.userMessage, gateFallback));
      }
      stampKimiPlatform(store, conversationId, projectRoot);
      return { exitCode: 0 };
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      stampKimiPlatform(store, conversationId, projectRoot);
      return { exitCode: 0 };
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: KIMI_PLATFORM,
      });
      if (!result.ok) {
        stampKimiPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return allowNeedPickContext(result.userMessage, result.candidates);
        }
        return blockResult(blockReason(result.userMessage, gateFallback));
      }
      return { exitCode: 0 };
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: KIMI_PLATFORM,
      });
      if (!result.ok) {
        stampKimiPlatform(store, conversationId, projectRoot);
        return blockResult(blockReason(result.userMessage, gateFallback));
      }
      return { exitCode: 0 };
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig, platform: KIMI_PLATFORM },
      );
      if (!result.ok) {
        stampKimiPlatform(store, conversationId, projectRoot);
        if (isChannelANeedPick(result)) {
          return allowNeedPickContext(result.userMessage, result.candidates);
        }
        return blockResult(blockReason(result.userMessage, gateFallback));
      }
      return { exitCode: 0 };
    }
    return { exitCode: 0 };
  }

  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  stampKimiPlatform(store, conversationId, projectRoot);
  return { exitCode: 0 };
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
      KIMI_PLATFORM,
    );
  }
  stampKimiPlatform(store, conversationId, projectRoot);
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

/** PostToolUse → markCodeEdited when any product path is touched. */
export function handlePostToolUse(
  store: StateStore,
  payload: KimiEditPayload,
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
  payload: KimiEditPayload,
  projectRoot: string,
): void {
  const conversationId = sid(payload);
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  if (!conversationId || !isKimiEditTool(toolName)) return;

  const filePaths = filePathsFromKimiEdit(payload);
  if (filePaths.length === 0) {
    // apply_patch with unparsable command: still stamp platform; dirty-arm
    // on Stop covers product paths. Do not false-arm without a path.
    stampKimiPlatform(store, conversationId, projectRoot);
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
    stampKimiPlatform(store, conversationId, projectRoot);
  }
}

/**
 * Stop → ReviewEngine.
 * Continue: exit 2 + stderr reason (Kimi CLI appends reason and continues).
 * Hard-stop (loop:false): exit 0 (allow the model to end the turn).
 * Never emit Claude/Codex JSON decision:block — hook entry maps this shape.
 * No StopFailure / SubagentStop handler — hook boundary fail-open.
 */
export function handleStop(
  engine: ReviewEngine,
  payload: KimiStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): KimiHookResult {
  try {
    return handleStopInner(engine, payload, opts);
  } catch {
    return { exitCode: 0 };
  }
}

function handleStopInner(
  engine: ReviewEngine,
  payload: KimiStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): KimiHookResult {
  const conversationId = sid(payload);
  if (!conversationId) return { exitCode: 0 };

  const status = normalizeKimiStopStatus(payload, opts);

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
    platform: KIMI_PLATFORM,
  });

  if (!action?.message) return { exitCode: 0 };

  const reason = blockReason(action.message, "Autopilot followup");

  if (!action.loop) {
    // Allow the model to end the turn. Do not put reason on stdout — Kimi may
    // append exit-0 stdout to context and blur "stop" vs "continue".
    return { exitCode: 0 };
  }

  return blockResult(reason);
}
