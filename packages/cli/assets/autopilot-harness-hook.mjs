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
 *
 * Dispatch is explicit ternary via --platform (cursor | claude-code | codex).
 * Shared PascalCase event names must NOT imply Claude when platform is codex.
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
/** Codex shares submit/edit/stop names with Claude; routed by --platform only. */
const CODEX_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "Stop"]);
const KNOWN_PLATFORMS = new Set(["cursor", "claude-code", "codex"]);

function parseArgs(argv) {
  const allowed = new Set([
    ...CURSOR_EVENTS,
    ...CLAUDE_EVENTS,
    ...CODEX_EVENTS,
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
 * Never map PascalCase events to Claude when --platform codex is set.
 */
function resolveHostId(declaredPlatform, event) {
  if (
    declaredPlatform === "cursor" ||
    declaredPlatform === "claude-code" ||
    declaredPlatform === "codex"
  ) {
    return declaredPlatform;
  }
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
  return loadPortPackage("@autopilot-harness/port-cursor");
}

/**
 * Fail-open shapes must match the host:
 * - Cursor submit → { continue: true }
 * - Claude/Codex UserPromptSubmit → {} (allow; no decision:block)
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
    typeof port.handleClaudeStop !== "function"
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
  if (hostId === "codex") {
    if (typeof port.handleCodexUserPromptSubmit === "function") return true;
    return (
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleClaudeStop !== "function"
    );
  }
  // Claude: vendor alias or package-only (StopFailure fingerprint).
  // Do not treat a Codex-only package (bare submit, no StopFailure) as Claude.
  if (typeof port.handleUserPromptSubmit !== "function") return false;
  if (typeof port.handleClaudeStop === "function") return true;
  return typeof port.handleStopFailure === "function";
}

function resolveUserPromptSubmit(hostId, port) {
  if (hostId === "codex") {
    if (typeof port.handleCodexUserPromptSubmit === "function") {
      return port.handleCodexUserPromptSubmit;
    }
    // Package-only Codex (bare export); never fall back to Claude on vendor.
    if (
      typeof port.handleUserPromptSubmit === "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleClaudeStop !== "function"
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
  if (hostId === "codex") {
    if (typeof port.handleCodexPostToolUse === "function") {
      return port.handleCodexPostToolUse;
    }
    if (
      typeof port.handlePostToolUse === "function" &&
      typeof port.handleStopFailure !== "function" &&
      typeof port.handleClaudeStop !== "function"
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
 * --platform codex must win over PascalStop shape (shared with Claude).
 * Preserve dual-host cross-fire: Cursor stamp + Claude/Codex-shaped payload
 * still routes to Claude (historical Layer C), unless stamp is explicitly codex.
 */
function resolveStopHostId(declaredPlatform, payload) {
  if (isCursorShapedStopPayload(payload)) return "cursor";
  if (declaredPlatform === "codex") return "codex";
  if (declaredPlatform === "claude-code") return "claude-code";
  // Shared Pascal Stop / stop_hook_active shape → Claude unless stamp was codex.
  if (isPascalStopShapedPayload(payload)) return "claude-code";
  if (declaredPlatform === "cursor") return "cursor";
  return "claude-code";
}

let bootEvent = "beforeSubmitPrompt";

async function main() {
  const { event, platform: declaredPlatform } = parseArgs(
    process.argv.slice(2),
  );
  bootEvent = event;
  try {
    const payload = await readStdin();
    const hostId = resolveHostId(declaredPlatform, event);

    const vendor = await loadVendorRuntime();
    const port = vendor ? vendor : await loadHostPortPackage(hostId);
    const coreMod = vendor ?? (await loadCoreFromNodeModules());

    if (!hostPortReady(hostId, port) || !coreMod?.StateStore) {
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
        const submitFn = resolveUserPromptSubmit(hostId, port);
        if (typeof submitFn !== "function") {
          failOpen(event);
          return;
        }
        const result = submitFn(store, payload, projectRoot);
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      if (event === "PostToolUse") {
        const editFn = resolvePostToolUse(hostId, port);
        if (typeof editFn === "function") {
          editFn(store, payload, projectRoot);
        }
        writeReply("{}");
        return;
      }
      if (event === "Stop") {
        // Layer C: payload shape vs declared --platform (cross-fire / lying argv).
        const stopHost = resolveStopHostId(declaredPlatform, payload);
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
          failOpen(event);
          return;
        }
        const result = stopFn(createEngine(coreMod, store), payload);
        writeReply(JSON.stringify(result ?? {}));
        return;
      }
      if (event === "StopFailure") {
        // Codex has no StopFailure — fail-open if somehow invoked on codex.
        if (hostId === "codex") {
          failOpen(event);
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
