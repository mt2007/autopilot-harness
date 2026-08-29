/**
 * Cursor hook entry — marker: autopilot-harness
 * Installed at .autopilot/bin/autopilot-harness-hook.mjs (copy, not symlink).
 *
 * Resolves @autopilot-harness/port-cursor from the consumer project when present;
 * otherwise fail-open (continue / empty followup) so the IDE is not blocked.
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

async function loadPort() {
  const vendor = path.join(__dirname, "vendor", "port-cursor.mjs");
  if (fs.existsSync(vendor)) {
    return tryImport(pathToFileURL(vendor).href);
  }
  try {
    const require = createRequire(path.join(projectRoot, "package.json"));
    const resolved = require.resolve("@autopilot-harness/port-cursor");
    return tryImport(pathToFileURL(resolved).href);
  } catch {
    return null;
  }
}

async function loadCore() {
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
    process.stdout.write(JSON.stringify({ continue: true }));
  } else {
    process.stdout.write("{}");
  }
}

async function main() {
  const { event } = parseArgs(process.argv.slice(2));
  const payload = await readStdin();

  const port = await loadPort();
  const coreMod = await loadCore();
  if (!port?.handleBeforeSubmitPrompt || !coreMod?.StateStore) {
    failOpen(event);
    return;
  }

  const store = new coreMod.StateStore(projectRoot);
  try {
    if (event === "beforeSubmitPrompt") {
      const result = port.handleBeforeSubmitPrompt(store, payload, projectRoot);
      process.stdout.write(JSON.stringify(result));
      return;
    }
    if (event === "afterFileEdit") {
      port.handleAfterFileEdit?.(store, payload);
      process.stdout.write("{}");
      return;
    }
    if (event === "stop") {
      const engine = new coreMod.ReviewEngine(store, {
        confirmRounds: 5,
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        projectRoot,
      });
      const result = port.handleStop(engine, payload);
      process.stdout.write(JSON.stringify(result ?? {}));
      return;
    }
    process.stdout.write("{}");
  } finally {
    try {
      store.close();
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error("[autopilot-harness] hook error:", err?.message ?? err);
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exitCode = 0;
});
