import os from "node:os";
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

/** Hermes shell-hook envelope (top-level + event kwargs in `extra`). */
export interface HermesHookPayload {
  hook_event_name?: string;
  hookEventName?: string;
  tool_name?: string | null;
  toolName?: string | null;
  tool_input?: Record<string, unknown> | string | null;
  toolInput?: Record<string, unknown> | string | null;
  session_id?: string;
  sessionId?: string;
  cwd?: string;
  profile?: string;
  extra?: Record<string, unknown>;
  /**
   * Some hosts flatten user_message onto the root.
   * Hermes may pass a string, content list, or single content-part object.
   */
  user_message?: string | readonly unknown[] | Record<string, unknown>;
  userMessage?: string | readonly unknown[] | Record<string, unknown>;
  prompt?: string | readonly unknown[] | Record<string, unknown>;
}

export type HermesSubmitPayload = HermesHookPayload;
export type HermesEditPayload = HermesHookPayload;
export type HermesPreVerifyPayload = HermesHookPayload;

export interface HermesPortConfig {
  phaseActions?: PhaseActionConfig;
}

export const HERMES_PLATFORM = "hermes-agent";

/**
 * Research 2026-09-15 (local Hermes v0.21.3): shell `_parse_pre_verify`
 * maps decision:block / action:continue → continue. See research-hermes-hooks.md.
 */
export const HERMES_SHELL_PRE_VERIFY_CONTINUE_SUPPORTED = true;
/** Soft doctor tip — builds with `_parse_pre_verify` in shell_hooks. */
export const HERMES_SOFT_MIN_VERSION = "0.21.3";
/** Primary continue shape (Claude Stop); Hermes-native also accepted by host. */
export const HERMES_PRE_VERIFY_PRIMARY = "decision:block+reason";
/** Init writes this under `agent.max_verify_nudges` (raise only; never lower user higher). */
export const HERMES_INIT_MAX_VERIFY_NUDGES = 32;
/** Host default when unset. */
export const HERMES_DEFAULT_MAX_VERIFY_NUDGES = 3;
export const HERMES_ENV_HOME = "HERMES_HOME";
/** post_tool_call matcher (regex fullmatch). */
export const HERMES_POST_TOOL_MATCHER = "write_file|patch";

export const MAX_NEED_PICK_SLUGS = 40;
export const MAX_NEED_PICK_CONTEXT_CHARS = 2_000;
export const MAX_HOOK_STDIO_CHARS = 8_192;
export const MAX_TOOL_ARGS_JSON_CHARS = 1_048_576;
/** Cap host-reported changed_paths / edit path lists (DoS / pathological payloads). */
export const MAX_HERMES_CHANGED_PATHS = 256;
/** Reject absurd path strings from hostile tool_input / changed_paths. */
export const MAX_HERMES_PATH_CHARS = 4_096;
/** Cap V4A / multi-file patch body parse size. */
export const MAX_HERMES_PATCH_BODY_CHARS = 1_048_576;

/**
 * pre_llm_call / pre_verify stdout.
 * Allow / hard-stop: empty-field object → runner should emit `{}` (research lock).
 * Inject: `{ context }`. Continue: `{ decision:"block", reason }`.
 */
export interface HermesHookResult {
  context?: string;
  decision?: "block";
  reason?: string;
  /** Hermes-native continue (optional; primary is decision+reason). */
  action?: "continue";
  message?: string;
}

/** True when result has no defined fields → allow / silence (`{}` wire). */
export function isHermesAllowNoop(
  result: HermesHookResult | null | undefined,
): boolean {
  if (result == null || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }
  for (const value of Object.values(result as Record<string, unknown>)) {
    if (value !== undefined && value !== null) return false;
  }
  return true;
}

function sid(p: HermesHookPayload): string {
  for (const v of [p.session_id, p.sessionId]) {
    if (typeof v === "string") {
      const t = v.trim();
      // Match StateStore.isConversationIdOk — refuse controls before any mutation.
      if (t && !/[\u0000-\u001f\u007f]/.test(t)) return t;
    }
  }
  const extra = p.extra;
  if (extra && typeof extra === "object") {
    // Do NOT use parent_session_id — would stamp Autopilot state onto the parent
    // when a child/subagent envelope leaks into this hook.
    for (const key of ["session_id", "sessionId"]) {
      const v = extra[key];
      if (typeof v === "string") {
        const t = v.trim();
        if (t && !/[\u0000-\u001f\u007f]/.test(t)) return t;
      }
    }
  }
  return "";
}

function extraOf(p: HermesHookPayload): Record<string, unknown> {
  return p.extra && typeof p.extra === "object" && !Array.isArray(p.extra)
    ? p.extra
    : {};
}

function clipText(text: string, max = MAX_HOOK_STDIO_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function blockReason(message: string | undefined, fallback: string): string {
  const m = typeof message === "string" ? message.trim() : "";
  return m || fallback;
}

/** True for POSIX absolute or Windows drive-absolute lexical paths. */
function isAbsoluteLexicalPath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:\//i.test(p);
}

/** `/` or `C:/` — never a usable Autopilot project root. */
function isFilesystemRootPath(p: string): boolean {
  return p === "/" || /^[A-Za-z]:\/?$/i.test(p);
}

/** True when a path segment is exactly `.hermes` (profile / agent home trees). */
function isHermesDotDirTree(p: string): boolean {
  // Case-insensitive: APFS/Windows may treat `.Hermes` as the same directory.
  return p.split("/").some((seg) => seg.toLowerCase() === ".hermes");
}

/** Absolute, non-root, and not under a `.hermes` directory segment. */
function isUsableHermesWorkspaceRoot(p: string): boolean {
  return (
    isAbsoluteLexicalPath(p) &&
    !isFilesystemRootPath(p) &&
    !isHermesDotDirTree(p)
  );
}

/**
 * Collapse `.` / `..` and unify separators without touching the real filesystem
 * (avoids process.cwd / symlink TOCTOU). Closes `/proj/../.hermes/agent` bypasses.
 */
function normalizeLexicalPath(input: string): string {
  const raw = input.replace(/\\/g, "/");
  const win = raw.match(/^([A-Za-z]:)(\/.*)?$/);
  if (win) {
    const drive = `${win[1]!.toUpperCase()}/`;
    const body = (win[2] ?? "/").replace(/^\//, "");
    return drive + collapsePathSegments(body).join("/");
  }
  const abs = raw.startsWith("/");
  const collapsed = collapsePathSegments(raw);
  if (abs) {
    return collapsed.length === 0 ? "/" : `/${collapsed.join("/")}`;
  }
  return collapsed.join("/");
}

function collapsePathSegments(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

/** POSIX-normalized prefix check (Hermes home guard; not a full realpath resolve). */
function isPathEqualOrUnder(candidate: string, root: string): boolean {
  const c = normalizeLexicalPath(candidate);
  const r = normalizeLexicalPath(root);
  // Filesystem root as "home" must not block every path — only exact root.
  if (isFilesystemRootPath(r)) {
    return c === r;
  }
  return c === r || c.startsWith(`${r}/`);
}

/**
 * Prefer install-root, then stdin cwd.
 * Never returns process.cwd(). Do **not** fall back to HERMES_HOME — that is the
 * profile config home, not the instrumented project (would mis-root Autopilot state).
 * Also refuse stdin cwd when it is equal to / nested under HERMES_HOME (Hermes shell
 * sets `cwd` to `Path.cwd()`, often the agent clone under `~/.hermes/...`).
 * Always also refuse the Hermes default `~/.hermes` tree — profile HERMES_HOME may
 * point at `~/.hermes/profiles/<name>` while the agent cwd stays under `~/.hermes/`.
 */
export function resolveHermesWorkspaceRoot(opts: {
  installRoot?: string;
  env?: NodeJS.ProcessEnv;
  stdinCwd?: string;
}): string | null {
  const clean = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    let t = value.trim();
    if (!t || /[\0\r\n]/.test(t)) return null;
    // Drop trailing separators (keep a lone filesystem root as-is for later guards).
    if (!/^([A-Za-z]:)?[/\\]+$/i.test(t)) {
      t = t.replace(/[/\\]+$/, "");
    }
    return t || null;
  };
  const installRaw = clean(opts.installRoot);
  if (installRaw) {
    const install = normalizeLexicalPath(installRaw);
    // Same bar as stdin cwd: absolute, non-root, not a `.hermes` tree.
    if (!isUsableHermesWorkspaceRoot(install)) {
      return null;
    }
    return install;
  }

  const cwdRaw = clean(opts.stdinCwd);
  if (!cwdRaw) return null;
  // Hermes shell `cwd` is Path.cwd() (absolute). Relative stdin cwd can collapse
  // via `..` into `.hermes/...` and bypass absolute HERMES_HOME prefix checks.
  const cwd = normalizeLexicalPath(cwdRaw);
  if (!isUsableHermesWorkspaceRoot(cwd)) return null;

  // Match factory: omit `env` → read process.env (guard must not depend on caller passing it).
  const env = opts.env ?? process.env;
  const blockedHomes = new Set<string>();
  const envHome = clean(env[HERMES_ENV_HOME]);
  if (envHome) {
    const home = normalizeLexicalPath(envHome);
    if (isAbsoluteLexicalPath(home) && !isFilesystemRootPath(home)) {
      blockedHomes.add(home);
    }
  }
  const defaultHome = defaultHermesHomeDir(clean);
  if (defaultHome) blockedHomes.add(normalizeLexicalPath(defaultHome));
  for (const home of blockedHomes) {
    if (isPathEqualOrUnder(cwd, home)) return null;
  }
  return cwd;
}

function defaultHermesHomeDir(
  clean: (value: unknown) => string | null,
): string | null {
  try {
    return clean(path.join(os.homedir(), ".hermes"));
  } catch {
    return null;
  }
}

/** `extra.attempt` → ReviewEngine loopCount (0 when absent/invalid). */
export function loopCountFromHermesAttempt(
  payload: HermesPreVerifyPayload,
): number {
  const raw = extraOf(payload).attempt;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return 0;
}

/** Non-text multimodal part types (aligned with Hermes `message_content` + video types). */
const HERMES_NON_TEXT_PART_TYPES = new Set([
  "image",
  "image_url",
  "input_image",
  "audio",
  "input_audio",
  "file",
  "input_file",
  "document",
  "video",
  "video_url",
  "input_video",
]);

/** Text field keys — Hermes `message_content._TEXT_KEYS` (no generic `value`). */
const HERMES_TEXT_PART_KEYS = [
  "text",
  "content",
  "input_text",
  "output_text",
  "summary_text",
] as const;

/** True when a content-list item is a non-text multimodal part (image/audio/file/video). */
function isNonTextHermesContentPart(o: Record<string, unknown>): boolean {
  const typeRaw =
    typeof o.type === "string" ? o.type.trim().toLowerCase() : "";
  if (typeRaw && HERMES_NON_TEXT_PART_TYPES.has(typeRaw)) return true;
  // Untyped / alternate shapes that still carry media payloads.
  return (
    "image_url" in o ||
    "imageUrl" in o ||
    "video_url" in o ||
    "videoUrl" in o
  );
}

function textFromOneHermesContentPart(o: Record<string, unknown>): string {
  if (isNonTextHermesContentPart(o)) return "";
  for (const key of HERMES_TEXT_PART_KEYS) {
    const t = o[key];
    if (typeof t === "string" && t.trim()) {
      return t.length > MAX_HOOK_STDIO_CHARS
        ? t.slice(0, MAX_HOOK_STDIO_CHARS)
        : t;
    }
  }
  return "";
}

/**
 * Flatten Hermes `user_message` for triggers / chain guards.
 * Host may pass a string, a multimodal content list, or a single content part
 * object (parity with Hermes `flatten_message_text`).
 * Skips image/audio/file/video parts so urls/base64 are not treated as prompt text.
 */
function textFromHermesContent(value: unknown): string {
  if (typeof value === "string") {
    if (!value.trim()) return "";
    return value.length > MAX_HOOK_STDIO_CHARS
      ? value.slice(0, MAX_HOOK_STDIO_CHARS)
      : value;
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    let used = 0;
    for (const item of value.slice(0, 64)) {
      const remain = MAX_HOOK_STDIO_CHARS - used;
      if (remain <= 0) break;
      let piece = "";
      if (typeof item === "string") {
        piece = item.trim() ? item : "";
      } else if (item && typeof item === "object" && !Array.isArray(item)) {
        piece = textFromOneHermesContentPart(item as Record<string, unknown>);
      }
      if (!piece) continue;
      if (piece.length > remain) piece = piece.slice(0, remain);
      parts.push(piece);
      used += piece.length + 1;
    }
    return parts.join("\n");
  }
  // Single content-part object (not wrapped in a list). null is typeof "object".
  if (value && typeof value === "object") {
    return textFromOneHermesContentPart(value as Record<string, unknown>);
  }
  return "";
}

export function userMessageFromHermesSubmit(
  payload: HermesSubmitPayload,
): string {
  for (const root of [
    payload.user_message,
    payload.userMessage,
    payload.prompt,
  ]) {
    const text = textFromHermesContent(root);
    if (text) return text;
  }
  const extra = extraOf(payload);
  for (const key of ["user_message", "userMessage", "prompt"]) {
    const text = textFromHermesContent(extra[key]);
    if (text) return text;
  }
  return "";
}

function isSafeHermesPath(raw: string): boolean {
  const t = raw.trim();
  return (
    t.length > 0 &&
    t.length <= MAX_HERMES_PATH_CHARS &&
    !/[\0\r\n]/.test(t)
  );
}

export function changedPathsFromHermesPreVerify(
  payload: HermesPreVerifyPayload,
): string[] {
  const raw = extraOf(payload).changed_paths ?? extraOf(payload).changedPaths;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const p of raw) {
    if (out.length >= MAX_HERMES_CHANGED_PATHS) break;
    if (typeof p === "string" && isSafeHermesPath(p)) out.push(p.trim());
  }
  return out;
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
      ? `[Autopilot] Select a plan to execute:\n\n${slugs
          .map((s, i) => `  ${i + 1}. ${s}`)
          .join("\n")}\n\nReply with a number or /autopilot-run <slug>.`
      : "[Autopilot] Select a plan to execute. Reply with a number or /autopilot-run <slug>.");

  if (ctx.length > MAX_NEED_PICK_CONTEXT_CHARS) {
    ctx = `${ctx.slice(0, MAX_NEED_PICK_CONTEXT_CHARS - 1)}…`;
  }
  return ctx;
}

/** Hermes cannot discard the user prompt — inject guidance as context. */
export function injectContext(text: string): HermesHookResult {
  const t = text.trim();
  if (!t) return {};
  return { context: clipText(t, MAX_NEED_PICK_CONTEXT_CHARS + 256) };
}

export function injectNeedPickContext(
  userMessage: unknown,
  candidates?: ReadonlyArray<{ slug?: string }>,
): HermesHookResult {
  return injectContext(buildNeedPickContext(userMessage, candidates));
}

function parseToolInput(
  payload: HermesEditPayload,
): Record<string, unknown> | null {
  const raw = payload.tool_input ?? payload.toolInput;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    if (raw.length > MAX_TOOL_ARGS_JSON_CHARS) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse paths from Hermes V4A / multi-file `patch` bodies
 * (`*** Add|Update|Delete File:`, `*** Move|Rename File: a -> b`, `+++` lines).
 */
export function pathsFromHermesPatchBody(command: string): string[] {
  if (typeof command !== "string" || !command.trim()) return [];
  const text =
    command.length > MAX_HERMES_PATCH_BODY_CHARS
      ? command.slice(0, MAX_HERMES_PATCH_BODY_CHARS)
      : command;
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    if (found.length >= MAX_HERMES_CHANGED_PATHS) return;
    let p = raw.trim();
    if (!isSafeHermesPath(p) || p === "/dev/null") return;
    p = p.replace(/^[ab]\//, "");
    if (!isSafeHermesPath(p) || seen.has(p)) return;
    seen.add(p);
    found.push(p);
  };

  for (const line of text.split(/\r?\n/)) {
    if (found.length >= MAX_HERMES_CHANGED_PATHS) break;
    // Hermes uses `Move File`; Codex/Factory often use `Rename File`. Accept both.
    // `\s*` after *** — Hermes allows `***Update File:` (no space).
    const rename = line.match(
      /^\*\*\*\s*(?:Rename|Move)\s+File:\s*(.+?)\s*->\s*(.+?)\s*$/i,
    );
    if (rename?.[1] && rename[2]) {
      push(rename[1]);
      push(rename[2]);
      continue;
    }
    const header = line.match(
      /^\*\*\*\s*(?:Add|Update|Delete)\s+File:\s*(.+?)\s*$/i,
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

export function filePathsFromHermesEdit(
  payload: HermesEditPayload,
): string[] {
  const input = parseToolInput(payload);
  if (!input) return [];
  // Match Hermes patch_tool: union top-level path with V4A header paths
  // (mode=patch may set both; preferring path alone would miss body files or
  // arm only a plans/ path while product files live in the patch body).
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    if (found.length >= MAX_HERMES_CHANGED_PATHS) return;
    const t = raw.trim();
    if (!isSafeHermesPath(t) || seen.has(t)) return;
    seen.add(t);
    found.push(t);
  };
  for (const c of [
    input.path,
    input.file_path,
    input.filePath,
    input.target_file,
    input.targetFile,
  ]) {
    if (typeof c === "string") push(c);
  }
  for (const key of ["patch", "command"] as const) {
    const body = input[key];
    if (typeof body === "string" && body.trim()) {
      for (const p of pathsFromHermesPatchBody(body)) push(p);
    }
  }
  return found;
}

export function isHermesEditTool(toolName: string): boolean {
  const n = toolName.trim();
  return n === "write_file" || n === "patch";
}

function stampHermesPlatform(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): void {
  const session = store.getSession(conversationId);
  if (!session || session.platform === HERMES_PLATFORM) return;
  store.upsertSession({
    conversation_id: conversationId,
    project_root: session.project_root || projectRoot,
    code_root: session.code_root || projectRoot,
    platform: HERMES_PLATFORM,
  });
}

function gateContext(
  userMessage: unknown,
  fallback: string,
): HermesHookResult {
  return injectContext(
    blockReason(
      typeof userMessage === "string" ? userMessage : undefined,
      fallback,
    ),
  );
}

/**
 * pre_llm_call → core triggers / FSM.
 * Inject `{ context }` for needPick / busy / hard errors (cannot discard prompt).
 * Allow → `{}` (runner emits JSON `{}`).
 */
export function handlePreLlmCall(
  store: StateStore,
  payload: HermesSubmitPayload,
  projectRoot: string,
  portConfig?: HermesPortConfig,
): HermesHookResult {
  try {
    return handlePreLlmCallInner(store, payload, projectRoot, portConfig);
  } catch {
    return {};
  }
}

export const handleHermesPreLlmCall = handlePreLlmCall;
/** @deprecated Alias for UPS-shaped call sites. */
export const handleUserPromptSubmit = handlePreLlmCall;

function handlePreLlmCallInner(
  store: StateStore,
  payload: HermesSubmitPayload,
  projectRoot: string,
  portConfig?: HermesPortConfig,
): HermesHookResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  const prompt = userMessageFromHermesSubmit(payload);

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
      stampHermesPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "on") {
      const result = applyOn(store, conversationId, projectRoot, {
        initialBrief: trigger.initialBrief,
        slug: trigger.slug,
        platform: HERMES_PLATFORM,
      });
      stampHermesPlatform(store, conversationId, projectRoot);
      if (!result.ok) return gateContext(result.userMessage, gateFallback);
      return {};
    }
    if (trigger.kind === "resume") {
      const result = applyResume(store, conversationId, {
        slug: trigger.slug,
      });
      stampHermesPlatform(store, conversationId, projectRoot);
      if (!result.ok) return gateContext(result.userMessage, gateFallback);
      return {};
    }
    if (trigger.kind === "resume_review") {
      applyResumeReview(store, conversationId);
      stampHermesPlatform(store, conversationId, projectRoot);
      return {};
    }
    if (trigger.kind === "run") {
      const result = applyRun(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: HERMES_PLATFORM,
      });
      stampHermesPlatform(store, conversationId, projectRoot);
      if (!result.ok) {
        if (isChannelANeedPick(result)) {
          return injectNeedPickContext(result.userMessage, result.candidates);
        }
        return gateContext(result.userMessage, gateFallback);
      }
      return {};
    }
    if (trigger.kind === "replan") {
      const result = applyReplan(store, conversationId, projectRoot, {
        slug: trigger.slug,
        config: actionConfig,
        platform: HERMES_PLATFORM,
      });
      stampHermesPlatform(store, conversationId, projectRoot);
      if (!result.ok) {
        if (isChannelANeedPick(result)) {
          return injectNeedPickContext(result.userMessage, result.candidates);
        }
        return gateContext(result.userMessage, gateFallback);
      }
      return {};
    }
    if (trigger.kind === "track_pick" && trigger.trackPick) {
      const result = applyTrackPick(
        store,
        conversationId,
        projectRoot,
        trigger.trackPick,
        { config: actionConfig, platform: HERMES_PLATFORM },
      );
      stampHermesPlatform(store, conversationId, projectRoot);
      if (!result.ok) {
        if (isChannelANeedPick(result)) {
          return injectNeedPickContext(result.userMessage, result.candidates);
        }
        return gateContext(result.userMessage, gateFallback);
      }
      return {};
    }
    return {};
  }

  // pre_verify continue may re-enter as a synthetic user turn — harness-owned.
  if (!isHarnessFollowupMessage(prompt)) {
    store.clearChainPending(conversationId);
  }
  stampHermesPlatform(store, conversationId, projectRoot);
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
      HERMES_PLATFORM,
    );
  }
  stampHermesPlatform(store, conversationId, projectRoot);
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

function armPaths(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
  filePaths: readonly string[],
): void {
  if (filePaths.length === 0) {
    stampHermesPlatform(store, conversationId, projectRoot);
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
    stampHermesPlatform(store, conversationId, projectRoot);
  }
}

/**
 * post_tool_call → markCodeEdited for write_file / patch.
 * Observer only — never block.
 */
export function handlePostToolCall(
  store: StateStore,
  payload: HermesEditPayload,
  projectRoot: string,
): void {
  try {
    handlePostToolCallInner(store, payload, projectRoot);
  } catch {
    /* fail-open */
  }
}

export const handleHermesPostToolCall = handlePostToolCall;
/** @deprecated Alias for PostToolUse-shaped call sites. */
export const handlePostToolUse = handlePostToolCall;

function handlePostToolCallInner(
  store: StateStore,
  payload: HermesEditPayload,
  projectRoot: string,
): void {
  const conversationId = sid(payload);
  const toolName = String(payload.tool_name ?? payload.toolName ?? "").trim();
  if (!conversationId || !isHermesEditTool(toolName)) return;
  armPaths(
    store,
    conversationId,
    projectRoot,
    filePathsFromHermesEdit(payload),
  );
}

export function collectHermesErrorText(
  payload: HermesPreVerifyPayload,
): string {
  const extra = extraOf(payload);
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) parts.push(value);
  };
  push(extra.error);
  push(extra.error_message);
  push(extra.message);
  return clipText(parts.join("\n"));
}

export function normalizeHermesStopStatus(
  payload: HermesPreVerifyPayload,
  opts?: { status?: "completed" | "error" | "aborted" },
): "completed" | "error" | "aborted" {
  if (opts?.status === "aborted") return "aborted";
  if (opts?.status === "error") {
    const errText = collectHermesErrorText(payload);
    if (isUserAbortText(errText)) return "aborted";
    return "error";
  }
  const errText = collectHermesErrorText(payload);
  if (isUserAbortText(errText)) return "aborted";
  return opts?.status ?? "completed";
}

/**
 * pre_verify → ReviewEngine.
 * Continue: `{ decision:"block", reason }` (Claude Stop; shell maps to continue).
 * Hard-stop / no followup: `{}`.
 * Also arms from `changed_paths` (Post matcher backup).
 */
export function handlePreVerify(
  engine: ReviewEngine,
  store: StateStore,
  payload: HermesPreVerifyPayload,
  projectRoot: string,
  opts?: { status?: "completed" | "error" | "aborted" },
): HermesHookResult {
  try {
    return handlePreVerifyInner(engine, store, payload, projectRoot, opts);
  } catch {
    return {};
  }
}

export const handleHermesPreVerify = handlePreVerify;

function handlePreVerifyInner(
  engine: ReviewEngine,
  store: StateStore,
  payload: HermesPreVerifyPayload,
  projectRoot: string,
  opts?: { status?: "completed" | "error" | "aborted" },
): HermesHookResult {
  const conversationId = sid(payload);
  if (!conversationId) return {};

  // Backup dirty-arm from host-reported changed_paths.
  try {
    armPaths(
      store,
      conversationId,
      projectRoot,
      changedPathsFromHermesPreVerify(payload),
    );
  } catch {
    /* best-effort */
  }

  const status = normalizeHermesStopStatus(payload, opts);
  const action: FollowupAction | null = engine.handleStop({
    conversationId,
    status,
    loopCount: loopCountFromHermesAttempt(payload),
    platform: HERMES_PLATFORM,
  });

  if (!action?.message) return {};

  // Hard-stop (stuck / deliver-once): Hermes pre_verify has no stopReason channel —
  // return {} so the turn finishes; ReviewEngine keeps pending_followup for RESUME/nudge.
  if (!action.loop) return {};

  return {
    decision: "block",
    reason: clipText(
      blockReason(action.message, "Autopilot followup"),
      MAX_HOOK_STDIO_CHARS,
    ),
  };
}
