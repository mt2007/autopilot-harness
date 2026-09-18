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
import { pathToFileURL } from "node:url";

function resolveProjectRoot(pi) {
  const cwd = typeof pi?.cwd === "string" && pi.cwd.trim() ? pi.cwd.trim() : "";
  if (cwd) return path.resolve(cwd);
  return process.cwd();
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

function sessionIds(pi) {
  let sessionFile = null;
  let sessionId = null;
  try {
    sessionFile = pi.sessionManager?.getSessionFile?.() ?? null;
  } catch {
    sessionFile = null;
  }
  try {
    sessionId = pi.sessionManager?.getSessionId?.() ?? null;
  } catch {
    sessionId = null;
  }
  return { sessionFile, sessionId };
}

export default function autopilotPiExtension(pi) {
  const projectRoot = resolveProjectRoot(pi);
  /** @type {Promise<{ vendor: any, store: any, engine: any } | null> | null} */
  let runtimePromise = null;

  function ensureRuntime() {
    if (!runtimePromise) {
      runtimePromise = (async () => {
        const vendor = await loadVendor(projectRoot);
        if (!vendor?.StateStore || !vendor?.createConfiguredReviewEngine) {
          return null;
        }
        let store = null;
        try {
          store = new vendor.StateStore(projectRoot);
          const engine = vendor.createConfiguredReviewEngine(
            store,
            projectRoot,
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

  pi.on("input", async (event) => {
    try {
      const rt = await ensureRuntime();
      if (!rt?.vendor?.handlePiInput) return;
      const ids = sessionIds(pi);
      const result = rt.vendor.handlePiInput(
        rt.store,
        {
          text: event?.text,
          source: event?.source,
          mode: pi.mode,
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

  pi.on("before_agent_start", async (event) => {
    try {
      const rt = await ensureRuntime();
      if (!rt?.vendor?.handlePiBeforeAgentStart) return;
      const ids = sessionIds(pi);
      const result = rt.vendor.handlePiBeforeAgentStart(
        rt.store,
        {
          prompt: event?.prompt,
          mode: pi.mode,
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

  pi.on("tool_result", async (event) => {
    try {
      const rt = await ensureRuntime();
      if (!rt?.vendor?.handlePiToolResult) return;
      const ids = sessionIds(pi);
      rt.vendor.handlePiToolResult(
        rt.store,
        {
          toolName: event?.toolName,
          input: event?.input,
          mode: pi.mode,
          cwd: projectRoot,
          ...ids,
        },
        projectRoot,
      );
    } catch {
      /* fail-open */
    }
  });

  pi.on("agent_settled", async () => {
    try {
      const rt = await ensureRuntime();
      if (!rt?.vendor?.handlePiAgentSettled) return;
      const ids = sessionIds(pi);
      const result = rt.vendor.handlePiAgentSettled(
        rt.engine,
        rt.store,
        {
          mode: pi.mode,
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
