/**
 * Autopilot Harness — Pi in-process extension (init-shipped under
 * `.pi/extensions/autopilot.ts`). Load via project trust + `/reload`.
 *
 * Vendor entry: `../../.autopilot/bin/vendor/runtime.mjs` (no consumer
 * `node_modules` core). Continue: `sendMessage` + PI_CONTINUE_DELIVER only when
 * settled returns `continueMessage` (R1). No blocking `ctx.ui` on continue (R9).
 *
 * Install: init writes this file directly (R6) — never the host package manager.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function canonicalizeRoot(raw) {
  const abs = path.resolve(raw);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

/** Install layout only: `<project>/.pi/extensions/<file>` → project root. */
function extensionInstallRoot() {
  try {
    const here = fileURLToPath(import.meta.url);
    const extDir = path.dirname(here);
    // Reject cache/temp copies whose `../..` happens to contain a vendor.
    if (path.basename(extDir) !== "extensions") return "";
    const piDir = path.dirname(extDir);
    if (path.basename(piDir) !== ".pi") return "";
    return canonicalizeRoot(path.dirname(piDir));
  } catch {
    return "";
  }
}

function resolveProjectRoot(pi) {
  const fromFile = extensionInstallRoot();
  // Layout matched. Missing vendor must not hop to another cwd that has one.
  if (fromFile) return fromFile;
  const cwd = typeof pi?.cwd === "string" && pi.cwd.trim() ? pi.cwd.trim() : "";
  return canonicalizeRoot(cwd || process.cwd());
}

function vendorRuntimePath(projectRoot) {
  return path.join(projectRoot, ".autopilot", "bin", "vendor", "runtime.mjs");
}

function isUnsafeVendor(filePath, projectRoot) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return true;
    const realRoot = fs.realpathSync(projectRoot);
    const real = fs.realpathSync(filePath);
    return real !== realRoot && !real.startsWith(realRoot + path.sep);
  } catch {
    return true;
  }
}

async function loadVendor(projectRoot) {
  const runtime = vendorRuntimePath(projectRoot);
  if (isUnsafeVendor(runtime, projectRoot)) return null;
  try {
    return await import(pathToFileURL(runtime).href);
  } catch {
    return null;
  }
}

/** Session id lives on the event context, not ExtensionAPI (Pi 0.85.1). */
function sessionIds(ctx) {
  let sessionFile = null;
  let sessionId = null;
  try {
    sessionFile = ctx?.sessionManager?.getSessionFile?.() ?? null;
  } catch {
    sessionFile = null;
  }
  try {
    sessionId = ctx?.sessionManager?.getSessionId?.() ?? null;
  } catch {
    sessionId = null;
  }
  return { sessionFile, sessionId };
}

function eventMode(ctx) {
  // ExtensionAPI has no mode; R10 uses ExtensionContext.mode only.
  return ctx?.mode;
}

/** Relative tool paths are cwd-relative. Stay inside the install root. */
export function pathResolveCwd(ctx, projectRoot) {
  const cwd =
    typeof ctx?.cwd === "string" && ctx.cwd.trim() ? ctx.cwd.trim() : "";
  if (!cwd || typeof projectRoot !== "string" || !projectRoot.trim()) {
    return projectRoot;
  }
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(cwd));
    if (!fs.statSync(resolved).isDirectory()) return projectRoot;
  } catch {
    return projectRoot;
  }
  if (
    resolved === projectRoot ||
    resolved.startsWith(projectRoot + path.sep)
  ) {
    return resolved;
  }
  return projectRoot;
}

export default function autopilotPiExtension(pi) {
  // Fixed at load. Do not retarget from later ctx.cwd (would desync the store
  // or attach state to a different tree that happens to contain a vendor).
  const projectRoot = resolveProjectRoot(pi);
  /** @type {Promise<{ vendor: any, store: any, engine: any } | null> | null} */
  let runtimePromise = null;

  function ensureRuntime() {
    if (!runtimePromise) {
      const root = projectRoot;
      runtimePromise = (async () => {
        const vendor = await loadVendor(root);
        if (!vendor?.StateStore || !vendor?.createConfiguredReviewEngine) {
          return null;
        }
        let store = null;
        try {
          store = new vendor.StateStore(root);
          const engine = vendor.createConfiguredReviewEngine(
            store,
            root,
          );
          return { vendor, store, engine };
        } catch {
          // Partial failure: engine wire failed after open — close to avoid
          // leaking SQLite handles across ensureRuntime retries.
          try {
            store?.close?.();
          } catch {
            /* ignore */
          }
          return null;
        }
      })().then((rt) => {
        // Failed load (missing vendor) must not stick forever across retries.
        if (!rt) runtimePromise = null;
        return rt;
      });
    }
    return runtimePromise;
  }

  pi.on("input", async (event, ctx) => {
    try {
      const rt = await ensureRuntime();
      if (!rt?.vendor?.handlePiInput) return;
      const ids = sessionIds(ctx);
      const result = rt.vendor.handlePiInput(
        rt.store,
        {
          text: event?.text,
          source: event?.source,
          mode: eventMode(ctx),
          cwd: projectRoot,
          ...ids,
        },
        projectRoot,
      );
      if (result?.harnessOwned || result?.unsupportedMode) {
        return { action: "continue" };
      }
    } catch {
      /* fail-open */
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const rt = await ensureRuntime();
      if (!rt?.vendor?.handlePiBeforeAgentStart) return;
      const ids = sessionIds(ctx);
      const result = rt.vendor.handlePiBeforeAgentStart(
        rt.store,
        {
          prompt: event?.prompt,
          mode: eventMode(ctx),
          cwd: projectRoot,
          ...ids,
        },
        projectRoot,
      );
      const msg =
        typeof result?.message === "string" ? result.message.trim() : "";
      if (msg) {
        // Pi BeforeAgentStartEventResult.message is CustomMessage-shaped.
        return { message: { content: msg } };
      }
    } catch {
      /* fail-open */
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    try {
      const rt = await ensureRuntime();
      if (!rt?.vendor?.handlePiToolResult) return;
      const ids = sessionIds(ctx);
      rt.vendor.handlePiToolResult(
        rt.store,
        {
          toolName: event?.toolName,
          input: event?.input,
          mode: eventMode(ctx),
          cwd: pathResolveCwd(ctx, projectRoot),
          ...ids,
        },
        projectRoot,
      );
    } catch {
      /* fail-open */
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    try {
      const rt = await ensureRuntime();
      if (!rt?.vendor?.handlePiAgentSettled) return;
      const ids = sessionIds(ctx);
      const result = rt.vendor.handlePiAgentSettled(
        rt.engine,
        rt.store,
        {
          mode: eventMode(ctx),
          cwd: projectRoot,
          ...ids,
        },
        projectRoot,
      );
      const continueMessage =
        typeof result?.continueMessage === "string"
          ? result.continueMessage.trim()
          : "";
      if (!continueMessage) return;

      const deliver = rt.vendor.PI_CONTINUE_DELIVER ?? {
        deliverAs: "followUp",
        triggerTurn: true,
      };
      const customType =
        typeof rt.vendor.PI_CONTINUE_CUSTOM_TYPE === "string"
          ? rt.vendor.PI_CONTINUE_CUSTOM_TYPE
          : "autopilot-harness";

      // R9: no blocking ctx.ui on this path.
      try {
        await pi.sendMessage({ customType, content: continueMessage }, deliver);
      } catch {
        if (typeof pi.sendUserMessage === "function") {
          try {
            // sendUserMessage always triggers a turn; followUp matches primary.
            await pi.sendUserMessage(continueMessage, {
              deliverAs: "followUp",
            });
          } catch {
            /* fail-open */
          }
        }
      }
    } catch {
      /* fail-open */
    }
  });
}
