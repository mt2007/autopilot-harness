/**
 * Cursor hook entry — marker: autopilot-harness
 * Installed at .autopilot/bin/autopilot-harness-hook.mjs (copy, not symlink).
 *
 * Prefers bundled vendor/runtime.mjs (shipped by init/upgrade) so empty
 * consumer projects work without @autopilot-harness/* in node_modules.
 * Falls back to project-local packages, then fail-open.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const allowed = new Set([
    "beforeSubmitPrompt",
    "afterFileEdit",
    "stop",
  ]);
  const out = { event: "beforeSubmitPrompt" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--event" && argv[i + 1]) {
      const ev = argv[++i];
      out.event = allowed.has(ev) ? ev : "beforeSubmitPrompt";
    }
  }
  return out;
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

async function loadPortFromNodeModules() {
  try {
    const require = createRequire(path.join(projectRoot, "package.json"));
    const resolved = require.resolve("@autopilot-harness/port-cursor");
    return tryImport(pathToFileURL(resolved).href);
  } catch {
    return null;
  }
}

async function loadCoreFromNodeModules() {
  try {
    const require = createRequire(path.join(projectRoot, "package.json"));
    const resolved = require.resolve("@autopilot-harness/core");
    return tryImport(pathToFileURL(resolved).href);
  } catch {
    return null;
  }
}

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

async function main() {
  const { event } = parseArgs(process.argv.slice(2));
  try {
    const payload = await readStdin();

    const vendor = await loadVendorRuntime();
    const port = vendor ?? (await loadPortFromNodeModules());
    const coreMod = vendor ?? (await loadCoreFromNodeModules());
    if (!port?.handleBeforeSubmitPrompt || !coreMod?.StateStore) {
      failOpen(event);
      return;
    }

    const store = new coreMod.StateStore(projectRoot);
    try {
      if (event === "beforeSubmitPrompt") {
        const result = port.handleBeforeSubmitPrompt(store, payload, projectRoot);
        writeReply(JSON.stringify(result));
        return;
      }
      if (event === "afterFileEdit") {
        port.handleAfterFileEdit?.(store, payload);
        writeReply("{}");
        return;
      }
      if (event === "stop") {
        // Vendor injects locale; core still applies config.yml. Fall back if
        // an older vendor/runtime lacks the factory (upgrade mid-flight).
        const engine =
          typeof coreMod.createConfiguredReviewEngine === "function"
            ? coreMod.createConfiguredReviewEngine(store, projectRoot)
            : new coreMod.ReviewEngine(store, {
                confirmRounds: 5,
                verifyEnabled: false,
                verifyCommands: [],
                maxIdleStops: 5,
                projectRoot,
              });
        const result = port.handleStop(engine, payload);
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
  failOpen("beforeSubmitPrompt");
  process.exitCode = 0;
});
