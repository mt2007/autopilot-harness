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
const KNOWN_PLATFORMS = new Set(["cursor", "claude-code"]);

function parseArgs(argv) {
  const allowed = new Set([...CURSOR_EVENTS, ...CLAUDE_EVENTS]);
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

/** Strong Claude Stop markers (override a lying `--platform cursor`). */
function isClaudeShapedStopPayload(payload) {
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

/**
 * Fail-open shapes must match the host:
 * - Cursor submit → { continue: true }
 * - Claude UserPromptSubmit → {} (allow; no decision:block)
 * - other events → {}
 */
function failOpen(event) {
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
  // submit exists. Never fall through to Claude-only package handleStop.
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
 * node_modules `@autopilot-harness/port-claude-code` exports Claude as handleStop
 * and has no Cursor submit handler.
 */
function claudeStopHandler(port) {
  if (typeof port.handleClaudeStop === "function") {
    return port.handleClaudeStop;
  }
  if (
    typeof port.handleStop === "function" &&
    typeof port.handleBeforeSubmitPrompt !== "function"
  ) {
    return port.handleStop;
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
 * 1) Explicit Claude hook names (`Stop` / `StopFailure`) → not Cursor
 * 2) Lowercase `stop` → Cursor
 * 3) `stop_hook_active` present (Claude continuum) → not Cursor
 * 4) Cursor status vocab + `conversation_id` → Cursor; bare `session_id` → Claude
 */
function isCursorShapedStopPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const hookName = String(
    payload.hook_event_name ?? payload.hookEventName ?? "",
  ).trim();
  if (hookName === "Stop" || /^stopfailure$/i.test(hookName)) return false;
  if (hookName === "stop") return true;

  // Claude Stop threads stop_hook_active (bool); Cursor uses loop_count.
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
  // Claude-shaped id without conversation_id → keep Claude path
  if (sessionId) return false;

  // Abort/cancel with no ids: prefer Cursor halt (no-op {}) over Claude recover
  return (
    statusRaw === "aborted" ||
    statusRaw === "cancelled" ||
    statusRaw === "canceled"
  );
}

let bootEvent = "beforeSubmitPrompt";

async function main() {
  const { event, platform: declaredPlatform } = parseArgs(
    process.argv.slice(2),
  );
  bootEvent = event;
  try {
    const payload = await readStdin();
    // Layer A: --platform; fall back to event-name heuristics for legacy installs.
    const preferClaudePort =
      declaredPlatform === "claude-code"
        ? true
        : declaredPlatform === "cursor"
          ? false
          : isClaudeEvent(event);
    const claude = preferClaudePort;

    const vendor = await loadVendorRuntime();
    const port = vendor
      ? vendor
      : claude
        ? await loadPortPackage("@autopilot-harness/port-claude-code")
        : await loadPortPackage("@autopilot-harness/port-cursor");
    const coreMod = vendor ?? (await loadCoreFromNodeModules());

    const portReady = claude
      ? typeof port?.handleUserPromptSubmit === "function"
      : typeof port?.handleBeforeSubmitPrompt === "function";
    if (!portReady || !coreMod?.StateStore) {
      failOpen(event);
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
          failOpen(event);
          return;
        }
        const result = stopFn(createEngine(coreMod, store), payload);
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      if (event === "UserPromptSubmit") {
        const result = port.handleUserPromptSubmit(
          store,
          payload,
          projectRoot,
        );
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      if (event === "PostToolUse") {
        port.handlePostToolUse?.(store, payload, projectRoot);
        writeReply("{}");
        return;
      }
      if (event === "Stop") {
        // Layer C: payload shape vs declared --platform (cross-fire / lying argv).
        let useCursorStop = false;
        if (isCursorShapedStopPayload(payload)) {
          useCursorStop = true;
        } else if (isClaudeShapedStopPayload(payload)) {
          useCursorStop = false;
        } else if (declaredPlatform === "cursor") {
          useCursorStop = true;
        } else {
          useCursorStop = false;
        }
        if (useCursorStop) {
          let stopFn = cursorStopHandler(port);
          // Non-vendor Claude-only load + Cursor-shaped cross-fire needs Cursor port.
          if (typeof stopFn !== "function") {
            const cursorPort = await loadPortPackage(
              "@autopilot-harness/port-cursor",
            );
            if (cursorPort) stopFn = cursorStopHandler(cursorPort);
          }
          if (typeof stopFn !== "function") {
            failOpen(event);
            return;
          }
          const result = stopFn(createEngine(coreMod, store), payload);
          writeReply(JSON.stringify(result ?? {}));
          return;
        }
        let stopFn = claudeStopHandler(port);
        // Non-vendor Cursor-only load + Claude-shaped Stop needs Claude port.
        if (typeof stopFn !== "function") {
          const claudePort = await loadPortPackage(
            "@autopilot-harness/port-claude-code",
          );
          if (claudePort) stopFn = claudeStopHandler(claudePort);
        }
        if (typeof stopFn !== "function") {
          failOpen(event);
          return;
        }
        const result = stopFn(createEngine(coreMod, store), payload);
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      if (event === "StopFailure") {
        let failFn = port.handleStopFailure;
        if (typeof failFn !== "function") {
          const stopFn = claudeStopHandler(port);
          if (typeof stopFn === "function") {
            failFn = (engine, p) => stopFn(engine, p, { status: "error" });
          }
        }
        if (typeof failFn !== "function") {
          failOpen(event);
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
    console.error("[autopilot-harness] hook error:", err?.message ?? err);
    failOpen(event);
  }
}

main().catch((err) => {
  console.error("[autopilot-harness] hook error:", err?.message ?? err);
  // Prefer the parsed event when main() assigned it; else Cursor-safe default.
  failOpen(bootEvent);
  process.exitCode = 0;
});
