/**
 * Antigravity cwd-agnostic hook shim — installed at
 * `.agents/bin/autopilot-harness-hook.mjs`.
 *
 * Hosts may resolve the hooks.json command relative to project root or to
 * `.agents/`; this file locates the real Autopilot hook via its own path
 * (`import.meta.url` → `../../.autopilot/bin/…`), not `process.cwd()`.
 * Do not point hooks.json at bare `../.autopilot/bin/…`.
 *
 * Missing/unreadable real hook → fail-open JSON `{}` (Antigravity Silence).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const shimDir = path.dirname(fileURLToPath(import.meta.url));
const realHook = path.resolve(
  shimDir,
  "..",
  "..",
  ".autopilot",
  "bin",
  "autopilot-harness-hook.mjs",
);

function failOpenSilence() {
  try {
    process.stdout.write("{}");
  } catch {
    /* ignore */
  }
}

try {
  const st = fs.lstatSync(realHook);
  if (st.isSymbolicLink() || !st.isFile()) {
    failOpenSilence();
  } else {
    await import(pathToFileURL(realHook).href);
  }
} catch {
  failOpenSilence();
}
