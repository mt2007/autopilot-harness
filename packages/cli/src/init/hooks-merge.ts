import type { HookCommand, HooksFile } from "./types.js";
import { AUTOPILOT_EVENTS } from "./types.js";

/** Installed `--platform` ids (argv primary dispatch). */
export const HOOK_PLATFORM_CURSOR = "cursor";
export const HOOK_PLATFORM_CLAUDE_CODE = "claude-code";

/** Canonical Autopilot hook command line (platform + event). */
export function autopilotHookCommandLine(
  platform: string,
  event: string,
): string {
  // Defense in depth: only allow safe argv tokens (callers pass constants).
  // Reject (do not silently rewrite) if sanitization would change the token —
  // rewriting could invent a different platform id.
  if (typeof platform !== "string" || typeof event !== "string") {
    throw new Error("autopilotHookCommandLine: invalid platform or event");
  }
  const safePlatform = platform.replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 64);
  const safeEvent = event.replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 64);
  if (
    !safePlatform ||
    !safeEvent ||
    safePlatform !== platform ||
    safeEvent !== event
  ) {
    throw new Error("autopilotHookCommandLine: invalid platform or event");
  }
  return `node .autopilot/bin/autopilot-harness-hook.mjs --platform ${safePlatform} --event ${safeEvent}`;
}

/** True when an Autopilot command stamps the expected `--platform <id>`. */
export function commandHasPlatformStamp(
  cmd: string | undefined,
  platform: string,
): boolean {
  if (typeof cmd !== "string" || !platform) return false;
  const needle = `--platform ${platform}`;
  // Token boundary: avoid matching `--platform cursor-extra`
  const re = new RegExp(
    `(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
  );
  return re.test(cmd);
}

export function autopilotHookCommand(event: string): HookCommand {
  const base: HookCommand = {
    command: autopilotHookCommandLine(HOOK_PLATFORM_CURSOR, event),
  };
  // Cursor defaults loop_limit to 5 for stop hooks that omit the field.
  // Autopilot's fix + multi-angle confirm chain routinely exceeds 5
  // auto-followups in one streak; without null the stop hook is skipped
  // mid-chain (e.g. after confirm 3/5) and pending_followup stalls.
  if (event === "stop") {
    return { ...base, loop_limit: null };
  }
  return base;
}

/** True when project Autopilot stop entry disables Cursor's default loop cap. */
export function autopilotStopHasUnlimitedLoop(hooks: HooksFile): boolean {
  const stops = hooks.hooks?.stop;
  if (!Array.isArray(stops)) return false;
  return stops.some((h) => {
    if (!h || typeof h !== "object" || Array.isArray(h)) return false;
    return (
      isAutopilotCommand(h.command) &&
      Object.prototype.hasOwnProperty.call(h, "loop_limit") &&
      h.loop_limit === null
    );
  });
}

/** True when a hook command belongs to Autopilot (merge/strip/uninstall). */
export function isAutopilotCommand(cmd: string | undefined): boolean {
  return (
    typeof cmd === "string" && cmd.includes("autopilot-harness-hook.mjs")
  );
}

/** Collapse controls before reflecting untrusted hooks keys into CLI errors. */
function safeHooksKeyLabel(key: string): string {
  const cleaned = key.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/ +/g, " ").trim();
  return cleaned || "?";
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
    const label = safeHooksKeyLabel(key);
    if (value == null) continue;
    if (!Array.isArray(value)) {
      return `hooks.json hooks.${label} must be an array of { command } entries.`;
    }
    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return `hooks.json hooks.${label} contains a non-object entry.`;
      }
      if (
        (entry as HookCommand).command != null &&
        typeof (entry as HookCommand).command !== "string"
      ) {
        return `hooks.json hooks.${label} has a non-string command.`;
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

/**
 * Remove Autopilot hook entries from every event list; keep foreign hooks.
 * Does not delete the hooks.json file — caller decides write/unlink.
 */
export function stripAutopilotHooks(existing: HooksFile): HooksFile {
  const base: HooksFile = {
    version: existing.version ?? 1,
    hooks: { ...(existing.hooks ?? {}) },
  };
  const shapeError = validateHooksShape(base);
  if (shapeError) {
    throw new Error(shapeError);
  }

  for (const [event, value] of Object.entries(base.hooks)) {
    if (!Array.isArray(value)) continue;
    base.hooks[event] = value.filter((h) => !isAutopilotCommand(h?.command));
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

/**
 * True when every Autopilot command for required Cursor events stamps
 * `--platform cursor`. Empty / incomplete installs return false.
 */
export function cursorHooksHavePlatformStamp(hooks: HooksFile): boolean {
  const bag =
    hooks.hooks && typeof hooks.hooks === "object" && !Array.isArray(hooks.hooks)
      ? hooks.hooks
      : {};
  let seen = 0;
  for (const event of AUTOPILOT_EVENTS) {
    const list = Array.isArray(bag[event])
      ? (bag[event] as HookCommand[])
      : [];
    for (const h of list) {
      if (!isAutopilotCommand(h?.command)) continue;
      seen += 1;
      if (!commandHasPlatformStamp(h.command, HOOK_PLATFORM_CURSOR)) {
        return false;
      }
    }
  }
  return seen > 0;
}
