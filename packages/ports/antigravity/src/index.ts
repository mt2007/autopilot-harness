import fs from "node:fs";
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

/** Antigravity common + PreInvocation stdin (camelCase; tolerate extras). */
export interface AntigravityPreInvocationPayload {
  conversationId?: string;
  conversation_id?: string;
  sessionId?: string;
  session_id?: string;
  workspacePaths?: unknown;
  workspace_paths?: unknown;
  transcriptPath?: string;
  transcript_path?: string;
  artifactDirectoryPath?: string;
  artifact_directory_path?: string;
  modelName?: string;
  model_name?: string;
  invocationNum?: number;
  invocation_num?: number;
  initialNumSteps?: number;
  initial_num_steps?: number;
  hookEventName?: string;
  hook_event_name?: string;
  /**
   * Not on the official wire — runner may attach after reading transcript.
   * Port must not assume stdin includes the live user prompt (research R2).
   */
  userPrompt?: string;
  user_prompt?: string;
  prompt?: string;
}

/** Antigravity PostToolUse stdin. */
export interface AntigravityEditPayload {
  conversationId?: string;
  conversation_id?: string;
  sessionId?: string;
  session_id?: string;
  workspacePaths?: unknown;
  workspace_paths?: unknown;
  transcriptPath?: string;
  transcript_path?: string;
  toolCall?: {
    name?: string;
    args?: Record<string, unknown>;
  };
  tool_call?: {
    name?: string;
    args?: Record<string, unknown>;
  };
  toolName?: string;
  tool_name?: string;
  toolInput?: Record<string, unknown> | string;
  tool_input?: Record<string, unknown> | string;
  stepIdx?: number;
  step_idx?: number;
  /** Host may send string or `{ message }` shaped failures. */
  error?: unknown;
  hookEventName?: string;
  hook_event_name?: string;
}

/** Antigravity Stop stdin. */
export interface AntigravityStopPayload {
  conversationId?: string;
  conversation_id?: string;
  sessionId?: string;
  session_id?: string;
  workspacePaths?: unknown;
  workspace_paths?: unknown;
  transcriptPath?: string;
  transcript_path?: string;
  executionNum?: number;
  execution_num?: number;
  terminationReason?: string;
  termination_reason?: string;
  /** Host may send string or `{ message }` shaped failures. */
  error?: unknown;
  /** Required by host; continue only when strictly true. */
  fullyIdle?: boolean;
  fully_idle?: boolean;
  hookEventName?: string;
  hook_event_name?: string;
}

export interface AntigravityPortConfig {
  phaseActions?: PhaseActionConfig;
}

export const ANTIGRAVITY_PLATFORM = "antigravity";

/** Named hooks.json block Autopilot merges. */
export const ANTIGRAVITY_HOOK_BLOCK_NAME = "autopilot-harness";

export const ANTIGRAVITY_EVENTS = [
  "PreInvocation",
  "PostToolUse",
  "Stop",
] as const;

/** Docs + research: Stop continue shape (not Claude block). */
export const ANTIGRAVITY_STOP_CONTINUE = "decision:continue+reason" as const;

/** Docs: PreInvocation stdin has no user prompt field. */
export const ANTIGRAVITY_PRE_INVOCATION_HAS_PROMPT = false;

/** Trigger text source for the hook runner / port. */
export const ANTIGRAVITY_TRIGGER_SOURCE =
  "transcriptPath+statefulCursor" as const;

/** Live must prove; docs claim inject continue works. */
export const ANTIGRAVITY_STOP_CONTINUE_DOCS_SUPPORTED = true;

/** No documented numeric Stop-continue cap / raise. */
export const ANTIGRAVITY_STOP_CAP_RAISE_FOUND = false;

/**
 * PostToolUse matcher (official file-edit tools).
 * Live may widen; dirty-arm covers shell on Stop via ReviewEngine.
 */
export const ANTIGRAVITY_POST_TOOL_MATCHER =
  "write_to_file|replace_file_content|multi_replace_file_content";

/** Autopilot stamps timeout seconds (host default 30). */
export const ANTIGRAVITY_TIMEOUT_SEC = 120;

export const MAX_NEED_PICK_SLUGS = 40;
export const MAX_NEED_PICK_CONTEXT_CHARS = 2_000;
export const MAX_HOOK_STDIO_CHARS = 8_192;
export const MAX_TOOL_ARGS_JSON_CHARS = 1_048_576;
export const MAX_TRANSCRIPT_SCAN_BYTES = 2_000_000;
export const MAX_TRANSCRIPT_LINES = 8_000;
/** Durable PreInvocation prompt cursor (one-shot hook processes). */
export const MAX_PREINVOCATION_CURSOR_ENTRIES = 200;
export const ANTIGRAVITY_PREINVOCATION_CURSOR_FILE =
  "antigravity-preinvocation-cursor.json";

export interface AntigravityInjectStep {
  ephemeralMessage?: string;
  userMessage?: string;
  toolCall?: Record<string, unknown>;
}

/**
 * PreInvocation stdout — injectSteps only (never Stop `decision`).
 * Allow / no-op → `{}`.
 */
export interface AntigravityPreInvocationResult {
  injectSteps?: AntigravityInjectStep[];
}

/**
 * PostToolUse stdout — docs require `{}` only (arm in-process; never deny).
 */
export type AntigravityPostToolUseResult = Record<string, never>;

/**
 * Stop stdout — continue with decision:continue + reason.
 * Allow / fail-open → `{}`.
 */
export interface AntigravityStopResult {
  decision?: "continue" | string;
  reason?: string;
}

/** True when result is a Silence / allow no-op (`{}` wire). */
export function isAntigravityAllowNoop(
  result:
    | AntigravityPreInvocationResult
    | AntigravityStopResult
    | null
    | undefined,
): boolean {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  for (const value of Object.values(result as Record<string, unknown>)) {
    if (value !== undefined && value !== null) return false;
  }
  return true;
}

function sid(p: {
  conversationId?: string;
  conversation_id?: string;
  sessionId?: string;
  session_id?: string;
}): string {
  for (const v of [
    p.conversationId,
    p.conversation_id,
    p.sessionId,
    p.session_id,
  ]) {
    if (typeof v === "string") {
      const t = v.trim();
      if (t && !/[\u0000-\u001f\u007f]/.test(t)) return t;
    }
  }
  return "";
}

function clipText(text: string, max = MAX_HOOK_STDIO_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function stripHookControls(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function followupReason(message: string | undefined, fallback: string): string {
  const m =
    typeof message === "string" ? stripHookControls(message).trim() : "";
  return m || fallback;
}

/**
 * Host transcript logs live under …/logs/transcript.jsonl.
 * Shared by PreInvocation prompt fallback and Stop → ReviewEngine reads.
 * Absolute paths only — relative paths would resolve via hook cwd.
 */
export function sanitizeAntigravityTranscriptPath(
  raw: unknown,
): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const p = raw.trim();
  if (/[\0\r\n]/.test(p)) return undefined;
  if (p.split(/[/\\]/).includes("..")) return undefined;
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const absolute =
    normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized);
  if (!absolute) return undefined;
  if (!normalized.endsWith("/logs/transcript.jsonl")) return undefined;
  return normalized;
}

/**
 * Prefer install-root, then workspacePaths[0] / workspace_paths[0], then stdin cwd.
 * Never returns process.cwd().
 */
export function resolveAntigravityWorkspaceRoot(opts: {
  installRoot?: string;
  workspacePaths?: unknown;
  workspace_paths?: unknown;
  stdinCwd?: string;
}): string | null {
  const fromList = (raw: unknown): string | null => {
    if (!Array.isArray(raw)) return null;
    for (const item of raw) {
      if (typeof item === "string") {
        const t = item.trim();
        if (t && !/[\0\r\n]/.test(t) && !t.split(/[/\\]/).includes("..")) {
          return t;
        }
      }
    }
    return null;
  };
  const candidates = [
    opts.installRoot,
    fromList(opts.workspacePaths),
    fromList(opts.workspace_paths),
    opts.stdinCwd,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      const t = c.trim();
      if (t && !/[\0\r\n]/.test(t) && !t.split(/[/\\]/).includes("..")) {
        return t;
      }
    }
  }
  return null;
}

/** `fullyIdle` must be strictly true to allow Stop continue. */
export function isAntigravityFullyIdle(
  payload: AntigravityStopPayload,
): boolean {
  return payload.fullyIdle === true || payload.fully_idle === true;
}

/**
 * Map executionNum → ReviewEngine loopCount.
 * executionNum ≥ 2 ⇒ already continued at least once this execution streak.
 */
export function loopCountFromExecutionNum(
  payload: AntigravityStopPayload,
): number {
  const n = finiteNumberOrNull(
    payload.executionNum ?? payload.execution_num,
  );
  if (n != null && n >= 2) return 1;
  return 0;
}

/** Extract host error text from string, arrays, or `{ message|error|… }` objects. */
export function antigravityErrorFieldText(error: unknown): string {
  return clipText(extractAntigravityErrorFieldText(error));
}

/** Head+tail probe so abort markers past a mid-clip are still detected. */
function abortProbeText(text: string): string {
  if (!text) return "";
  const limit = MAX_HOOK_STDIO_CHARS * 2;
  if (text.length <= limit) return text;
  const n = MAX_HOOK_STDIO_CHARS;
  return `${text.slice(0, n)}\n${text.slice(-n)}`;
}

/** Full abort scan up to a bound; beyond that, head+tail only (DoS guard). */
const ABORT_SCAN_MAX_CHARS = 256_000;

function isAbortTextProbed(text: string): boolean {
  if (!text) return false;
  if (text.length <= ABORT_SCAN_MAX_CHARS) return isUserAbortText(text);
  return isUserAbortText(abortProbeText(text));
}

function extractAntigravityErrorFieldText(
  error: unknown,
  depth = 0,
): string {
  if (depth > 3) return "";
  if (typeof error === "string") return error.trim();
  if (Array.isArray(error)) {
    const parts: string[] = [];
    for (const item of error.slice(0, 8)) {
      const inner = extractAntigravityErrorFieldText(item, depth + 1);
      if (inner) parts.push(inner);
    }
    if (parts.length > 0) return parts.join("\n");
    // Non-empty array with no extractable text still signals failure.
    return error.length > 0 ? "host_error_object" : "";
  }
  if (!error || typeof error !== "object") return "";
  try {
    const o = error as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ["message", "error", "name", "stack", "detail"]) {
      const nested = o[key];
      if (typeof nested === "string" && nested.trim()) {
        parts.push(nested.trim());
        continue;
      }
      if (nested && typeof nested === "object") {
        const inner = extractAntigravityErrorFieldText(nested, depth + 1);
        if (inner) parts.push(inner);
      }
    }
    if (parts.length > 0) return parts.join("\n");
    // Structured failure with no known string fields — still signal presence
    // so Stop does not soft-advance as completed.
    return Object.keys(o).length > 0 ? "host_error_object" : "";
  } catch {
    return "";
  }
}

function collectAntigravityStopErrorTextRaw(
  payload: AntigravityStopPayload,
): string {
  if (!payload || typeof payload !== "object") return "";
  const parts: string[] = [];
  const fromError = extractAntigravityErrorFieldText(payload.error);
  if (fromError) parts.push(fromError);
  for (const value of [payload.terminationReason, payload.termination_reason]) {
    if (typeof value === "string" && value.trim()) parts.push(value);
  }
  return parts.join("\n");
}

export function collectAntigravityStopErrorText(
  payload: AntigravityStopPayload,
): string {
  return clipText(collectAntigravityStopErrorTextRaw(payload));
}

export function normalizeAntigravityStopStatus(
  payload: AntigravityStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): "completed" | "error" | "aborted" {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return opts?.status ?? "completed";
  }
  const reason = String(
    payload.terminationReason ?? payload.termination_reason ?? "",
  )
    .toLowerCase()
    .trim();
  const errorRaw = extractAntigravityErrorFieldText(payload.error);
  const errorField = clipText(errorRaw);
  const errTextRaw = collectAntigravityStopErrorTextRaw(payload);
  if (
    reason === "aborted" ||
    reason === "cancelled" ||
    reason === "canceled" ||
    reason === "user_abort"
  ) {
    return "aborted";
  }
  if (opts?.status === "aborted") return "aborted";
  if (errorRaw && isAbortTextProbed(errorRaw)) return "aborted";
  if (
    reason === "error" ||
    reason === "failed" ||
    reason === "max_steps_exceeded" ||
    reason === "timeout" ||
    reason === "timed_out" ||
    reason === "tool_error"
  ) {
    if (isAbortTextProbed(errTextRaw)) return "aborted";
    return "error";
  }
  if (opts?.status === "error") {
    if (isAbortTextProbed(errTextRaw)) return "aborted";
    return "error";
  }
  // Abort markers in terminationReason / combined err text beat completed override
  // (same priority as abort text in payload.error).
  if (isAbortTextProbed(errTextRaw)) return "aborted";
  // Explicit completed override wins over incidental payload.error text.
  if (opts?.status === "completed") return "completed";
  // Non-empty error field without an explicit completion reason → error stop
  // (avoid treating host failures as completed soft-advance).
  if (errorField) {
    const completionLike =
      reason === "model_stop" ||
      reason === "end_turn" ||
      reason === "endturn" ||
      reason === "completed" ||
      reason === "stop" ||
      reason === "no_tool_call";
    if (!completionLike) {
      return "error";
    }
  }
  return "completed";
}

/**
 * Completion-like Stop reasons may Autopilot-continue.
 * Empty / missing → allow (host often omits or uses model_stop).
 * Host live Stop may emit NO_TOOL_CALL (case-insensitive) when the turn ends
 * without a tool call — treat as completion so armed sessions can continue.
 * Unknown non-empty reasons → false (fail closed).
 */
export function isAntigravityStopCompletionReason(
  payload: AntigravityStopPayload,
): boolean {
  const raw = payload.terminationReason ?? payload.termination_reason;
  if (raw == null) return true;
  if (typeof raw !== "string") return false;
  const r = raw.trim().toLowerCase();
  if (!r) return true;
  if (
    r === "model_stop" ||
    r === "end_turn" ||
    r === "endturn" ||
    r === "completed" ||
    r === "stop" ||
    r === "no_tool_call"
  ) {
    return true;
  }
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

/** Prefer ephemeralMessage (does not persist into later transcript noise). */
export function injectEphemeral(
  text: string,
): AntigravityPreInvocationResult {
  const msg = clipText(
    stripHookControls(text).trim() || "Autopilot",
    MAX_NEED_PICK_CONTEXT_CHARS,
  );
  return { injectSteps: [{ ephemeralMessage: msg }] };
}

export function injectNeedPickContext(
  userMessage: unknown,
  candidates?: ReadonlyArray<{ slug?: string }>,
): AntigravityPreInvocationResult {
  return injectEphemeral(buildNeedPickContext(userMessage, candidates));
}

/**
 * Extract the latest user-visible prompt from transcript JSONL text.
 * Tolerates USER_INPUT / user / human roles and <USER_REQUEST> wrappers.
 * Used by the hook runner (stateful cursor) — port accepts the resolved string.
 */
export function latestUserPromptFromTranscriptText(raw: string): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const text =
    raw.length > MAX_TRANSCRIPT_SCAN_BYTES
      ? raw.slice(-MAX_TRANSCRIPT_SCAN_BYTES)
      : raw;
  const lines = text.split(/\r?\n/).slice(-MAX_TRANSCRIPT_LINES);
  let found = "";
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed: unknown = JSON.parse(t);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      const o = parsed as Record<string, unknown>;
      // role is authoritative when clearly user-like; type/kind still help
      // when role is blank/generic, and any non-user hint rejects otherwise.
      const roleField = transcriptRoleField(o);
      const roleHints = transcriptRoleHints(o);
      const rawUserInput =
        typeof o.USER_INPUT === "string"
          ? o.USER_INPUT
          : typeof o.user_input === "string"
            ? o.user_input
            : null;
      // Whitespace-only USER_INPUT must not block sibling text/content fallback,
      // but the key's presence still marks the row as user input when role is
      // absent/ambiguous (not when role is explicitly assistant/system/tool).
      const fromUserInputField =
        rawUserInput != null && rawUserInput.trim() ? rawUserInput : "";
      const userInputFlag = o.USER_INPUT === true || o.user_input === true;
      const userInputKeyPresent = rawUserInput != null || userInputFlag;
      // Prefer explicit USER_INPUT string body over sibling text/content keys.
      const candidate =
        fromUserInputField ||
        (typeof o.text === "string" && o.text) ||
        textFromTranscriptContent(o.content) ||
        textFromTranscriptMessage(o.message) ||
        (typeof o.prompt === "string" && o.prompt) ||
        "";
      if (!candidate.trim()) continue;
      const roleFieldIsUser =
        !!roleField &&
        isUserLikeTranscriptRole(roleField) &&
        !isNonUserTranscriptRole(roleField);
      if (roleFieldIsUser) {
        found = candidate;
        continue;
      }
      // Non-user type/kind/role always win over USER_INPUT key / generic labels
      // (including ambiguous "assistant_user").
      if (roleHints.some(isNonUserTranscriptRole)) continue;
      if (
        roleHints.some(isUserLikeTranscriptRole) ||
        userInputKeyPresent
      ) {
        found = candidate;
      }
    } catch {
      /* skip non-JSON lines */
    }
  }
  return stripUserRequestWrapper(found.trim());
}

/**
 * Trimmed `role` only — keep original case so camelCase can be tokenized
 * (lowercasing first would turn ModelResponse into one opaque token).
 */
function transcriptRoleField(o: Record<string, unknown>): string {
  const v = o.role;
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

/** Non-blank role / type / kind values (trimmed; case preserved for camel split). */
function transcriptRoleHints(o: Record<string, unknown>): string[] {
  const hints: string[] = [];
  for (const key of ["role", "type", "kind"] as const) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) {
      hints.push(v.trim());
    }
  }
  return hints;
}

function isUserLikeTranscriptRole(role: string): boolean {
  const tokens = roleTokens(role);
  if (
    tokensIncludesExact(tokens, "user") ||
    tokensIncludesExact(tokens, "users") ||
    tokensIncludesExact(tokens, "human") ||
    tokensIncludesExact(tokens, "humans")
  ) {
    return true;
  }
  // Glued compounds: usermessage / userrequest (not humanerror — error is non-user-only).
  if (
    tokensMatchGlued(tokens, "user", USER_GLUED_ROLE_SUFFIXES) ||
    tokensMatchGlued(tokens, "users", USER_GLUED_ROLE_SUFFIXES) ||
    tokensMatchGlued(tokens, "human", USER_GLUED_ROLE_SUFFIXES) ||
    tokensMatchGlued(tokens, "humans", USER_GLUED_ROLE_SUFFIXES)
  ) {
    return true;
  }
  const joined = tokens.join("");
  return joined === "userinput" || tokens.join("_") === "user_input";
}

function isNonUserTranscriptRole(role: string): boolean {
  if (!role.trim()) return false;
  const tokens = roleTokens(role);
  const compact = tokens.join("");
  // Opaque / irregular labels (subsystem ⊅ system; agentic/coagent ⊅ agent token).
  if (
    OPAQUE_NON_USER_ROLES.has(compact) ||
    tokens.some((t) => OPAQUE_NON_USER_ROLES.has(t))
  ) {
    return true;
  }
  // Standalone non-user noise (error, result, output, response, reply, …)
  // — same set as user/human compound suffixes. Glued usererror still below.
  if (tokens.some((t) => USER_OR_HUMAN_NON_USER_SUFFIXES.has(t))) {
    return true;
  }
  // Bare input/request/prompt/query (no user/human token) — not user_input etc.
  if (
    tokens.some((t) => BARE_IO_TOKENS.has(t)) &&
    !tokens.some((t) => USER_OR_HUMAN_PREFIXES.has(t))
  ) {
    return true;
  }
  // usererror / humanerror / user_result compounds (glued single-token forms;
  // split HumanError already hit via the standalone suffix check above).
  // Do not reuse NON_USER_GLUED here — it includes input/message/request and
  // would mis-classify userinput / usermessage as non-user.
  if (
    tokensMatchGlued(tokens, "user", USER_OR_HUMAN_NON_USER_SUFFIXES) ||
    tokensMatchGlued(tokens, "users", USER_OR_HUMAN_NON_USER_SUFFIXES) ||
    tokensMatchGlued(tokens, "human", USER_OR_HUMAN_NON_USER_SUFFIXES) ||
    tokensMatchGlued(tokens, "humans", USER_OR_HUMAN_NON_USER_SUFFIXES) ||
    tokensHaveAdjacentPair(
      tokens,
      ["user", "users", "human", "humans"],
      USER_OR_HUMAN_NON_USER_SUFFIXES,
    ) ||
    // error_user when error was stripped oddly — keep reverse pair for safety.
    tokensHaveAdjacentPair(tokens, ["error", "errors"], USER_OR_HUMAN_PREFIXES)
  ) {
    return true;
  }
  for (const token of [
    "assistant",
    "system",
    "tool",
    "model",
    "agent",
    "function",
    "developer",
  ] as const) {
    if (
      tokensIncludesExact(tokens, token) ||
      tokensIncludesExact(tokens, `${token}s`) ||
      tokensMatchGlued(tokens, token, NON_USER_GLUED_ROLE_SUFFIXES)
    ) {
      return true;
    }
  }
  return false;
}

function tokensIncludesExact(
  tokens: readonly string[],
  token: string,
): boolean {
  return tokens.includes(token);
}

/** Labels that are non-user but do not tokenize cleanly onto the core list. */
const OPAQUE_NON_USER_ROLES = new Set([
  "subsystem",
  "agentic",
  "agency",
  "coagent",
  "subagent",
  "multiagent",
]);

/**
 * Suffixes that make user/human compounds non-user (usererror / humanerror).
 * Intentionally excludes input/message/request/prompt/query.
 */
const USER_OR_HUMAN_NON_USER_SUFFIXES = new Set([
  "error",
  "errors",
  "result",
  "results",
  "response",
  "responses",
  "output",
  "outputs",
  "reply",
  "replies",
]);

/** Prefix tokens paired after error/errors (error_user). */
const USER_OR_HUMAN_PREFIXES = new Set(["user", "users", "human", "humans"]);

/**
 * Bare input/request/prompt/query labels without a user/human token.
 * Excluded from USER_OR_HUMAN_NON_USER_SUFFIXES so user_input / user_prompt stay
 * user-like.
 */
const BARE_IO_TOKENS = new Set([
  "input",
  "inputs",
  "request",
  "requests",
  "prompt",
  "prompts",
  "query",
  "queries",
]);

/**
 * User-like glued suffixes only (usermessage / userrequest).
 * Excludes error/use/result so humanerror is not treated as a user role.
 */
const USER_GLUED_ROLE_SUFFIXES = new Set([
  "message",
  "messages",
  "request",
  "requests",
  "input",
  "inputs",
  "prompt",
  "prompts",
  "query",
  "queries",
]);

/**
 * Non-user glued suffixes: toolresult / modelresponse / tooluse / functioncall.
 * Avoids systematic⊃system and toolbox⊃tool; malfunction still misses function.
 */
const NON_USER_GLUED_ROLE_SUFFIXES = new Set([
  "result",
  "results",
  "response",
  "responses",
  "turn",
  "turns",
  "call",
  "calls",
  "request",
  "requests",
  "message",
  "messages",
  "output",
  "outputs",
  "input",
  "inputs",
  "reply",
  "replies",
  "error",
  "errors",
  "use",
  "uses",
]);

function tokensMatchGlued(
  tokens: readonly string[],
  token: string,
  suffixes: ReadonlySet<string>,
): boolean {
  for (const t of tokens) {
    if (t.length <= token.length || !t.startsWith(token)) continue;
    if (suffixes.has(t.slice(token.length))) return true;
  }
  return false;
}

/** True when prefixes[i] is immediately followed by a suffix token (user_error). */
function tokensHaveAdjacentPair(
  tokens: readonly string[],
  prefixes: readonly string[],
  suffixes: ReadonlySet<string>,
): boolean {
  const prefixSet = new Set(prefixes);
  for (let i = 0; i < tokens.length - 1; i++) {
    const cur = tokens[i];
    const next = tokens[i + 1];
    if (cur && next && prefixSet.has(cur) && suffixes.has(next)) return true;
  }
  return false;
}

/**
 * Split on non-alphanumeric and camelCase boundaries, then lowercase.
 * Keeps model_turn / ModelResponse → ["model","turn"|"response"]; avoids
 * malfunction⊃function while still catching glued camel labels.
 */
function roleTokens(role: string): string[] {
  const spaced = role
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** String message, or `{ text | content | prompt }` object. */
function textFromTranscriptMessage(message: unknown): string {
  if (typeof message === "string") return message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return "";
  }
  const m = message as Record<string, unknown>;
  if (typeof m.text === "string" && m.text.trim()) return m.text;
  const fromContent = textFromTranscriptContent(m.content);
  if (fromContent.trim()) return fromContent;
  if (typeof m.prompt === "string" && m.prompt.trim()) return m.prompt;
  return "";
}

/** Flatten string or [{ text }] content fields from transcript rows. */
function textFromTranscriptContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content.slice(0, 32)) {
    if (typeof item === "string" && item.trim()) {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const t = row.text ?? row.content;
    if (typeof t === "string" && t.trim()) parts.push(t);
  }
  return parts.join("\n");
}

export function latestUserPromptFromTranscriptFile(
  transcriptPath: string,
): string {
  const p = sanitizeAntigravityTranscriptPath(transcriptPath);
  if (!p) return "";
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile()) return "";
    if (st.size > MAX_TRANSCRIPT_SCAN_BYTES * 4) return "";
    const raw = fs.readFileSync(p, "utf8");
    return latestUserPromptFromTranscriptText(raw);
  } catch {
    return "";
  }
}

function stripUserRequestWrapper(text: string): string {
  const m = text.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  if (m?.[1]) return m[1].trim();
  return text;
}

/**
 * Resolve user prompt for PreInvocation.
 * Official stdin has no prompt — prefer opts.userPrompt / payload.userPrompt,
 * else best-effort read transcriptPath (may lag on invocation 0 — live prove).
 */
export function resolveAntigravityUserPrompt(
  payload: AntigravityPreInvocationPayload,
  opts?: { userPrompt?: string },
): string {
  for (const v of [
    opts?.userPrompt,
    payload.userPrompt,
    payload.user_prompt,
    payload.prompt,
  ]) {
    if (typeof v === "string" && v.trim()) {
      return clipText(v.trim(), MAX_HOOK_STDIO_CHARS * 4);
    }
  }
  const tp = payload.transcriptPath ?? payload.transcript_path;
  if (typeof tp === "string" && tp.trim()) {
    return clipText(
      latestUserPromptFromTranscriptFile(tp.trim()),
      MAX_HOOK_STDIO_CHARS * 4,
    );
  }
  return "";
}

/** True when runner/host attached a live prompt (not transcript fallback alone). */
export function isExplicitAntigravityUserPrompt(
  payload: AntigravityPreInvocationPayload,
  opts?: { userPrompt?: string },
): boolean {
  for (const v of [
    opts?.userPrompt,
    payload.userPrompt,
    payload.user_prompt,
    payload.prompt,
  ]) {
    if (typeof v === "string" && v.trim()) return true;
  }
  return false;
}

type PreInvocationCursorFile = {
  v: 1;
  entries: Record<string, { prompt: string; at: string }>;
};

function preInvocationCursorPath(projectRoot: string): string {
  return path.join(
    projectRoot,
    ".autopilot",
    ANTIGRAVITY_PREINVOCATION_CURSOR_FILE,
  );
}

/** Reject empty / control / `..` roots before writing cursor under projectRoot. */
export function isSafeAntigravityCursorProjectRoot(
  projectRoot: string,
): boolean {
  if (typeof projectRoot !== "string") return false;
  const t = projectRoot.trim();
  if (!t || /[\0\r\n]/.test(t)) return false;
  if (t.split(/[/\\]/).includes("..")) return false;
  return true;
}

const MAX_CURSOR_FILE_BYTES = 512_000;

function readPreInvocationCursor(
  projectRoot: string,
): PreInvocationCursorFile {
  try {
    const p = preInvocationCursorPath(projectRoot);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile()) return { v: 1, entries: {} };
    if (st.size > MAX_CURSOR_FILE_BYTES) return { v: 1, entries: {} };
    const raw = fs.readFileSync(p, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { v: 1, entries: {} };
    }
    const o = parsed as Record<string, unknown>;
    const entriesRaw = o.entries;
    if (!entriesRaw || typeof entriesRaw !== "object" || Array.isArray(entriesRaw)) {
      return { v: 1, entries: {} };
    }
    const entries: PreInvocationCursorFile["entries"] = {};
    for (const [k, v] of Object.entries(entriesRaw as Record<string, unknown>)) {
      if (!k || /[\0\r\n]/.test(k)) continue;
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const row = v as Record<string, unknown>;
      if (typeof row.prompt !== "string" || typeof row.at !== "string") continue;
      entries[k] = {
        prompt: clipText(row.prompt, MAX_HOOK_STDIO_CHARS * 4),
        at: row.at,
      };
    }
    return { v: 1, entries };
  } catch {
    return { v: 1, entries: {} };
  }
}

function writePreInvocationCursor(
  projectRoot: string,
  data: PreInvocationCursorFile,
): void {
  const dir = path.join(projectRoot, ".autopilot");
  fs.mkdirSync(dir, { recursive: true });
  const dirStat = fs.lstatSync(dir);
  if (dirStat.isSymbolicLink()) {
    throw new Error("refusing cursor write via symlinked .autopilot");
  }
  let entries = data.entries;
  const keys = Object.keys(entries);
  if (keys.length > MAX_PREINVOCATION_CURSOR_ENTRIES) {
    const sorted = keys.sort((a, b) =>
      (entries[a]?.at ?? "").localeCompare(entries[b]?.at ?? ""),
    );
    const drop = sorted.slice(0, keys.length - MAX_PREINVOCATION_CURSOR_ENTRIES);
    entries = { ...entries };
    for (const k of drop) delete entries[k];
  }
  const payload = `${JSON.stringify({ v: 1 as const, entries }, null, 0)}\n`;
  const target = preInvocationCursorPath(projectRoot);
  try {
    if (fs.lstatSync(target).isSymbolicLink()) {
      throw new Error("refusing cursor write over symlink");
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("refusing")) throw e;
    const code =
      e && typeof e === "object" && "code" in e
        ? String((e as { code?: unknown }).code)
        : "";
    if (code !== "ENOENT") {
      /* unexpected lstat — still attempt atomic replace */
    }
  }
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, payload, "utf8");
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
    throw err;
  }
}

const CURSOR_LOCK_STALE_MS = 10_000;

/**
 * Exclusive create lock for cursor read-modify-write.
 * Lock busy / unsafe root → returns null (caller fail-closed for transcript).
 */
function withPreInvocationCursorLock<T>(
  projectRoot: string,
  fn: () => T,
): T | null {
  if (!isSafeAntigravityCursorProjectRoot(projectRoot)) return null;
  // Create `.autopilot` before opening the lock file — otherwise wx open
  // fails with ENOENT and callers fail-open without a durable cursor (re-fire).
  try {
    fs.mkdirSync(path.join(projectRoot, ".autopilot"), { recursive: true });
  } catch {
    return null;
  }
  const lockPath = `${preInvocationCursorPath(projectRoot)}.lock`;
  const openExclusive = (): number | null => {
    try {
      return fs.openSync(lockPath, "wx");
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e
          ? String((e as { code?: unknown }).code)
          : "";
      if (code !== "EEXIST") return null;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > CURSOR_LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          return fs.openSync(lockPath, "wx");
        }
      } catch {
        return null;
      }
      return null;
    }
  };
  const fd = openExclusive();
  if (fd == null) return null;
  try {
    return fn();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Research R2 stateful cursor: fire triggers/E8 once per distinct USER_INPUT.
 * Claim writes immediately (concurrency); callers must rollback on failed apply*.
 * Lock failure: explicit fail-open (claimed without persist); transcript fail-closed.
 * Non-persisted claims must not rollback — deleting would wipe a concurrent durable cursor.
 */
export type AntigravityPromptClaim =
  | { status: "duplicate" }
  | { status: "unavailable" }
  | {
      status: "claimed";
      previous: string | null;
      prompt: string;
      /** False when fail-open under lock contention (no cursor write). */
      persisted: boolean;
    };

export function claimAntigravityUserPrompt(opts: {
  projectRoot: string;
  conversationId: string;
  prompt: string;
  explicit: boolean;
}): AntigravityPromptClaim {
  const prompt = typeof opts.prompt === "string" ? opts.prompt.trim() : "";
  if (!prompt) return { status: "unavailable" };
  const cid =
    typeof opts.conversationId === "string" ? opts.conversationId.trim() : "";
  if (!cid || /[\0\r\n]/.test(cid)) return { status: "unavailable" };
  const clipped = clipText(prompt, MAX_HOOK_STDIO_CHARS * 4);
  // Unsafe root / cannot create cursor dir → never fail-open (would re-fire
  // forever with no durable dedupe). Lock-busy still fail-opens when explicit.
  if (!isSafeAntigravityCursorProjectRoot(opts.projectRoot)) {
    return { status: "unavailable" };
  }
  try {
    fs.mkdirSync(path.join(opts.projectRoot, ".autopilot"), {
      recursive: true,
    });
  } catch {
    return { status: "unavailable" };
  }
  let claimed: AntigravityPromptClaim | null = null;
  try {
    claimed = withPreInvocationCursorLock(opts.projectRoot, () => {
      const cur = readPreInvocationCursor(opts.projectRoot);
      const previous = cur.entries[cid]?.prompt ?? null;
      if (previous === clipped) return { status: "duplicate" as const };
      cur.entries[cid] = { prompt: clipped, at: new Date().toISOString() };
      writePreInvocationCursor(opts.projectRoot, cur);
      return {
        status: "claimed" as const,
        previous,
        prompt: clipped,
        persisted: true,
      };
    });
  } catch {
    // Symlinked .autopilot / write failures — do not fail-open (no durable cursor).
    return { status: "unavailable" };
  }
  if (claimed != null) return claimed;
  // Lock busy. Before explicit fail-open, best-effort duplicate check without
  // the lock — if the cursor already holds this prompt, re-firing would break
  // the once-per-USER_INPUT invariant (R2).
  if (opts.explicit) {
    try {
      const cur = readPreInvocationCursor(opts.projectRoot);
      if (cur.entries[cid]?.prompt === clipped) {
        return { status: "duplicate" };
      }
    } catch {
      /* ignore — fall through to fail-open */
    }
    return {
      status: "claimed",
      previous: null,
      prompt: clipped,
      persisted: false,
    };
  }
  return { status: "unavailable" };
}

/**
 * After a successful fail-open apply, best-effort write the prompt to the
 * durable cursor so the next PreInvocation does not re-fire (R2). Lock busy /
 * IO errors → no-op (same tradeoff as the original fail-open).
 */
export function persistAntigravityUserPromptBestEffort(opts: {
  projectRoot: string;
  conversationId: string;
  prompt: string;
}): void {
  const prompt = typeof opts.prompt === "string" ? opts.prompt.trim() : "";
  if (!prompt) return;
  const cid =
    typeof opts.conversationId === "string" ? opts.conversationId.trim() : "";
  if (!cid || /[\0\r\n]/.test(cid)) return;
  if (!isSafeAntigravityCursorProjectRoot(opts.projectRoot)) return;
  const clipped = clipText(prompt, MAX_HOOK_STDIO_CHARS * 4);
  try {
    fs.mkdirSync(path.join(opts.projectRoot, ".autopilot"), {
      recursive: true,
    });
  } catch {
    return;
  }
  try {
    withPreInvocationCursorLock(opts.projectRoot, () => {
      const cur = readPreInvocationCursor(opts.projectRoot);
      if (cur.entries[cid]?.prompt === clipped) return true;
      cur.entries[cid] = { prompt: clipped, at: new Date().toISOString() };
      writePreInvocationCursor(opts.projectRoot, cur);
      return true;
    });
  } catch {
    /* best-effort */
  }
}

/**
 * Restore cursor after a failed trigger apply so the user can retry the same text.
 * If `expected` is set and the stored prompt no longer matches (concurrent claim),
 * leave the cursor alone.
 */
export function rollbackAntigravityUserPromptClaim(opts: {
  projectRoot: string;
  conversationId: string;
  previous: string | null;
  expected?: string;
}): void {
  const cid =
    typeof opts.conversationId === "string" ? opts.conversationId.trim() : "";
  if (!cid || /[\0\r\n]/.test(cid)) return;
  try {
    withPreInvocationCursorLock(opts.projectRoot, () => {
      const cur = readPreInvocationCursor(opts.projectRoot);
      if (
        typeof opts.expected === "string" &&
        opts.expected.length > 0 &&
        cur.entries[cid]?.prompt !== opts.expected
      ) {
        return false;
      }
      if (opts.previous == null || opts.previous === "") {
        delete cur.entries[cid];
      } else {
        cur.entries[cid] = {
          prompt: clipText(opts.previous, MAX_HOOK_STDIO_CHARS * 4),
          at: new Date().toISOString(),
        };
      }
      writePreInvocationCursor(opts.projectRoot, cur);
      return true;
    });
  } catch {
    /* best-effort — symlinked .autopilot / IO errors must not throw to hooks */
  }
}

export function shouldProcessAntigravityUserPrompt(opts: {
  projectRoot: string;
  conversationId: string;
  prompt: string;
  explicit: boolean;
}): boolean {
  return claimAntigravityUserPrompt(opts).status === "claimed";
}

/**
 * PreInvocation runs before *every* model call. Transcript fallback often still
 * holds the prior USER_INPUT, so clearing chain_pending on every non-trigger
 * would wipe Stop-continue / review state mid-turn.
 *
 * Only clear on a likely *first* model invocation of a turn (docs: 0-indexed;
 * MemPalace samples use 1 + initialNumSteps:0). Missing/non-numeric
 * invocationNum → do not clear (fail closed for pending wipe). Undelivered
 * pending_followup → do not clear (Stop-continue / redelivery must keep
 * chain_pending).
 */
export function shouldClearChainPendingOnAntigravityPreInvocation(
  payload: AntigravityPreInvocationPayload,
  prompt: string,
  opts?: { hasUndeliveredPending?: boolean },
): boolean {
  if (opts?.hasUndeliveredPending === true) return false;
  if (typeof prompt !== "string" || !prompt.trim()) return false;
  if (isHarnessFollowupMessage(prompt)) return false;
  const n = finiteNumberOrNull(
    payload.invocationNum ?? payload.invocation_num,
  );
  if (n == null) return false;
  if (n === 0) return true;
  if (n === 1) {
    const steps = finiteNumberOrNull(
      payload.initialNumSteps ?? payload.initial_num_steps,
    );
    return steps === 0;
  }
  return false;
}

/** Coerce host JSON number-or-decimal-integer-string; reject NaN/Infinity/blank/hex. */
function finiteNumberOrNull(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    // Decimal integers only — Number("0x10")/Number("1e3") would mis-parse counters.
    if (!/^[+-]?\d+$/.test(t)) return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toolNameFromEdit(payload: AntigravityEditPayload): string {
  const fromCall =
    payload.toolCall?.name ??
    payload.tool_call?.name ??
    payload.toolName ??
    payload.tool_name;
  return typeof fromCall === "string" ? fromCall.trim() : "";
}

function toolArgsFromEdit(
  payload: AntigravityEditPayload,
): Record<string, unknown> | null {
  const fromCall = payload.toolCall?.args ?? payload.tool_call?.args;
  if (fromCall && typeof fromCall === "object" && !Array.isArray(fromCall)) {
    return fromCall as Record<string, unknown>;
  }
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

export function isAntigravityEditTool(toolName: unknown): boolean {
  if (typeof toolName !== "string") return false;
  const n = toolName.trim();
  return (
    n === "write_to_file" ||
    n === "replace_file_content" ||
    n === "multi_replace_file_content"
  );
}

export function filePathsFromAntigravityEdit(
  payload: AntigravityEditPayload,
): string[] {
  const args = toolArgsFromEdit(payload);
  if (!args) return [];
  const candidates = [
    args.TargetFile,
    args.targetFile,
    args.target_file,
    args.AbsolutePath,
    args.absolutePath,
    args.file_path,
    args.filePath,
    args.path,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() && !/[\0\r\n]/.test(c)) {
      const t = c.trim();
      if (t.split(/[/\\]/).includes("..")) continue;
      return [t];
    }
  }
  return [];
}

function stampAntigravityPlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  if (!session || session.platform === ANTIGRAVITY_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: ANTIGRAVITY_PLATFORM,
  });
}

/** Best-effort stamp — must not clobber injectEphemeral / claim rollback paths. */
function stampAntigravityPlatformBestEffort(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  try {
    stampAntigravityPlatform(store, conversationId, projectRoot);
  } catch {
    /* best-effort */
  }
}

/**
 * PreInvocation → core triggers / FSM.
 * Prompt must be supplied via opts/payload attachment or transcript read (R2).
 * Cannot discard user input — needPick / errors use injectSteps only.
 */
export function handlePreInvocation(
  store: StateStore,
  payload: AntigravityPreInvocationPayload,
  projectRoot: string,
  portConfig?: AntigravityPortConfig,
  opts?: { userPrompt?: string },
): AntigravityPreInvocationResult {
  try {
    return handlePreInvocationInner(
      store,
      payload,
      projectRoot,
      portConfig,
      opts,
    );
  } catch {
    return {};
  }
}

export const handleAntigravityPreInvocation = handlePreInvocation;

function handlePreInvocationInner(
  store: StateStore,
  payload: AntigravityPreInvocationPayload,
  projectRoot: string,
  portConfig?: AntigravityPortConfig,
  opts?: { userPrompt?: string },
): AntigravityPreInvocationResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  const prompt = resolveAntigravityUserPrompt(payload, opts);

  // Transcript fallback repeats the same USER_INPUT on every model call —
  // only process triggers / E8 clear once per distinct prompt (R2 cursor).
  // Do NOT clear recover/stuck pending before claim: mid-turn PreInvocation
  // re-entry would wipe an undelivered Stop recover tip (unlike once-per-UPS).
  const explicit = isExplicitAntigravityUserPrompt(payload, opts);
  const claim = claimAntigravityUserPrompt({
    projectRoot,
    conversationId,
    prompt,
    explicit,
  });
  if (claim.status !== "claimed") {
    stampAntigravityPlatformBestEffort(store, conversationId, projectRoot);
    return {};
  }

  // New distinct prompt claimed — same moment as Claude UPS: drop recover/stuck
  // tip the user has moved past.
  try {
    store.clearPendingFollowupIf(
      conversationId,
      isRecoverOrStuckFollowupMessage,
    );
  } catch {
    /* best-effort */
  }

  /** After a successful apply/FSM side-effect, do not rollback on later throw. */
  const release = { rollbackOnThrow: true };
  const rollbackClaim = (): void => {
    // Fail-open claims never wrote the cursor — rolling back with previous:null
    // would delete a concurrent durable claim for the same prompt.
    if (!claim.persisted) {
      release.rollbackOnThrow = false;
      return;
    }
    rollbackAntigravityUserPromptClaim({
      projectRoot,
      conversationId,
      previous: claim.previous,
      expected: claim.prompt,
    });
    release.rollbackOnThrow = false;
  };

  try {
    return handlePreInvocationAfterClaim(
      store,
      payload,
      projectRoot,
      portConfig,
      conversationId,
      prompt,
      claim,
      rollbackClaim,
      release,
    );
  } catch {
    if (release.rollbackOnThrow) rollbackClaim();
    return {};
  }
}

function handlePreInvocationAfterClaim(
  store: StateStore,
  payload: AntigravityPreInvocationPayload,
  projectRoot: string,
  portConfig: AntigravityPortConfig | undefined,
  conversationId: string,
  prompt: string,
  claim: Extract<AntigravityPromptClaim, { status: "claimed" }>,
  rollbackClaim: () => void,
  release: { rollbackOnThrow: boolean },
): AntigravityPreInvocationResult {
  const markCommitted = (): void => {
    release.rollbackOnThrow = false;
    // Ephemeral fail-open success: persist so the next turn does not re-fire.
    if (!claim.persisted) {
      persistAntigravityUserPromptBestEffort({
        projectRoot,
        conversationId,
        prompt: claim.prompt,
      });
    }
  };

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
    "Autopilot could not apply this command. Check `npx autopilot-harness status`.";

  if (trigger) {
    if (trigger.kind === "off") {
      applyOff(store, conversationId);
      markCommitted();
      stampAntigravityPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
        platform: ANTIGRAVITY_PLATFORM,
      });
      if (!result.ok) {
        rollbackClaim();
        stampAntigravityPlatformBestEffort(
          store,
          conversationId,
          projectRoot,
        );
        return injectEphemeral(
          typeof result.userMessage === "string" && result.userMessage.trim()
            ? result.userMessage
            : gateFallback,
        );
      }
      markCommitted();
      stampAntigravityPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug,
      });
      if (!result.ok) {
        rollbackClaim();
        stampAntigravityPlatformBestEffort(
          store,
          conversationId,
          projectRoot,
        );
        return injectEphemeral(
          typeof result.userMessage === "string" && result.userMessage.trim()
            ? result.userMessage
            : gateFallback,
        );
      }
      markCommitted();
      stampAntigravityPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      markCommitted();
      stampAntigravityPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: ANTIGRAVITY_PLATFORM,
      });
      if (!result.ok) {
        // Channel A needPick already wrote pending_action + candidates — consume
        // this prompt once so transcript re-reads do not re-fire the pick.
        if (isChannelANeedPick(result)) {
          markCommitted();
          stampAntigravityPlatformBestEffort(
            store,
            conversationId,
            projectRoot,
          );
          return injectNeedPickContext(
            result.userMessage,
            result.candidates,
          );
        }
        rollbackClaim();
        stampAntigravityPlatformBestEffort(
          store,
          conversationId,
          projectRoot,
        );
        return injectEphemeral(
          typeof result.userMessage === "string" && result.userMessage.trim()
            ? result.userMessage
            : gateFallback,
        );
      }
      markCommitted();
      stampAntigravityPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: ANTIGRAVITY_PLATFORM,
      });
      if (!result.ok) {
        // Channel A needPick already wrote pending_action + candidates — consume
        // this prompt once so transcript re-reads do not re-fire the pick.
        if (isChannelANeedPick(result)) {
          markCommitted();
          stampAntigravityPlatformBestEffort(
            store,
            conversationId,
            projectRoot,
          );
          return injectNeedPickContext(
            result.userMessage,
            result.candidates,
          );
        }
        rollbackClaim();
        stampAntigravityPlatformBestEffort(
          store,
          conversationId,
          projectRoot,
        );
        return injectEphemeral(
          typeof result.userMessage === "string" && result.userMessage.trim()
            ? result.userMessage
            : gateFallback,
        );
      }
      markCommitted();
      stampAntigravityPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig, platform: ANTIGRAVITY_PLATFORM },
      );
      if (!result.ok) {
        // Defensive: applyTrackPick does not return Channel A needPick today.
        if (isChannelANeedPick(result)) {
          markCommitted();
          stampAntigravityPlatformBestEffort(
            store,
            conversationId,
            projectRoot,
          );
          return injectNeedPickContext(
            result.userMessage,
            result.candidates,
          );
        }
        rollbackClaim();
        stampAntigravityPlatformBestEffort(
          store,
          conversationId,
          projectRoot,
        );
        return injectEphemeral(
          typeof result.userMessage === "string" && result.userMessage.trim()
            ? result.userMessage
            : gateFallback,
        );
      }
      markCommitted();
      stampAntigravityPlatform(store, conversationId, projectRoot);
      return {};
    }
    rollbackClaim();
    return {};
  }

  const pendingText = store.getReviewChain(conversationId)?.pending_followup;
  const hasUndeliveredPending =
    typeof pendingText === "string" && pendingText.trim().length > 0;
  if (
    shouldClearChainPendingOnAntigravityPreInvocation(payload, prompt, {
      hasUndeliveredPending,
    })
  ) {
    store.clearChainPending(conversationId);
  }
  // Non-trigger path consumed this prompt (E8 clear or no-op) — keep claim.
  markCommitted();
  stampAntigravityPlatform(store, conversationId, projectRoot);
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
      ANTIGRAVITY_PLATFORM,
    );
  }
  stampAntigravityPlatform(store, conversationId, projectRoot);
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
 * PostToolUse → markCodeEdited for file-edit tools.
 * Always returns `{}` (docs) — never deny.
 */
export function handlePostToolUse(
  store: StateStore,
  payload: AntigravityEditPayload,
  projectRoot: string,
): AntigravityPostToolUseResult {
  try {
    handlePostToolUseInner(store, payload, projectRoot);
  } catch {
    /* fail-open */
  }
  return {};
}

export const handleAntigravityPostToolUse = handlePostToolUse;

function handlePostToolUseInner(
  store: StateStore,
  payload: AntigravityEditPayload,
  projectRoot: string,
): void {
  const conversationId = sid(payload);
  const toolName = toolNameFromEdit(payload);
  if (!conversationId || !isAntigravityEditTool(toolName)) return;

  // Failed tool reports should not arm product-edit review.
  if (antigravityErrorFieldText(payload.error)) return;

  const filePaths = filePathsFromAntigravityEdit(payload);
  if (filePaths.length === 0) {
    stampAntigravityPlatform(store, conversationId, projectRoot);
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
    stampAntigravityPlatform(store, conversationId, projectRoot);
  }
}

function continueFromFollowupAction(
  action: FollowupAction | null,
): AntigravityStopResult {
  if (!action?.message) return {};
  const reason = clipText(
    followupReason(action.message, "Autopilot followup"),
    MAX_HOOK_STDIO_CHARS,
  );
  if (!action.loop) {
    // Hard-stop tip: host has no Claude-style block; allow stop with empty body.
    // (Followup already stored as pending for RESUME / later redelivery.)
    return {};
  }
  return {
    decision: "continue",
    reason,
  };
}

/**
 * Stop → ReviewEngine.
 * Continue: `{ decision:"continue", reason }` (research lock).
 * `fullyIdle !== true` → fail-open `{}` for completed/error continue (do not notify on completed mid-tool).
 * Abort: always notify, never continue.
 * Error: always notify; continue recover tip only when fullyIdle.
 * Unknown terminationReason (completed): notify engine, never continue.
 */
export function handleStop(
  engine: ReviewEngine,
  payload: AntigravityStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): AntigravityStopResult {
  try {
    return handleStopInner(engine, payload, opts);
  } catch {
    return {};
  }
}

export const handleAntigravityStop = handleStop;

function handleStopInner(
  engine: ReviewEngine,
  payload: AntigravityStopPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): AntigravityStopResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  const status = normalizeAntigravityStopStatus(payload, opts);

  const transcriptPath = sanitizeAntigravityTranscriptPath(
    payload.transcriptPath ?? payload.transcript_path,
  );

  // User abort: notify freeze/disarm even when fullyIdle=false; never continue
  // (recover would fight the interrupt).
  if (status === "aborted") {
    engine.handleStop({
      conversationId,
      status,
      loopCount: loopCountFromExecutionNum(payload),
      transcriptPath,
      platform: ANTIGRAVITY_PLATFORM,
    });
    return {};
  }

  // Error: always notify ReviewEngine (recover/pause bookkeeping). Continue with
  // recover tip only when fullyIdle — research lock for Antigravity continue.
  if (status === "error") {
    const action = engine.handleStop({
      conversationId,
      status,
      loopCount: loopCountFromExecutionNum(payload),
      transcriptPath,
      platform: ANTIGRAVITY_PLATFORM,
    });
    if (!isAntigravityFullyIdle(payload)) return {};
    return continueFromFollowupAction(action);
  }

  // Mid-tool / not idle completed: do not advance review and do not continue.
  if (!isAntigravityFullyIdle(payload)) {
    return {};
  }

  // Always notify ReviewEngine on idle completed stops so FSM/review can
  // progress even when the host uses an unknown terminationReason.
  const action = engine.handleStop({
    conversationId,
    status,
    loopCount: loopCountFromExecutionNum(payload),
    transcriptPath,
    platform: ANTIGRAVITY_PLATFORM,
  });

  // Unknown / non-completion reasons: fail-closed for continue only (research).
  if (!isAntigravityStopCompletionReason(payload)) {
    return {};
  }

  return continueFromFollowupAction(action);
}
