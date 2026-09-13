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
 *
 * Dispatch is explicit five-way via --platform
 * (cursor | claude-code | codex | kimi-code | copilot-cli). Shared PascalCase
 * event names must NOT imply Claude when platform is codex, kimi-code, or
 * copilot-cli. Copilot camelCase events are routed by stamp + event only.
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
/** Codex/Kimi share submit/edit/stop names with Claude; routed by --platform only. */
const CODEX_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "Stop"]);
const KIMI_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "Stop"]);
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
]);

function parseArgs(argv) {
  const allowed = new Set([
    ...CURSOR_EVENTS,
    ...CLAUDE_EVENTS,
    ...CODEX_EVENTS,
    ...KIMI_EVENTS,
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
 * or copilot-cli. Copilot camelCase events without a stamp still need a host.
 */
function resolveHostId(declaredPlatform, event) {
  if (
    declaredPlatform === "cursor" ||
    declaredPlatform === "claude-code" ||
    declaredPlatform === "codex" ||
    declaredPlatform === "kimi-code" ||
    declaredPlatform === "copilot-cli"
  ) {
    return declaredPlatform;
  }
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
  return loadPortPackage("@autopilot-harness/port-cursor");
}

/**
 * Fail-open shapes must match the host:
 * - Cursor submit → { continue: true }
 * - Claude/Codex UserPromptSubmit → {} (allow; no decision:block)
 * - Kimi Code → bare exit 0 (no stdout; avoid appending `{}` to context)
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
    port.KIMI_PLATFORM !== "kimi-code" &&
    port.COPILOT_PLATFORM !== "copilot-cli"
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
    typeof port.handleCopilotStop !== "function"
  ) {
    return port.handleStop;
  }
  return undefined;
}

/**
 * Copilot agentStop: prefer aliased vendor export; package-only uses handleStop
 * when COPILOT_PLATFORM is stamped (never Claude StopFailure / Codex / Kimi).
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
    typeof port.handleKimiStop !== "function"
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
  if (hostId === "codex") {
    if (typeof port.handleCodexUserPromptSubmit === "function") return true;
    return (
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleClaudeStop !== "function" &&
      port.KIMI_PLATFORM !== "kimi-code" &&
      port.COPILOT_PLATFORM !== "copilot-cli"
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
      typeof port.handleKimiStop !== "function"
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
      port.COPILOT_PLATFORM !== "copilot-cli"
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
      typeof port.handleKimiStop !== "function"
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
      port.COPILOT_PLATFORM !== "copilot-cli"
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
 * Pick Stop host after Cursor-shaped check.
 * --platform codex / kimi-code / copilot-cli must win over PascalStop shape
 * (shared stop_hook_active with Claude). Preserve dual-host cross-fire: Cursor
 * stamp + Claude/Codex-shaped payload still routes to Claude (historical
 * Layer C), unless stamp is explicitly codex, kimi-code, or copilot-cli.
 *
 * Unstamped `agentStop` (argv or hookEventName) must not fall through to Claude
 * just because the payload also carries stop_hook_active — but a non-Copilot
 * `--platform` stamp must still beat a hostile `hookEventName: agentStop`.
 */
function resolveStopHostId(declaredPlatform, payload, event) {
  if (isCursorShapedStopPayload(payload)) return "cursor";
  if (declaredPlatform === "codex") return "codex";
  if (declaredPlatform === "kimi-code") return "kimi-code";
  if (declaredPlatform === "copilot-cli") return "copilot-cli";
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
  // Shared Pascal Stop / stop_hook_active shape → Claude unless stamp was
  // codex / kimi-code / copilot-cli / unstamped agentStop above.
  if (isPascalStopShapedPayload(payload)) return "claude-code";
  if (declaredPlatform === "cursor") return "cursor";
  return "claude-code";
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
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      if (event === "StopFailure") {
        // Codex/Kimi/Copilot have no StopFailure — fail-open if somehow invoked.
        if (
          hostId === "codex" ||
          hostId === "kimi-code" ||
          hostId === "copilot-cli"
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
