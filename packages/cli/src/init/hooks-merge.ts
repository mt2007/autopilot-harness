import type { HookCommand, HooksFile } from "./types.js";
import { AUTOPILOT_EVENTS } from "./types.js";

export function autopilotHookCommand(event: string): HookCommand {
  return {
    command: `node .autopilot/bin/autopilot-harness-hook.mjs --event ${event}`,
  };
}

function isAutopilotCommand(cmd: string | undefined): boolean {
  return (
    typeof cmd === "string" && cmd.includes("autopilot-harness-hook.mjs")
  );
}

/** Ensure hooks.json shape is merge-safe; otherwise refuse (do not wipe). */
export function validateHooksShape(hooks: HooksFile): string | null {
  if (Array.isArray(hooks.hooks)) {
    return 'hooks.json "hooks" must be an object, not an array.';
  }
  if (!hooks.hooks || typeof hooks.hooks !== "object") {
    return 'hooks.json "hooks" must be an object.';
  }
  for (const [key, value] of Object.entries(hooks.hooks)) {
    if (value == null) continue;
    if (!Array.isArray(value)) {
      return `hooks.json hooks.${key} must be an array of { command } entries.`;
    }
    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return `hooks.json hooks.${key} contains a non-object entry.`;
      }
      if (
        (entry as HookCommand).command != null &&
        typeof (entry as HookCommand).command !== "string"
      ) {
        return `hooks.json hooks.${key} has a non-string command.`;
      }
    }
  }
  return null;
}

/** Merge Autopilot hook entries into an existing or empty hooks.json. */
export function mergeHooksJson(existing: HooksFile | null): HooksFile {
  const base: HooksFile =
    existing && typeof existing === "object"
      ? {
          version: existing.version ?? 1,
          hooks: { ...(existing.hooks ?? {}) },
        }
      : { version: 1, hooks: {} };

  const shapeError = validateHooksShape(base);
  if (shapeError) {
    throw new Error(shapeError);
  }

  for (const event of AUTOPILOT_EVENTS) {
    const current = Array.isArray(base.hooks[event])
      ? [...(base.hooks[event] as HookCommand[])]
      : [];
    const kept = current.filter((h) => !isAutopilotCommand(h?.command));
    kept.push(autopilotHookCommand(event));
    base.hooks[event] = kept;
  }

  return base;
}

/** Counts of Autopilot commands per required event. */
export function summarizeAutopilotHooks(hooks: HooksFile): {
  missingEvents: string[];
  duplicates: number;
} {
  const bag =
    hooks.hooks && typeof hooks.hooks === "object" && !Array.isArray(hooks.hooks)
      ? hooks.hooks
      : {};
  const missingEvents: string[] = [];
  let duplicates = 0;
  for (const event of AUTOPILOT_EVENTS) {
    const list = Array.isArray(bag[event])
      ? (bag[event] as HookCommand[])
      : [];
    const n = list.filter((h) => isAutopilotCommand(h?.command)).length;
    if (n === 0) missingEvents.push(event);
    if (n > 1) duplicates += n - 1;
  }
  return { missingEvents, duplicates };
}

/** True when each Autopilot event has exactly one Autopilot command. */
export function hasCompleteAutopilotHooks(hooks: HooksFile): boolean {
  const { missingEvents, duplicates } = summarizeAutopilotHooks(hooks);
  return missingEvents.length === 0 && duplicates === 0;
}

/** Count duplicate Autopilot commands per event (doctor WARN). */
export function countAutopilotDuplicates(hooks: HooksFile): number {
  return summarizeAutopilotHooks(hooks).duplicates;
}
