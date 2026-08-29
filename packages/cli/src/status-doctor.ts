import fs from "node:fs";
import path from "node:path";
import {
  summarizeAutopilotHooks,
  validateHooksShape,
} from "./init/hooks-merge.js";
import type { HooksFile } from "./init/types.js";

export function readPinVersion(projectRoot: string): string | null {
  const pinPath = path.join(projectRoot, ".autopilot", "pin.json");
  if (!fs.existsSync(pinPath)) return null;
  try {
    const pin = JSON.parse(fs.readFileSync(pinPath, "utf8")) as {
      "autopilot-harness"?: string;
    };
    return typeof pin["autopilot-harness"] === "string"
      ? pin["autopilot-harness"]
      : null;
  } catch {
    return null;
  }
}

export function formatStatus(projectRoot: string): string {
  const configPath = path.join(projectRoot, ".autopilot", "config.yml");
  if (!fs.existsSync(configPath)) {
    return "Autopilot status: not initialized (no .autopilot/config.yml)";
  }
  const pin = readPinVersion(projectRoot) ?? "unknown";
  const config = fs.readFileSync(configPath, "utf8");
  const platform = /platform:\s*(\S+)/.exec(config)?.[1] ?? "?";
  const locale = /locale:\s*(\S+)/.exec(config)?.[1] ?? "?";
  const phaseHint = fs.existsSync(path.join(projectRoot, ".autopilot", "state.db"))
    ? "state.db present"
    : "no state.db yet";
  return [
    "Autopilot status",
    `  project:  ${projectRoot}`,
    `  pin:      autopilot-harness@${pin}`,
    `  platform: ${platform}`,
    `  locale:   ${locale}`,
    `  state:    ${phaseHint}`,
  ].join("\n");
}

export function runDoctor(projectRoot: string): {
  ok: boolean;
  lines: string[];
} {
  const lines: string[] = [];
  let ok = true;
  const configPath = path.join(projectRoot, ".autopilot", "config.yml");
  if (!fs.existsSync(configPath)) {
    lines.push("FAIL  .autopilot/config.yml missing — run init");
    return { ok: false, lines };
  }
  lines.push("OK    config.yml");

  const pin = readPinVersion(projectRoot);
  if (!pin) {
    lines.push("FAIL  pin.json missing or invalid");
    ok = false;
  } else {
    lines.push(`OK    pin.json → ${pin}`);
  }

  const hook = path.join(
    projectRoot,
    ".autopilot",
    "bin",
    "autopilot-harness-hook.mjs",
  );
  if (!fs.existsSync(hook)) {
    lines.push("FAIL  hook binary missing");
    ok = false;
  } else {
    lines.push("OK    autopilot-harness-hook.mjs");
  }

  const hooksPath = path.join(projectRoot, ".cursor", "hooks.json");
  if (!fs.existsSync(hooksPath)) {
    lines.push("FAIL  .cursor/hooks.json missing");
    ok = false;
  } else {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lines.push("FAIL  hooks.json is not a JSON object");
        ok = false;
      } else {
        const hooks = parsed as HooksFile;
        const shapeError = validateHooksShape(
          hooks.hooks
            ? hooks
            : { version: 1, hooks: {} },
        );
        if (shapeError) {
          lines.push(`FAIL  ${shapeError}`);
          ok = false;
        } else {
          const { missingEvents, duplicates } = summarizeAutopilotHooks(hooks);
          if (missingEvents.length > 0) {
            lines.push(
              `FAIL  hooks.json missing Autopilot for: ${missingEvents.join(", ")} — run init --force`,
            );
            ok = false;
          }
          if (duplicates > 0) {
            // Plan: duplicate Autopilot commands → WARN (not hard fail)
            lines.push(
              `WARN  hooks.json has ${duplicates} duplicate Autopilot entr(y/ies)`,
            );
          }
          if (missingEvents.length === 0 && duplicates === 0) {
            lines.push("OK    hooks.json Autopilot entries");
          }
        }
      }
    } catch {
      lines.push("FAIL  hooks.json unreadable");
      ok = false;
    }
  }

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor < 22) {
    lines.push(`WARN  Node ${process.versions.node} — recommend >=22 (node:sqlite)`);
  } else {
    lines.push(`OK    Node ${process.versions.node}`);
  }

  return { ok, lines };
}
