/**
 * Autopilot hook entry — marker: autopilot-harness
 * Installed at .autopilot/bin/autopilot-harness-hook.mjs (copy, not symlink).
 *
 * Prefers bundled vendor/runtime.mjs (shipped by init/upgrade) so empty
 * consumer projects work without @autopilot-harness/* in node_modules.
 * Falls back to project-local packages, then fail-open.
 *
 * Events:
 *   Cursor: beforeSubmitPrompt | afterFileEdit | stop
 *   Claude Code: UserPromptSubmit | PostToolUse | Stop | StopFailure
 *   Codex: UserPromptSubmit | PostToolUse | Stop (no StopFailure)
 *   Kimi Code: UserPromptSubmit | PostToolUse | Stop (exit 0/2 + stdio; no StopFailure)
 *   Copilot CLI: userPromptSubmitted | userPromptTransformed | postToolUse | agentStop
 *   Grok Build: UserPromptSubmit | PostToolUse | Stop (Codex-shaped; no StopFailure)
 *   Gemini CLI: BeforeAgent | AfterTool | AfterAgent (deny continue; no StopFailure)
 *   Factory Droid: UserPromptSubmit | PostToolUse | Stop (Claude-shaped; empty allow stdout)
 *   Hermes Agent: pre_llm_call | post_tool_call | pre_verify (context inject; never block Post)
 *   Antigravity: PreInvocation | PostToolUse | Stop (injectSteps; decision:continue+reason)
 *
 * Dispatch is explicit ten-way via --platform
 * (cursor | claude-code | codex | kimi-code | copilot-cli | grok-build | gemini-cli |
 * factory-droid | hermes-agent | antigravity). Shared PascalCase event names must NOT imply
 * Claude when platform is codex, kimi-code, copilot-cli, grok-build, gemini-cli,
 * factory-droid, hermes-agent, or antigravity. Copilot camelCase, Gemini
 * BeforeAgent/AfterTool/AfterAgent, Hermes snake_case, and Antigravity PreInvocation
 * are routed by stamp + event only.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = (() => {
  const resolved = path.resolve(__dirname, "..", "..");
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
})();

const CURSOR_EVENTS = new Set([
  "beforeSubmitPrompt",
  "afterFileEdit",
  "stop",
]);
const CLAUDE_EVENTS = new Set([
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
  "StopFailure",
]);
/** Codex/Kimi/Grok/Factory share submit/edit/stop names with Claude; routed by --platform only. */
const CODEX_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "Stop"]);
const KIMI_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "Stop"]);
const GROK_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "Stop"]);
const FACTORY_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "Stop"]);
/** Hermes Agent shell events (snake_case; unique — never share Pascal Stop). */
const HERMES_EVENTS = new Set(["pre_llm_call", "post_tool_call", "pre_verify"]);
/**
 * Antigravity host events. PreInvocation is unique; PostToolUse / Stop share
 * Pascal names with Claude continuum and are stamp-routed only.
 */
const ANTIGRAVITY_EVENTS = new Set([
  "PreInvocation",
  "PostToolUse",
  "Stop",
]);
/** Gemini CLI host event names (distinct from Claude PascalCase). */
const GEMINI_EVENTS = new Set(["BeforeAgent", "AfterTool", "AfterAgent"]);
/** Copilot CLI camelCase events (Transform is Copilot-only). */
const COPILOT_EVENTS = new Set([
  "userPromptSubmitted",
  "userPromptTransformed",
  "postToolUse",
  "agentStop",
]);
const KNOWN_PLATFORMS = new Set([
  "cursor",
  "claude-code",
  "codex",
  "kimi-code",
  "copilot-cli",
  "grok-build",
  "gemini-cli",
  "factory-droid",
  "hermes-agent",
  "antigravity",
]);

function parseArgs(argv) {
  const allowed = new Set([
    ...CURSOR_EVENTS,
    ...CLAUDE_EVENTS,
    ...CODEX_EVENTS,
    ...KIMI_EVENTS,
    ...GROK_EVENTS,
    ...FACTORY_EVENTS,
    ...HERMES_EVENTS,
    ...ANTIGRAVITY_EVENTS,
    ...GEMINI_EVENTS,
    ...COPILOT_EVENTS,
  ]);
  const out = { event: "beforeSubmitPrompt", platform: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--event" && argv[i + 1]) {
      const ev = String(argv[i + 1]);
      // Do not consume the next flag as a value (`--event --platform …`).
      if (ev.startsWith("--")) continue;
      i += 1;
      out.event = allowed.has(ev) ? ev : "beforeSubmitPrompt";
    } else if (argv[i] === "--platform" && argv[i + 1]) {
      const raw = String(argv[i + 1]);
      if (raw.startsWith("--")) continue;
      i += 1;
      const p = raw.trim().toLowerCase();
      out.platform = KNOWN_PLATFORMS.has(p) ? p : null;
    }
  }
  return out;
}

function isClaudeEvent(event) {
  return CLAUDE_EVENTS.has(event);
}

/**
 * Resolve host id: stamped --platform wins; legacy installs fall back to
 * event-name heuristics (Claude-shaped events → claude-code, else cursor).
 * Never map PascalCase events to Claude when --platform is codex, kimi-code,
 * copilot-cli, grok-build, gemini-cli, factory-droid, hermes-agent, or
 * antigravity. Copilot camelCase / Gemini BeforeAgent/AfterTool/AfterAgent /
 * Hermes snake_case / Antigravity PreInvocation without a stamp still need a host.
 */
function resolveHostId(declaredPlatform, event) {
  if (
    declaredPlatform === "cursor" ||
    declaredPlatform === "claude-code" ||
    declaredPlatform === "codex" ||
    declaredPlatform === "kimi-code" ||
    declaredPlatform === "copilot-cli" ||
    declaredPlatform === "grok-build" ||
    declaredPlatform === "gemini-cli" ||
    declaredPlatform === "factory-droid" ||
    declaredPlatform === "hermes-agent" ||
    declaredPlatform === "antigravity"
  ) {
    return declaredPlatform;
  }
  if (HERMES_EVENTS.has(event)) return "hermes-agent";
  if (event === "PreInvocation") return "antigravity";
  if (GEMINI_EVENTS.has(event)) return "gemini-cli";
  if (COPILOT_EVENTS.has(event)) return "copilot-cli";
  if (isClaudeEvent(event)) return "claude-code";
  return "cursor";
}

/** Strong Claude/Codex Stop markers (override a lying `--platform cursor`). */
function isPascalStopShapedPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const hookName = String(
    payload.hook_event_name ?? payload.hookEventName ?? "",
  ).trim();
  if (hookName === "Stop" || /^stopfailure$/i.test(hookName)) return true;
  if (
    typeof payload.stop_hook_active === "boolean" ||
    typeof payload.stopHookActive === "boolean"
  ) {
    return true;
  }
  return false;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function tryImport(specifier) {
  try {
    return await import(specifier);
  } catch {
    return null;
  }
}

function isSymlinkOrUnreadable(filePath) {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    // Cannot verify — refuse vendor load (fail-closed, match CLI policy).
    return true;
  }
}

/** Refuse vendor paths whose realpath escapes the project root. */
function realpathEscapesProject(filePath) {
  try {
    const realRoot = fs.realpathSync(projectRoot);
    const real = fs.realpathSync(filePath);
    return real !== realRoot && !real.startsWith(realRoot + path.sep);
  } catch {
    return true;
  }
}

async function loadVendorRuntime() {
  const vendorDir = path.join(__dirname, "vendor");
  const vendor = path.join(vendorDir, "runtime.mjs");
  const migDir = path.join(vendorDir, "migrations");
  const mig = path.join(migDir, "001_initial.sql");
  if (!fs.existsSync(vendor) || !fs.existsSync(mig)) return null;
  // Refuse symlink escape / unreadable lstat (same policy as CLI).
  if (
    isSymlinkOrUnreadable(vendorDir) ||
    isSymlinkOrUnreadable(vendor) ||
    isSymlinkOrUnreadable(migDir) ||
    isSymlinkOrUnreadable(mig)
  ) {
    return null;
  }
  if (realpathEscapesProject(vendor) || realpathEscapesProject(mig)) {
    return null;
  }
  return tryImport(pathToFileURL(vendor).href);
}

async function loadPortPackage(pkgName) {
  try {
    const require = createRequire(path.join(projectRoot, "package.json"));
    const resolved = require.resolve(pkgName);
    return tryImport(pathToFileURL(resolved).href);
  } catch {
    return null;
  }
}

async function loadCoreFromNodeModules() {
  return loadPortPackage("@autopilot-harness/core");
}

async function loadHostPortPackage(hostId) {
  if (hostId === "claude-code") {
    return loadPortPackage("@autopilot-harness/port-claude-code");
  }
  if (hostId === "codex") {
    return loadPortPackage("@autopilot-harness/port-codex");
  }
  if (hostId === "kimi-code") {
    return loadPortPackage("@autopilot-harness/port-kimi-code");
  }
  if (hostId === "copilot-cli") {
    return loadPortPackage("@autopilot-harness/port-copilot-cli");
  }
  if (hostId === "grok-build") {
    return loadPortPackage("@autopilot-harness/port-grok-build");
  }
  if (hostId === "gemini-cli") {
    return loadPortPackage("@autopilot-harness/port-gemini-cli");
  }
  if (hostId === "factory-droid") {
    return loadPortPackage("@autopilot-harness/port-factory-droid");
  }
  if (hostId === "hermes-agent") {
    return loadPortPackage("@autopilot-harness/port-hermes-agent");
  }
  if (hostId === "antigravity") {
    return loadPortPackage("@autopilot-harness/port-antigravity");
  }
  return loadPortPackage("@autopilot-harness/port-cursor");
}

/**
 * Fail-open shapes must match the host:
 * - Cursor submit → { continue: true }
 * - Claude/Codex UserPromptSubmit → {} (allow; no decision:block)
 * - Kimi Code → bare exit 0 (no stdout; avoid appending `{}` to context)
 * - Factory Droid → zero-byte stdout (never stringify `{}`)
 * - other events → {}
 */
function failOpen(event, platform = bootPlatform) {
  if (platform === "kimi-code") {
    // Do not clobber an intentional exit-2 reply (Stop continue / UPS gate)
    // if stdio already flushed and the reply slot is claimed.
    if (replied) return;
    process.exitCode = 0;
    replied = true;
    return;
  }
  if (platform === "factory-droid") {
    writeReply("");
    return;
  }
  // Hermes allow / Silence prefers JSON `{}` (research lock).
  if (platform === "hermes-agent") {
    writeReply("{}");
    return;
  }
  // Antigravity allow / Silence prefers JSON `{}` (injectSteps / continue scrub).
  if (platform === "antigravity") {
    writeReply("{}");
    return;
  }
  if (event === "beforeSubmitPrompt") {
    writeReply(JSON.stringify({ continue: true }));
  } else {
    writeReply("{}");
  }
}

/** At-most-once stdout so fail-open cannot append a second JSON blob. */
let replied = false;
function writeReply(text) {
  if (replied) return;
  process.stdout.write(text);
  // Set only after a successful write so failOpen can still retry on throw.
  replied = true;
}

/** Factory allow / Silence → zero-byte stdout (never JSON.stringify({})). */
function isFactoryEmptyStdoutResult(result) {
  if (result == null) return true;
  if (typeof result !== "object" || Array.isArray(result)) return false;
  for (const value of Object.values(result)) {
    if (value !== undefined && value !== null) return false;
  }
  return true;
}

/** Hermes allow / Silence → JSON `{}`; inject `{context}`; continue `{decision,reason}`. */
function isHermesAllowNoopResult(result, port) {
  if (port && typeof port.isHermesAllowNoop === "function") {
    try {
      return port.isHermesAllowNoop(result) === true;
    } catch {
      /* fall through */
    }
  }
  if (result == null) return true;
  if (typeof result !== "object" || Array.isArray(result)) return false;
  for (const value of Object.values(result)) {
    if (value !== undefined && value !== null) return false;
  }
  return true;
}

const HERMES_MAX_STDIO_CHARS = 8_192;

function clipHermesStdio(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  const truncated = text.length > HERMES_MAX_STDIO_CHARS;
  const bounded = truncated ? text.slice(0, HERMES_MAX_STDIO_CHARS) : text;
  const cleaned = bounded.includes("\0")
    ? bounded.replaceAll("\0", "")
    : bounded;
  if (cleaned.length === 0) return "";
  if (!truncated) return cleaned;
  return `${cleaned.slice(0, HERMES_MAX_STDIO_CHARS - 1)}…`;
}

function writeHermesReply(result, port) {
  if (isHermesAllowNoopResult(result, port)) {
    writeReply("{}");
    return;
  }
  if (result && typeof result === "object" && !Array.isArray(result)) {
    // Control-plane continue must beat inject (same ordering as Factory) so a
    // malformed result with both fields never emits pre_llm_call-shaped stdout.
    // Incomplete block (empty/NUL reason) silences — do not fall through to
    // context, or a continue attempt becomes inject.
    if (result.decision === "block") {
      const reason = clipHermesStdio(
        typeof result.reason === "string" ? result.reason.trim() : "",
      );
      if (reason.length > 0) {
        writeReply(JSON.stringify({ decision: "block", reason }));
        return;
      }
      writeReply("{}");
      return;
    }
    // Hermes-native continue (research: shell also accepts action+message).
    if (result.action === "continue") {
      const message = clipHermesStdio(
        typeof result.message === "string" ? result.message.trim() : "",
      );
      if (message.length > 0) {
        writeReply(JSON.stringify({ action: "continue", message }));
        return;
      }
      writeReply("{}");
      return;
    }
    const context = clipHermesStdio(
      typeof result.context === "string" ? result.context.trim() : "",
    );
    if (context.length > 0) {
      writeReply(JSON.stringify({ context }));
      return;
    }
  }
  writeReply("{}");
}

/** Antigravity allow / Silence → JSON `{}`; inject `{injectSteps}`; continue `{decision,reason}`. */
function isAntigravityAllowNoopResult(result, port) {
  if (port && typeof port.isAntigravityAllowNoop === "function") {
    try {
      return port.isAntigravityAllowNoop(result) === true;
    } catch {
      /* fall through */
    }
  }
  if (result == null) return true;
  if (typeof result !== "object" || Array.isArray(result)) return false;
  for (const value of Object.values(result)) {
    if (value !== undefined && value !== null) return false;
  }
  return true;
}

const ANTIGRAVITY_MAX_STDIO_CHARS = 8_192;

function clipAntigravityStdio(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  const truncated = text.length > ANTIGRAVITY_MAX_STDIO_CHARS;
  const bounded = truncated ? text.slice(0, ANTIGRAVITY_MAX_STDIO_CHARS) : text;
  // Match port stripHookControls then trim — drop C0/DEL (keep TAB/LF/CR in the
  // middle; leading/trailing whitespace removed after scrub so NULs that were
  // "padding fences" do not leave stray spaces).
  const cleaned = bounded.replace(
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
    "",
  );
  if (cleaned.length === 0) return "";
  const clipped = !truncated
    ? cleaned
    : `${cleaned.slice(0, ANTIGRAVITY_MAX_STDIO_CHARS - 1)}…`;
  return clipped.trim();
}

function writeAntigravityReply(result, port, opts) {
  // PreInvocation must never emit Stop `decision` (research lock).
  // Stop must never emit PreInvocation `injectSteps`.
  // Default both gates off → fail-closed `{}` if a call site omits opts.
  const o =
    opts && typeof opts === "object" && !Array.isArray(opts) ? opts : {};
  const allowContinue = o.allowContinue === true;
  const allowInject = o.allowInject === true;
  if (isAntigravityAllowNoopResult(result, port)) {
    writeReply("{}");
    return;
  }
  if (result && typeof result === "object" && !Array.isArray(result)) {
    if (allowContinue && result.decision === "continue") {
      const reason = clipAntigravityStdio(
        typeof result.reason === "string" ? result.reason : "",
      );
      if (reason.length > 0) {
        writeReply(JSON.stringify({ decision: "continue", reason }));
        return;
      }
      writeReply("{}");
      return;
    }
    if (allowInject) {
      const steps = result.injectSteps;
      if (Array.isArray(steps) && steps.length > 0) {
        const out = [];
        // Cap steps so a hostile/malformed port result cannot flood stdout.
        const limit = Math.min(steps.length, 8);
        for (let i = 0; i < limit; i++) {
          const step = steps[i];
          if (!step || typeof step !== "object" || Array.isArray(step)) continue;
          const msg = clipAntigravityStdio(
            typeof step.ephemeralMessage === "string"
              ? step.ephemeralMessage
              : "",
          );
          if (msg.length > 0) out.push({ ephemeralMessage: msg });
        }
        if (out.length > 0) {
          writeReply(JSON.stringify({ injectSteps: out }));
          return;
        }
      }
    }
  }
  writeReply("{}");
}

/** Bound + scrub NUL before Factory stdout (host may append to model context). */
const FACTORY_MAX_STDIO_CHARS = 8_192;

function clipFactoryStdio(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  const truncated = text.length > FACTORY_MAX_STDIO_CHARS;
  const bounded = truncated ? text.slice(0, FACTORY_MAX_STDIO_CHARS) : text;
  const cleaned = bounded.includes("\0")
    ? bounded.replaceAll("\0", "")
    : bounded;
  if (cleaned.length === 0) return "";
  if (!truncated) return cleaned;
  return `${cleaned.slice(0, FACTORY_MAX_STDIO_CHARS - 1)}…`;
}

/**
 * Factory stdout: empty allow/Silence; hard-stop continue:false (+stopReason);
 * UPS/Stop block+reason; UPS inject. Control-plane outcomes must beat inject
 * so a Stop (or malformed) result never emits UserPromptSubmit-shaped stdout.
 * Strip foreign host fields (Layer C / Claude extras) — never bare `{}`.
 */
function writeFactoryReply(result) {
  if (isFactoryEmptyStdoutResult(result)) {
    writeReply("");
    return;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    writeReply("");
    return;
  }
  // Hard-stop (deliver-once) — must win over block and over inject.
  if (result.continue === false) {
    const stopReason = clipFactoryStdio(
      typeof result.stopReason === "string" ? result.stopReason.trim() : "",
    );
    writeReply(
      JSON.stringify(
        stopReason.length > 0
          ? { continue: false, stopReason }
          : { continue: false },
      ),
    );
    return;
  }
  // Continue / UPS gate
  if (result.decision === "block") {
    const reason = clipFactoryStdio(
      typeof result.reason === "string" ? result.reason.trim() : "",
    );
    if (reason.length > 0) {
      writeReply(JSON.stringify({ decision: "block", reason }));
      return;
    }
  }
  // UPS inject only when no control-plane decision is present.
  const hso = result.hookSpecificOutput;
  if (hso && typeof hso === "object" && !Array.isArray(hso)) {
    const ctx = clipFactoryStdio(
      typeof hso.additionalContext === "string"
        ? hso.additionalContext.trim()
        : "",
    );
    if (ctx.length > 0) {
      writeReply(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: ctx,
          },
        }),
      );
      return;
    }
  }
  // Unknown non-empty shape → Silence (zero-byte), never stringify `{}`.
  writeReply("");
}

/**
 * Kimi Code I/O: exit 0 + optional stdout (UPS needPick), exit 2 + stderr
 * (gate / Stop continue). Never JSON-encode KimiHookResult for the host.
 * Stop must not emit stdout — Kimi may append exit-0 stdout to context.
 */
const KIMI_MAX_STDIO_CHARS = 8_192;

function clipKimiStdio(text) {
  if (typeof text !== "string" || text.length === 0) return "";
  // Bound before NUL scrub so a huge hostile payload cannot force large replaceAll.
  const truncated = text.length > KIMI_MAX_STDIO_CHARS;
  const bounded = truncated ? text.slice(0, KIMI_MAX_STDIO_CHARS) : text;
  const cleaned = bounded.includes("\0")
    ? bounded.replaceAll("\0", "")
    : bounded;
  if (cleaned.length === 0) return "";
  if (!truncated) return cleaned;
  // Match port-kimi clipHookText: keep total length ≤ MAX (ellipsis inclusive).
  return `${cleaned.slice(0, KIMI_MAX_STDIO_CHARS - 1)}…`;
}

function writeKimiReply(result, opts = {}) {
  if (replied) return;
  const allowStdout = opts.allowStdout !== false;
  const code =
    result && typeof result === "object" && result.exitCode === 2 ? 2 : 0;
  let ioDone = false;
  try {
    if (code === 2) {
      const err = clipKimiStdio(
        result && typeof result.stderr === "string" ? result.stderr : "",
      );
      if (err) process.stderr.write(err);
      ioDone = true;
      process.exitCode = 2;
    } else if (allowStdout) {
      const out = clipKimiStdio(
        result && typeof result.stdout === "string" ? result.stdout : "",
      );
      if (out) process.stdout.write(out);
      ioDone = true;
      process.exitCode = 0;
    } else {
      ioDone = true;
      process.exitCode = 0;
    }
  } catch {
    // Stdio failed before the intentional body finished — clean fail-open.
    // If the body already flushed, keep the exit code we set.
    if (!ioDone) process.exitCode = 0;
  } finally {
    // Claim the reply slot even on throw so failOpen/outer catch cannot wipe
    // a successful exit-2 that already flushed stderr.
    replied = true;
  }
}

function createEngine(coreMod, store) {
  return typeof coreMod.createConfiguredReviewEngine === "function"
    ? coreMod.createConfiguredReviewEngine(store, projectRoot)
    : new coreMod.ReviewEngine(store, {
        confirmRounds: 5,
        reviewScope: "executing_only",
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        maxErrorsBeforePause: 0,
        projectRoot,
      });
}

function cursorStopHandler(port) {
  if (typeof port.handleCursorStop === "function") {
    return port.handleCursorStop;
  }
  // Dual/legacy vendor: deprecated handleStop === Cursor only when Cursor
  // submit exists. Never fall through to Claude-only package handleStop
  // (also never Codex package handleStop).
  if (
    typeof port.handleStop === "function" &&
    typeof port.handleBeforeSubmitPrompt === "function"
  ) {
    return port.handleStop;
  }
  return undefined;
}

/**
 * Resolve Claude Stop handler without falling through to Cursor's handleStop
 * on the dual-port vendor (where deprecated `handleStop` === handleCursorStop).
 * Package-only Claude exports handleStop + handleStopFailure (Codex has no
 * StopFailure) — require StopFailure for the bare-handleStop fallback so a
 * Codex package load is not mistaken for Claude.
 */
function claudeStopHandler(port) {
  if (typeof port.handleClaudeStop === "function") {
    return port.handleClaudeStop;
  }
  if (
    typeof port.handleStop === "function" &&
    typeof port.handleBeforeSubmitPrompt !== "function" &&
    typeof port.handleStopFailure === "function"
  ) {
    return port.handleStop;
  }
  return undefined;
}

/**
 * Codex Stop: prefer aliased vendor export; package-only uses handleStop when
 * there is no Cursor submit and no Claude StopFailure.
 */
function codexStopHandler(port) {
  if (typeof port.handleCodexStop === "function") {
    return port.handleCodexStop;
  }
  if (
    typeof port.handleStop === "function" &&
    typeof port.handleBeforeSubmitPrompt !== "function" &&
    typeof port.handleStopFailure !== "function" &&
    typeof port.handleClaudeStop !== "function" &&
    typeof port.handleKimiStop !== "function" &&
    typeof port.handleCopilotStop !== "function" &&
    typeof port.handleGrokStop !== "function" &&
    typeof port.handleGeminiStop !== "function" &&
    typeof port.handleFactoryStop !== "function" &&
    port.KIMI_PLATFORM !== "kimi-code" &&
    port.COPILOT_PLATFORM !== "copilot-cli" &&
    port.GROK_PLATFORM !== "grok-build" &&
    port.GEMINI_PLATFORM !== "gemini-cli" &&
    port.FACTORY_PLATFORM !== "factory-droid" &&
    typeof port.handleHermesPreVerify !== "function" &&
    port.HERMES_PLATFORM !== "hermes-agent" &&
    typeof port.handleAntigravityStop !== "function" &&
    port.ANTIGRAVITY_PLATFORM !== "antigravity"
  ) {
    return port.handleStop;
  }
  return undefined;
}

/**
 * Kimi Stop: prefer aliased vendor export; package-only uses handleStop when
 * KIMI_PLATFORM is stamped (never confuse with Claude StopFailure or Codex).
 */
function kimiStopHandler(port) {
  if (typeof port.handleKimiStop === "function") {
    return port.handleKimiStop;
  }
  if (
    port.KIMI_PLATFORM === "kimi-code" &&
    typeof port.handleStop === "function" &&
    typeof port.handleBeforeSubmitPrompt !== "function" &&
    typeof port.handleStopFailure !== "function" &&
    typeof port.handleClaudeStop !== "function" &&
    typeof port.handleCodexStop !== "function" &&
    typeof port.handleCopilotStop !== "function" &&
    typeof port.handleGrokStop !== "function" &&
    typeof port.handleGeminiStop !== "function" &&
    typeof port.handleFactoryStop !== "function" &&
    port.GROK_PLATFORM !== "grok-build" &&
    port.GEMINI_PLATFORM !== "gemini-cli" &&
    port.FACTORY_PLATFORM !== "factory-droid" &&
    typeof port.handleHermesPreVerify !== "function" &&
    port.HERMES_PLATFORM !== "hermes-agent" &&
    typeof port.handleAntigravityStop !== "function" &&
    port.ANTIGRAVITY_PLATFORM !== "antigravity"
  ) {
    return port.handleStop;
  }
  return undefined;
}

/**
 * Copilot agentStop: prefer aliased vendor export; package-only uses handleStop
 * when COPILOT_PLATFORM is stamped (never Claude StopFailure / Codex / Kimi / Grok / Gemini).
 */
function copilotStopHandler(port) {
  if (typeof port.handleCopilotStop === "function") {
    return port.handleCopilotStop;
  }
  if (
    port.COPILOT_PLATFORM === "copilot-cli" &&
    typeof port.handleStop === "function" &&
    typeof port.handleBeforeSubmitPrompt !== "function" &&
    typeof port.handleStopFailure !== "function" &&
    typeof port.handleClaudeStop !== "function" &&
    typeof port.handleCodexStop !== "function" &&
    typeof port.handleKimiStop !== "function" &&
    typeof port.handleGrokStop !== "function" &&
    typeof port.handleGeminiStop !== "function" &&
    typeof port.handleFactoryStop !== "function" &&
    port.GROK_PLATFORM !== "grok-build" &&
    port.GEMINI_PLATFORM !== "gemini-cli" &&
    port.FACTORY_PLATFORM !== "factory-droid" &&
    typeof port.handleHermesPreVerify !== "function" &&
    port.HERMES_PLATFORM !== "hermes-agent" &&
    typeof port.handleAntigravityStop !== "function" &&
    port.ANTIGRAVITY_PLATFORM !== "antigravity"
  ) {
    return port.handleStop;
  }
  return undefined;
}

/**
 * Grok Build Stop: prefer aliased vendor export; package-only uses handleStop when
 * GROK_PLATFORM is stamped (never Claude StopFailure / Codex / Kimi / Copilot / Gemini).
 */
function grokStopHandler(port) {
  if (typeof port.handleGrokStop === "function") {
    return port.handleGrokStop;
  }
  if (
    port.GROK_PLATFORM === "grok-build" &&
    typeof port.handleStop === "function" &&
    typeof port.handleBeforeSubmitPrompt !== "function" &&
    typeof port.handleStopFailure !== "function" &&
    typeof port.handleClaudeStop !== "function" &&
    typeof port.handleCodexStop !== "function" &&
    typeof port.handleKimiStop !== "function" &&
    typeof port.handleCopilotStop !== "function" &&
    typeof port.handleGeminiStop !== "function" &&
    typeof port.handleFactoryStop !== "function" &&
    port.KIMI_PLATFORM !== "kimi-code" &&
    port.COPILOT_PLATFORM !== "copilot-cli" &&
    port.GEMINI_PLATFORM !== "gemini-cli" &&
    port.FACTORY_PLATFORM !== "factory-droid" &&
    typeof port.handleHermesPreVerify !== "function" &&
    port.HERMES_PLATFORM !== "hermes-agent" &&
    typeof port.handleAntigravityStop !== "function" &&
    port.ANTIGRAVITY_PLATFORM !== "antigravity"
  ) {
    return port.handleStop;
  }
  return undefined;
}

/**
 * Gemini AfterAgent: prefer aliased vendor export; package-only uses handleStop when
 * GEMINI_PLATFORM is stamped (never Claude StopFailure / Codex / Kimi / Copilot / Grok).
 */
function geminiStopHandler(port) {
  if (typeof port.handleGeminiStop === "function") {
    return port.handleGeminiStop;
  }
  if (
    port.GEMINI_PLATFORM === "gemini-cli" &&
    typeof port.handleStop === "function" &&
    typeof port.handleBeforeSubmitPrompt !== "function" &&
    typeof port.handleStopFailure !== "function" &&
    typeof port.handleClaudeStop !== "function" &&
    typeof port.handleCodexStop !== "function" &&
    typeof port.handleKimiStop !== "function" &&
    typeof port.handleCopilotStop !== "function" &&
    typeof port.handleGrokStop !== "function" &&
    typeof port.handleFactoryStop !== "function" &&
    port.KIMI_PLATFORM !== "kimi-code" &&
    port.COPILOT_PLATFORM !== "copilot-cli" &&
    port.GROK_PLATFORM !== "grok-build" &&
    port.FACTORY_PLATFORM !== "factory-droid" &&
    typeof port.handleHermesPreVerify !== "function" &&
    port.HERMES_PLATFORM !== "hermes-agent" &&
    typeof port.handleAntigravityStop !== "function" &&
    port.ANTIGRAVITY_PLATFORM !== "antigravity"
  ) {
    return port.handleStop;
  }
  return undefined;
}

/**
 * Factory Droid Stop: prefer aliased vendor export; package-only uses handleStop when
 * FACTORY_PLATFORM is stamped (never Claude StopFailure / other host stamps).
 */
function factoryStopHandler(port) {
  if (typeof port.handleFactoryStop === "function") {
    return port.handleFactoryStop;
  }
  if (
    port.FACTORY_PLATFORM === "factory-droid" &&
    typeof port.handleStop === "function" &&
    typeof port.handleBeforeSubmitPrompt !== "function" &&
    typeof port.handleStopFailure !== "function" &&
    typeof port.handleClaudeStop !== "function" &&
    typeof port.handleCodexStop !== "function" &&
    typeof port.handleKimiStop !== "function" &&
    typeof port.handleCopilotStop !== "function" &&
    typeof port.handleGrokStop !== "function" &&
    typeof port.handleGeminiStop !== "function" &&
    port.KIMI_PLATFORM !== "kimi-code" &&
    port.COPILOT_PLATFORM !== "copilot-cli" &&
    port.GROK_PLATFORM !== "grok-build" &&
    port.GEMINI_PLATFORM !== "gemini-cli" &&
    typeof port.handleHermesPreVerify !== "function" &&
    port.HERMES_PLATFORM !== "hermes-agent" &&
    typeof port.handleAntigravityStop !== "function" &&
    port.ANTIGRAVITY_PLATFORM !== "antigravity"
  ) {
    return port.handleStop;
  }
  return undefined;
}

/**
 * Antigravity Stop: prefer aliased vendor export; package-only uses handleStop when
 * ANTIGRAVITY_PLATFORM is stamped (never Claude StopFailure / other host stamps).
 */
function antigravityStopHandler(port) {
  if (typeof port.handleAntigravityStop === "function") {
    return port.handleAntigravityStop;
  }
  if (
    port.ANTIGRAVITY_PLATFORM === "antigravity" &&
    typeof port.handleStop === "function" &&
    typeof port.handleBeforeSubmitPrompt !== "function" &&
    typeof port.handleStopFailure !== "function" &&
    typeof port.handleClaudeStop !== "function" &&
    typeof port.handleCodexStop !== "function" &&
    typeof port.handleKimiStop !== "function" &&
    typeof port.handleCopilotStop !== "function" &&
    typeof port.handleGrokStop !== "function" &&
    typeof port.handleGeminiStop !== "function" &&
    typeof port.handleFactoryStop !== "function" &&
    typeof port.handleHermesPreVerify !== "function" &&
    port.KIMI_PLATFORM !== "kimi-code" &&
    port.COPILOT_PLATFORM !== "copilot-cli" &&
    port.GROK_PLATFORM !== "grok-build" &&
    port.GEMINI_PLATFORM !== "gemini-cli" &&
    port.FACTORY_PLATFORM !== "factory-droid" &&
    port.HERMES_PLATFORM !== "hermes-agent"
  ) {
    return port.handleStop;
  }
  return undefined;
}

function hostPortReady(hostId, port) {
  if (!port || typeof port !== "object") return false;
  if (hostId === "cursor") {
    return typeof port.handleBeforeSubmitPrompt === "function";
  }
  if (hostId === "kimi-code") {
    if (typeof port.handleKimiUserPromptSubmit === "function") return true;
    return (
      port.KIMI_PLATFORM === "kimi-code" &&
      typeof port.handleUserPromptSubmit === "function"
    );
  }
  if (hostId === "copilot-cli") {
    if (typeof port.handleCopilotUserPromptSubmit === "function") return true;
    return (
      port.COPILOT_PLATFORM === "copilot-cli" &&
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function"
    );
  }
  if (hostId === "grok-build") {
    if (typeof port.handleGrokUserPromptSubmit === "function") return true;
    return (
      port.GROK_PLATFORM === "grok-build" &&
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleCopilotStop !== "function" &&
      typeof port.handleGeminiStop !== "function" &&
      typeof port.handleFactoryStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GEMINI_PLATFORM !== "gemini-cli" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    );
  }
  if (hostId === "gemini-cli") {
    if (typeof port.handleGeminiUserPromptSubmit === "function") return true;
    return (
      port.GEMINI_PLATFORM === "gemini-cli" &&
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleCopilotStop !== "function" &&
      typeof port.handleGrokStop !== "function" &&
      typeof port.handleFactoryStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GROK_PLATFORM !== "grok-build" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    );
  }
  if (hostId === "factory-droid") {
    if (typeof port.handleFactoryUserPromptSubmit === "function") return true;
    return (
      port.FACTORY_PLATFORM === "factory-droid" &&
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleCopilotStop !== "function" &&
      typeof port.handleGrokStop !== "function" &&
      typeof port.handleGeminiStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GROK_PLATFORM !== "grok-build" &&
      port.GEMINI_PLATFORM !== "gemini-cli" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    );
  }
  if (hostId === "hermes-agent") {
    if (typeof port.handleHermesPreLlmCall === "function") return true;
    return (
      port.HERMES_PLATFORM === "hermes-agent" &&
      typeof port.handlePreLlmCall === "function"
    );
  }
  if (hostId === "antigravity") {
    if (typeof port.handleAntigravityPreInvocation === "function") return true;
    return (
      port.ANTIGRAVITY_PLATFORM === "antigravity" &&
      typeof port.handlePreInvocation === "function"
    );
  }
  if (hostId === "codex") {
    if (typeof port.handleCodexUserPromptSubmit === "function") return true;
    return (
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleClaudeStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GROK_PLATFORM !== "grok-build" &&
      port.GEMINI_PLATFORM !== "gemini-cli" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    );
  }
  // Claude: vendor alias or package-only (StopFailure fingerprint).
  // Do not treat a Codex-only package (bare submit, no StopFailure) as Claude.
  if (typeof port.handleUserPromptSubmit !== "function") return false;
  if (typeof port.handleClaudeStop === "function") return true;
  return typeof port.handleStopFailure === "function";
}

function resolveUserPromptSubmit(hostId, port) {
  if (hostId === "kimi-code") {
    if (typeof port.handleKimiUserPromptSubmit === "function") {
      return port.handleKimiUserPromptSubmit;
    }
    if (
      port.KIMI_PLATFORM === "kimi-code" &&
      typeof port.handleUserPromptSubmit === "function"
    ) {
      return port.handleUserPromptSubmit;
    }
    return undefined;
  }
  if (hostId === "copilot-cli") {
    if (typeof port.handleCopilotUserPromptSubmit === "function") {
      return port.handleCopilotUserPromptSubmit;
    }
    // Package-only Copilot — never Claude bare submit on multi-port vendor.
    if (
      port.COPILOT_PLATFORM === "copilot-cli" &&
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleGrokStop !== "function" &&
      typeof port.handleGeminiStop !== "function" &&
      typeof port.handleFactoryStop !== "function" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    ) {
      return port.handleUserPromptSubmit;
    }
    return undefined;
  }
  if (hostId === "grok-build") {
    if (typeof port.handleGrokUserPromptSubmit === "function") {
      return port.handleGrokUserPromptSubmit;
    }
    if (
      port.GROK_PLATFORM === "grok-build" &&
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleCopilotStop !== "function" &&
      typeof port.handleGeminiStop !== "function" &&
      typeof port.handleFactoryStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GEMINI_PLATFORM !== "gemini-cli" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    ) {
      return port.handleUserPromptSubmit;
    }
    return undefined;
  }
  if (hostId === "gemini-cli") {
    if (typeof port.handleGeminiUserPromptSubmit === "function") {
      return port.handleGeminiUserPromptSubmit;
    }
    if (
      port.GEMINI_PLATFORM === "gemini-cli" &&
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleCopilotStop !== "function" &&
      typeof port.handleGrokStop !== "function" &&
      typeof port.handleFactoryStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GROK_PLATFORM !== "grok-build" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    ) {
      return port.handleUserPromptSubmit;
    }
    return undefined;
  }
  if (hostId === "factory-droid") {
    if (typeof port.handleFactoryUserPromptSubmit === "function") {
      return port.handleFactoryUserPromptSubmit;
    }
    if (
      port.FACTORY_PLATFORM === "factory-droid" &&
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleCopilotStop !== "function" &&
      typeof port.handleGrokStop !== "function" &&
      typeof port.handleGeminiStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GROK_PLATFORM !== "grok-build" &&
      port.GEMINI_PLATFORM !== "gemini-cli" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    ) {
      return port.handleUserPromptSubmit;
    }
    return undefined;
  }
  if (hostId === "codex") {
    if (typeof port.handleCodexUserPromptSubmit === "function") {
      return port.handleCodexUserPromptSubmit;
    }
    // Package-only Codex (bare export); never fall back to Claude on vendor.
    if (
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleClaudeStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GROK_PLATFORM !== "grok-build" &&
      port.GEMINI_PLATFORM !== "gemini-cli" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    ) {
      return port.handleUserPromptSubmit;
    }
    return undefined;
  }
  if (hostId === "claude-code") {
    return port.handleUserPromptSubmit;
  }
  return undefined;
}

function resolvePostToolUse(hostId, port) {
  if (hostId === "kimi-code") {
    if (typeof port.handleKimiPostToolUse === "function") {
      return port.handleKimiPostToolUse;
    }
    if (
      port.KIMI_PLATFORM === "kimi-code" &&
      typeof port.handlePostToolUse === "function"
    ) {
      return port.handlePostToolUse;
    }
    return undefined;
  }
  if (hostId === "copilot-cli") {
    if (typeof port.handleCopilotPostToolUse === "function") {
      return port.handleCopilotPostToolUse;
    }
    if (
      port.COPILOT_PLATFORM === "copilot-cli" &&
      typeof port.handlePostToolUse === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleGrokStop !== "function" &&
      typeof port.handleGeminiStop !== "function" &&
      typeof port.handleFactoryStop !== "function" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    ) {
      return port.handlePostToolUse;
    }
    return undefined;
  }
  if (hostId === "grok-build") {
    if (typeof port.handleGrokPostToolUse === "function") {
      return port.handleGrokPostToolUse;
    }
    if (
      port.GROK_PLATFORM === "grok-build" &&
      typeof port.handlePostToolUse === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleCopilotStop !== "function" &&
      typeof port.handleGeminiStop !== "function" &&
      typeof port.handleFactoryStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GEMINI_PLATFORM !== "gemini-cli" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    ) {
      return port.handlePostToolUse;
    }
    return undefined;
  }
  if (hostId === "gemini-cli") {
    if (typeof port.handleGeminiPostToolUse === "function") {
      return port.handleGeminiPostToolUse;
    }
    if (
      port.GEMINI_PLATFORM === "gemini-cli" &&
      typeof port.handlePostToolUse === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleCopilotStop !== "function" &&
      typeof port.handleGrokStop !== "function" &&
      typeof port.handleFactoryStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GROK_PLATFORM !== "grok-build" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    ) {
      return port.handlePostToolUse;
    }
    return undefined;
  }
  if (hostId === "factory-droid") {
    if (typeof port.handleFactoryPostToolUse === "function") {
      return port.handleFactoryPostToolUse;
    }
    if (
      port.FACTORY_PLATFORM === "factory-droid" &&
      typeof port.handlePostToolUse === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleCopilotStop !== "function" &&
      typeof port.handleGrokStop !== "function" &&
      typeof port.handleGeminiStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GROK_PLATFORM !== "grok-build" &&
      port.GEMINI_PLATFORM !== "gemini-cli" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    ) {
      return port.handlePostToolUse;
    }
    return undefined;
  }
  if (hostId === "antigravity") {
    if (typeof port.handleAntigravityPostToolUse === "function") {
      return port.handleAntigravityPostToolUse;
    }
    if (
      port.ANTIGRAVITY_PLATFORM === "antigravity" &&
      typeof port.handlePostToolUse === "function" &&
      typeof port.handleClaudeStop !== "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleCodexStop !== "function" &&
      typeof port.handleKimiStop !== "function" &&
      typeof port.handleCopilotStop !== "function" &&
      typeof port.handleGrokStop !== "function" &&
      typeof port.handleGeminiStop !== "function" &&
      typeof port.handleFactoryStop !== "function" &&
      typeof port.handleHermesPreVerify !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GROK_PLATFORM !== "grok-build" &&
      port.GEMINI_PLATFORM !== "gemini-cli" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent"
    ) {
      return port.handlePostToolUse;
    }
    return undefined;
  }
  if (hostId === "codex") {
    if (typeof port.handleCodexPostToolUse === "function") {
      return port.handleCodexPostToolUse;
    }
    if (
      typeof port.handlePostToolUse === "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleClaudeStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli" &&
      port.GROK_PLATFORM !== "grok-build" &&
      port.GEMINI_PLATFORM !== "gemini-cli" &&
      port.FACTORY_PLATFORM !== "factory-droid" &&
      port.HERMES_PLATFORM !== "hermes-agent" &&
      typeof port.handleAntigravityStop !== "function" &&
      port.ANTIGRAVITY_PLATFORM !== "antigravity"
    ) {
      return port.handlePostToolUse;
    }
    return undefined;
  }
  if (hostId === "claude-code") {
    return port.handlePostToolUse;
  }
  return undefined;
}

/** Copilot-only userPromptTransformed (aliased on vendor; bare on package). */
function resolveUserPromptTransformed(port) {
  if (typeof port.handleCopilotUserPromptTransformed === "function") {
    return port.handleCopilotUserPromptTransformed;
  }
  if (
    port.COPILOT_PLATFORM === "copilot-cli" &&
    typeof port.handleUserPromptTransformed === "function" &&
    typeof port.handleClaudeStop !== "function" &&
    typeof port.handleStopFailure !== "function"
  ) {
    return port.handleUserPromptTransformed;
  }
  return undefined;
}

/**
 * Cursor IDE may also execute `.claude/settings.json` Stop hooks ("claude-project
 * config") on the same user Stop. Those payloads are Cursor-shaped (`status`,
 * lowercase `hook_event_name: "stop"`). Route them to the Cursor port so abort
 * halts instead of Claude recover (decision:block), which Cursor merges back
 * into followup and fights the real abort path.
 *
 * Heuristic (order matters):
 * 1) Explicit PascalCase Stop / StopFailure → not Cursor
 * 2) Lowercase `stop` → Cursor
 * 3) `stop_hook_active` present (Claude/Codex continuum) → not Cursor
 * 4) Cursor status vocab + `conversation_id` → Cursor; bare `session_id` → not Cursor
 */
function isCursorShapedStopPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const hookName = String(
    payload.hook_event_name ?? payload.hookEventName ?? "",
  ).trim();
  if (hookName === "Stop" || /^stopfailure$/i.test(hookName)) return false;
  if (hookName === "agentStop") return false;
  if (hookName === "AfterAgent") return false;
  if (hookName === "stop") return true;

  // Claude/Codex Stop threads stop_hook_active (bool); Cursor uses loop_count.
  if (
    typeof payload.stop_hook_active === "boolean" ||
    typeof payload.stopHookActive === "boolean"
  ) {
    return false;
  }

  const statusRaw = String(payload.status ?? "")
    .toLowerCase()
    .trim();
  const cursorStatus =
    statusRaw === "aborted" ||
    statusRaw === "cancelled" ||
    statusRaw === "canceled" ||
    statusRaw === "completed" ||
    statusRaw === "error" ||
    statusRaw === "failed";
  if (!cursorStatus) return false;

  const conversationId = String(
    payload.conversation_id ?? payload.conversationId ?? "",
  ).trim();
  if (conversationId) return true;

  const sessionId = String(
    payload.session_id ?? payload.sessionId ?? "",
  ).trim();
  // Claude/Codex-shaped id without conversation_id → keep non-Cursor path
  if (sessionId) return false;

  // Abort/cancel with no ids: prefer Cursor halt (no-op {}) over recover
  return (
    statusRaw === "aborted" ||
    statusRaw === "cancelled" ||
    statusRaw === "canceled"
  );
}

/**
 * Pick Stop / AfterAgent host after Cursor-shaped check.
 * --platform codex / kimi-code / copilot-cli / grok-build / gemini-cli /
 * factory-droid / hermes-agent / antigravity must win over PascalStop shape (shared
 * stop_hook_active with Claude). Preserve dual-host cross-fire: Cursor stamp +
 * Claude/Codex-shaped payload still routes to Claude (historical Layer C),
 * unless stamp is explicitly codex, kimi-code, copilot-cli, grok-build,
 * gemini-cli, factory-droid, hermes-agent, or antigravity.
 *
 * Unstamped `agentStop` (argv or hookEventName) must not fall through to Claude
 * just because the payload also carries stop_hook_active — but a non-Copilot
 * `--platform` stamp must still beat a hostile `hookEventName: agentStop`.
 * Unstamped `AfterAgent` (argv or hookEventName) routes to gemini-cli.
 */
function resolveStopHostId(declaredPlatform, payload, event) {
  if (isCursorShapedStopPayload(payload)) return "cursor";
  if (declaredPlatform === "codex") return "codex";
  if (declaredPlatform === "kimi-code") return "kimi-code";
  if (declaredPlatform === "copilot-cli") return "copilot-cli";
  if (declaredPlatform === "grok-build") return "grok-build";
  if (declaredPlatform === "gemini-cli") return "gemini-cli";
  if (declaredPlatform === "factory-droid") return "factory-droid";
  if (declaredPlatform === "hermes-agent") return "hermes-agent";
  if (declaredPlatform === "antigravity") return "antigravity";
  if (declaredPlatform === "claude-code") return "claude-code";
  const hookName = String(
    payload?.hook_event_name ?? payload?.hookEventName ?? "",
  ).trim();
  // Only when argv stamp is absent (or already Copilot): agentStop → Copilot.
  if (
    (declaredPlatform == null || declaredPlatform === "copilot-cli") &&
    (event === "agentStop" || hookName === "agentStop")
  ) {
    return "copilot-cli";
  }
  // Gemini AfterAgent (unique host event) — stamp absent or already gemini.
  if (
    (declaredPlatform == null || declaredPlatform === "gemini-cli") &&
    (event === "AfterAgent" || hookName === "AfterAgent")
  ) {
    return "gemini-cli";
  }
  // Shared Pascal Stop / stop_hook_active shape → Claude unless stamp was
  // codex / kimi-code / copilot-cli / grok-build / gemini-cli / factory-droid /
  // hermes-agent / antigravity / unstamped agentStop / AfterAgent above.
  if (isPascalStopShapedPayload(payload)) return "claude-code";
  if (declaredPlatform === "cursor") return "cursor";
  return "claude-code";
}

/**
 * BeforeAgent stdout: inject hookSpecificOutput, or deny+reason.
 * Never leak clearContext / primary block / Claude extras.
 * Optional systemMessage (checklist) may accompany inject or stand alone.
 */
function writeGeminiBeforeAgentReply(result) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const sysRaw =
      typeof result.systemMessage === "string"
        ? result.systemMessage.trim()
        : "";
    const hso = result.hookSpecificOutput;
    if (hso && typeof hso === "object" && !Array.isArray(hso)) {
      const ctx =
        typeof hso.additionalContext === "string"
          ? hso.additionalContext.trim()
          : "";
      if (ctx.length > 0) {
        const out = {
          hookSpecificOutput: {
            hookEventName: "BeforeAgent",
            additionalContext: ctx,
          },
        };
        if (sysRaw.length > 0) out.systemMessage = sysRaw;
        writeReply(JSON.stringify(out));
        return;
      }
    }
    const decision = result.decision;
    const reason =
      (decision === "deny" || decision === "block") &&
      typeof result.reason === "string"
        ? result.reason.trim()
        : "";
    if (reason.length > 0) {
      writeReply(JSON.stringify({ decision: "deny", reason }));
      return;
    }
    if (sysRaw.length > 0) {
      writeReply(JSON.stringify({ systemMessage: sysRaw }));
      return;
    }
  }
  writeReply("{}");
}

/** AfterAgent stdout: deny+reason continue, or continue:false hard-stop. */
function writeGeminiAfterAgentReply(result) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    if (result.continue === false) {
      const stopReason =
        typeof result.stopReason === "string" ? result.stopReason.trim() : "";
      writeReply(
        JSON.stringify(
          stopReason.length > 0
            ? { continue: false, stopReason }
            : { continue: false },
        ),
      );
      return;
    }
    // Prefer deny; accept host alias "block" only when scrubbing inbound shape
    // (Autopilot port emits deny — never primary block).
    const decision = result.decision;
    const reason =
      (decision === "deny" || decision === "block") &&
      typeof result.reason === "string"
        ? result.reason.trim()
        : "";
    if (reason.length > 0) {
      writeReply(JSON.stringify({ decision: "deny", reason }));
      return;
    }
  }
  writeReply("{}");
}

let bootEvent = "beforeSubmitPrompt";
let bootPlatform = null;

async function main() {
  const { event, platform: declaredPlatform } = parseArgs(
    process.argv.slice(2),
  );
  bootEvent = event;
  bootPlatform = declaredPlatform;
  try {
    const payload = await readStdin();
    const hostId = resolveHostId(declaredPlatform, event);

    // Hermes unique events: wrong --platform must abort before vendor FSM /
    // state.db open (checklist: 错 stamp abort 在副作用前).
    if (HERMES_EVENTS.has(event) && hostId !== "hermes-agent") {
      writeReply("{}");
      return;
    }
    // Hermes stamp with non-Hermes events: abort before side effects.
    if (hostId === "hermes-agent" && !HERMES_EVENTS.has(event)) {
      writeReply("{}");
      return;
    }

    // Antigravity unique PreInvocation: wrong --platform must abort before
    // vendor FSM / state.db open (checklist: 错 stamp abort 在副作用前).
    // Always emit JSON {} — do not use stamp-shaped failOpen (kimi-code writes
    // no stdout; Antigravity host requires a JSON object).
    if (event === "PreInvocation" && hostId !== "antigravity") {
      writeReply("{}");
      return;
    }
    // Antigravity stamp with non-Antigravity events: abort before side effects.
    // Shared PostToolUse / Stop are in ANTIGRAVITY_EVENTS and remain allowed.
    if (hostId === "antigravity" && !ANTIGRAVITY_EVENTS.has(event)) {
      writeReply("{}");
      return;
    }

    // Gemini unique events: wrong --platform must abort before vendor FSM /
    // state.db open (checklist: 错 stamp abort 在副作用前).
    // Always emit Gemini JSON silence — do not use stamp-shaped failOpen
    // (kimi-code writes no stdout; Gemini host requires a JSON object).
    if (GEMINI_EVENTS.has(event) && hostId !== "gemini-cli") {
      writeReply("{}");
      return;
    }

    // Cursor-only events under a non-Cursor stamp (missing/illegal --event
    // remaps to beforeSubmitPrompt): abort before FSM. Otherwise vendor would
    // run Cursor handlers and stringify `{}` / continue JSON — fatal for
    // Factory (and Kimi) allow paths that must stay zero-byte / non-JSON.
    if (CURSOR_EVENTS.has(event) && hostId !== "cursor") {
      failOpen(event, hostId);
      return;
    }

    // Copilot command/edit camelCase under a non-Copilot stamp: abort before
    // state.db. Do **not** early-abort `agentStop` — that event shares the
    // Stop|agentStop branch and resolveStopHostId (stamp may still be Cursor /
    // Claude / Factory / etc.).
    if (
      hostId !== "copilot-cli" &&
      (event === "userPromptSubmitted" ||
        event === "userPromptTransformed" ||
        event === "postToolUse")
    ) {
      failOpen(event, hostId);
      return;
    }

    const vendor = await loadVendorRuntime();
    const port = vendor ? vendor : await loadHostPortPackage(hostId);
    const coreMod = vendor ?? (await loadCoreFromNodeModules());

    if (!hostPortReady(hostId, port) || !coreMod?.StateStore) {
      failOpen(event, hostId);
      return;
    }

    const store = new coreMod.StateStore(projectRoot);
    try {
      if (event === "beforeSubmitPrompt") {
        const result = port.handleBeforeSubmitPrompt(
          store,
          payload,
          projectRoot,
        );
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      if (event === "afterFileEdit") {
        port.handleAfterFileEdit?.(store, payload, projectRoot);
        writeReply("{}");
        return;
      }
      if (event === "stop") {
        const stopFn = cursorStopHandler(port);
        if (typeof stopFn !== "function") {
          failOpen(event, hostId);
          return;
        }
        const result = stopFn(createEngine(coreMod, store), payload);
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      if (event === "pre_llm_call") {
        if (hostId !== "hermes-agent") {
          writeReply("{}");
          return;
        }
        const submitFn =
          typeof port.handleHermesPreLlmCall === "function"
            ? port.handleHermesPreLlmCall
            : typeof port.handlePreLlmCall === "function"
              ? port.handlePreLlmCall
              : undefined;
        if (typeof submitFn !== "function") {
          writeReply("{}");
          return;
        }
        const result = submitFn(store, payload, projectRoot);
        writeHermesReply(result, port);
        return;
      }
      if (event === "post_tool_call") {
        if (hostId !== "hermes-agent") {
          writeReply("{}");
          return;
        }
        const postFn =
          typeof port.handleHermesPostToolCall === "function"
            ? port.handleHermesPostToolCall
            : typeof port.handlePostToolCall === "function"
              ? port.handlePostToolCall
              : undefined;
        if (typeof postFn === "function") {
          postFn(store, payload, projectRoot);
        }
        writeReply("{}");
        return;
      }
      if (event === "pre_verify") {
        if (hostId !== "hermes-agent") {
          writeReply("{}");
          return;
        }
        const verifyFn =
          typeof port.handleHermesPreVerify === "function"
            ? port.handleHermesPreVerify
            : typeof port.handlePreVerify === "function"
              ? port.handlePreVerify
              : undefined;
        if (typeof verifyFn !== "function") {
          writeReply("{}");
          return;
        }
        const result = verifyFn(
          createEngine(coreMod, store),
          store,
          payload,
          projectRoot,
        );
        writeHermesReply(result, port);
        return;
      }
      if (event === "PreInvocation") {
        if (hostId !== "antigravity") {
          writeReply("{}");
          return;
        }
        const submitFn =
          typeof port.handleAntigravityPreInvocation === "function"
            ? port.handleAntigravityPreInvocation
            : typeof port.handlePreInvocation === "function"
              ? port.handlePreInvocation
              : undefined;
        if (typeof submitFn !== "function") {
          writeReply("{}");
          return;
        }
        const result = submitFn(store, payload, projectRoot);
        writeAntigravityReply(result, port, { allowInject: true });
        return;
      }
      if (event === "UserPromptSubmit") {
        const submitFn = resolveUserPromptSubmit(hostId, port);
        if (typeof submitFn !== "function") {
          failOpen(event, hostId);
          return;
        }
        const result = submitFn(store, payload, projectRoot);
        if (hostId === "kimi-code") {
          writeKimiReply(result);
          return;
        }
        // Copilot UPS stdout is dropped / must not leak gate mirrors (_stashedGate).
        if (hostId === "copilot-cli") {
          writeReply("{}");
          return;
        }
        // Gemini stamp on shared UserPromptSubmit name → same scrub as BeforeAgent.
        if (hostId === "gemini-cli") {
          writeGeminiBeforeAgentReply(result);
          return;
        }
        // Factory allow / Silence → zero-byte (never stringify {}).
        if (hostId === "factory-droid") {
          writeFactoryReply(result);
          return;
        }
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      if (event === "userPromptSubmitted") {
        if (hostId !== "copilot-cli") {
          failOpen(event, hostId);
          return;
        }
        const submitFn = resolveUserPromptSubmit(hostId, port);
        if (typeof submitFn !== "function") {
          failOpen(event, hostId);
          return;
        }
        // Copilot command UPS drops stdout — run FSM/triggers only; reply {}.
        submitFn(store, payload, projectRoot);
        writeReply("{}");
        return;
      }
      if (event === "userPromptTransformed") {
        if (hostId !== "copilot-cli") {
          failOpen(event, hostId);
          return;
        }
        const transformFn = resolveUserPromptTransformed(port);
        if (typeof transformFn !== "function") {
          failOpen(event, hostId);
          return;
        }
        const result = transformFn(store, payload, projectRoot);
        // Copilot Transform contract: only non-empty modifiedTransformedPrompt.
        const promptRaw =
          result &&
          typeof result === "object" &&
          typeof result.modifiedTransformedPrompt === "string"
            ? result.modifiedTransformedPrompt
            : "";
        const prompt = promptRaw.trim();
        writeReply(
          prompt.length > 0
            ? JSON.stringify({ modifiedTransformedPrompt: prompt })
            : "{}",
        );
        return;
      }
      if (event === "PostToolUse") {
        const editFn = resolvePostToolUse(hostId, port);
        if (typeof editFn === "function") {
          editFn(store, payload, projectRoot);
        }
        if (hostId === "kimi-code") {
          writeKimiReply({ exitCode: 0 });
          return;
        }
        if (hostId === "factory-droid") {
          writeReply("");
          return;
        }
        writeReply("{}");
        return;
      }
      if (event === "postToolUse") {
        if (hostId !== "copilot-cli") {
          failOpen(event, hostId);
          return;
        }
        const editFn = resolvePostToolUse(hostId, port);
        if (typeof editFn === "function") {
          editFn(store, payload, projectRoot);
        }
        writeReply("{}");
        return;
      }
      // Gemini CLI: unique host events (wrong stamp → fail-open before FSM).
      if (event === "BeforeAgent") {
        if (hostId !== "gemini-cli") {
          writeReply("{}");
          return;
        }
        const submitFn = resolveUserPromptSubmit(hostId, port);
        if (typeof submitFn !== "function") {
          failOpen(event, hostId);
          return;
        }
        const result = submitFn(store, payload, projectRoot);
        writeGeminiBeforeAgentReply(result);
        return;
      }
      if (event === "AfterTool") {
        if (hostId !== "gemini-cli") {
          writeReply("{}");
          return;
        }
        const editFn = resolvePostToolUse(hostId, port);
        if (typeof editFn === "function") {
          editFn(store, payload, projectRoot);
        }
        writeReply("{}");
        return;
      }
      if (event === "AfterAgent") {
        if (hostId !== "gemini-cli") {
          writeReply("{}");
          return;
        }
        const stopHost = resolveStopHostId(declaredPlatform, payload, event);
        // Universal abort: Cursor-shaped payload under Gemini stamp → Cursor
        // halt (same Layer C as Stop for other hosts). Must not fail-open
        // continue when the user aborted.
        if (stopHost === "cursor") {
          let stopFn = cursorStopHandler(port);
          if (typeof stopFn !== "function") {
            const cursorPort = await loadPortPackage(
              "@autopilot-harness/port-cursor",
            );
            if (cursorPort) stopFn = cursorStopHandler(cursorPort);
          }
          if (typeof stopFn !== "function") {
            failOpen(event, hostId);
            return;
          }
          // Run Cursor halt for FSM side effects; AfterAgent stdout must stay
          // Gemini-safe silence (never leak followup_message / Claude fields).
          stopFn(createEngine(coreMod, store), payload);
          writeReply("{}");
          return;
        }
        if (stopHost !== "gemini-cli") {
          failOpen(event, hostId);
          return;
        }
        let stopFn = geminiStopHandler(port);
        if (typeof stopFn !== "function") {
          const geminiPort = await loadPortPackage(
            "@autopilot-harness/port-gemini-cli",
          );
          if (geminiPort) stopFn = geminiStopHandler(geminiPort);
        }
        if (typeof stopFn !== "function") {
          failOpen(event, hostId);
          return;
        }
        const result = stopFn(createEngine(coreMod, store), payload);
        writeGeminiAfterAgentReply(result);
        return;
      }
      if (event === "Stop" || event === "agentStop") {
        // Layer C: payload shape vs declared --platform (cross-fire / lying argv).
        const stopHost = resolveStopHostId(declaredPlatform, payload, event);
        let stopFn;
        if (stopHost === "cursor") {
          stopFn = cursorStopHandler(port);
          if (typeof stopFn !== "function") {
            const cursorPort = await loadPortPackage(
              "@autopilot-harness/port-cursor",
            );
            if (cursorPort) stopFn = cursorStopHandler(cursorPort);
          }
        } else if (stopHost === "codex") {
          stopFn = codexStopHandler(port);
          if (typeof stopFn !== "function") {
            const codexPort = await loadPortPackage(
              "@autopilot-harness/port-codex",
            );
            if (codexPort) stopFn = codexStopHandler(codexPort);
          }
        } else if (stopHost === "kimi-code") {
          stopFn = kimiStopHandler(port);
          if (typeof stopFn !== "function") {
            const kimiPort = await loadPortPackage(
              "@autopilot-harness/port-kimi-code",
            );
            if (kimiPort) stopFn = kimiStopHandler(kimiPort);
          }
        } else if (stopHost === "copilot-cli") {
          stopFn = copilotStopHandler(port);
          if (typeof stopFn !== "function") {
            const copilotPort = await loadPortPackage(
              "@autopilot-harness/port-copilot-cli",
            );
            if (copilotPort) stopFn = copilotStopHandler(copilotPort);
          }
        } else if (stopHost === "grok-build") {
          stopFn = grokStopHandler(port);
          if (typeof stopFn !== "function") {
            const grokPort = await loadPortPackage(
              "@autopilot-harness/port-grok-build",
            );
            if (grokPort) stopFn = grokStopHandler(grokPort);
          }
        } else if (stopHost === "gemini-cli") {
          stopFn = geminiStopHandler(port);
          if (typeof stopFn !== "function") {
            const geminiPort = await loadPortPackage(
              "@autopilot-harness/port-gemini-cli",
            );
            if (geminiPort) stopFn = geminiStopHandler(geminiPort);
          }
        } else if (stopHost === "factory-droid") {
          stopFn = factoryStopHandler(port);
          if (typeof stopFn !== "function") {
            const factoryPort = await loadPortPackage(
              "@autopilot-harness/port-factory-droid",
            );
            if (factoryPort) stopFn = factoryStopHandler(factoryPort);
          }
        } else if (stopHost === "antigravity") {
          stopFn = antigravityStopHandler(port);
          if (typeof stopFn !== "function") {
            const antigravityPort = await loadPortPackage(
              "@autopilot-harness/port-antigravity",
            );
            if (antigravityPort) stopFn = antigravityStopHandler(antigravityPort);
          }
        } else {
          stopFn = claudeStopHandler(port);
          if (typeof stopFn !== "function") {
            const claudePort = await loadPortPackage(
              "@autopilot-harness/port-claude-code",
            );
            if (claudePort) stopFn = claudeStopHandler(claudePort);
          }
        }
        if (typeof stopFn !== "function") {
          // I/O shape follows argv stamp (bootPlatform), not Layer-C stopHost.
          failOpen(event);
          return;
        }
        const result = stopFn(createEngine(coreMod, store), payload);
        // Kimi host always speaks exit/stdio — even when Layer C routes
        // Cursor-shaped abort to the Cursor port (must not emit JSON "{}").
        if (declaredPlatform === "kimi-code") {
          if (
            stopHost === "kimi-code" &&
            result &&
            typeof result === "object" &&
            (result.exitCode === 0 || result.exitCode === 2)
          ) {
            writeKimiReply(result, { allowStdout: false });
          } else {
            writeKimiReply({ exitCode: 0 }, { allowStdout: false });
          }
          return;
        }
        // Copilot agentStop: allow only decision:block + reason (no Claude fields).
        if (stopHost === "copilot-cli") {
          const reason =
            result &&
            typeof result === "object" &&
            result.decision === "block" &&
            typeof result.reason === "string"
              ? result.reason.trim()
              : "";
          if (reason.length > 0) {
            writeReply(JSON.stringify({ decision: "block", reason }));
          } else {
            writeReply("{}");
          }
          return;
        }
        // Grok Stop: hard-stop (continue:false) wins over block if both appear;
        // continue is single-channel block+reason only. Strip Claude extras.
        if (stopHost === "grok-build") {
          if (result && typeof result === "object" && !Array.isArray(result)) {
            if (result.continue === false) {
              const stopReason =
                typeof result.stopReason === "string"
                  ? result.stopReason.trim()
                  : "";
              writeReply(
                JSON.stringify(
                  stopReason.length > 0
                    ? { continue: false, stopReason }
                    : { continue: false },
                ),
              );
              return;
            }
            const reason =
              result.decision === "block" &&
              typeof result.reason === "string"
                ? result.reason.trim()
                : "";
            if (reason.length > 0) {
              writeReply(JSON.stringify({ decision: "block", reason }));
              return;
            }
          }
          writeReply("{}");
          return;
        }
        // Gemini AfterAgent-shaped Stop stamp: deny+reason (never prefer block).
        if (stopHost === "gemini-cli") {
          writeGeminiAfterAgentReply(result);
          return;
        }
        // Factory Stop: empty allow / Silence; JSON for block or continue:false.
        if (stopHost === "factory-droid" || declaredPlatform === "factory-droid") {
          writeFactoryReply(result);
          return;
        }
        // Antigravity Stop: decision:continue+reason only (never Claude/inject extras).
        // Layer-C Cursor halt under Antigravity stamp → JSON silence (FSM already ran).
        if (stopHost === "antigravity" || declaredPlatform === "antigravity") {
          if (stopHost === "cursor") {
            writeReply("{}");
            return;
          }
          writeAntigravityReply(result, port, { allowContinue: true });
          return;
        }
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      if (event === "StopFailure") {
        // Codex/Kimi/Copilot/Grok/Gemini/Factory/Hermes/Antigravity have no StopFailure — fail-open.
        if (
          hostId === "codex" ||
          hostId === "kimi-code" ||
          hostId === "copilot-cli" ||
          hostId === "grok-build" ||
          hostId === "gemini-cli" ||
          hostId === "factory-droid" ||
          hostId === "hermes-agent" ||
          hostId === "antigravity"
        ) {
          failOpen(event, hostId);
          return;
        }
        let failFn = port.handleStopFailure;
        if (typeof failFn !== "function") {
          const stopFn = claudeStopHandler(port);
          if (typeof stopFn === "function") {
            failFn = (engine, p) => stopFn(engine, p, { status: "error" });
          }
        }
        if (typeof failFn !== "function") {
          failOpen(event, hostId);
          return;
        }
        const result = failFn(createEngine(coreMod, store), payload);
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      writeReply("{}");
    } finally {
      try {
        store.close();
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    // Kimi uses stderr as the Stop-continue / gate channel (exit 2). Do not
    // dump diagnostics there on fail-open (exit 0) or the host may mis-read it.
    if (bootPlatform !== "kimi-code") {
      console.error("[autopilot-harness] hook error:", err?.message ?? err);
    }
    failOpen(event);
  }
}

main().catch((err) => {
  if (bootPlatform !== "kimi-code") {
    console.error("[autopilot-harness] hook error:", err?.message ?? err);
  }
  // Prefer the parsed event when main() assigned it; else Cursor-safe default.
  failOpen(bootEvent);
  // Never wipe a completed Kimi exit-2 continue/gate reply.
  if (bootPlatform === "kimi-code" && process.exitCode === 2 && replied) {
    return;
  }
  process.exitCode = 0;
});
