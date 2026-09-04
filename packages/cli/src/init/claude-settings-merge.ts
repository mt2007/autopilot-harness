/**
 * Merge Autopilot hooks + BLOCK_CAP into Claude Code `.claude/settings.json`.
 * Preserves foreign hooks/env; replaces Autopilot-marked command entries only.
 */
import { isAutopilotCommand } from "./hooks-merge.js";

export const CLAUDE_BLOCK_CAP_ENV = "CLAUDE_CODE_STOP_HOOK_BLOCK_CAP";

/** Events Autopilot registers under Claude Code hooks. */
export const CLAUDE_AUTOPILOT_EVENTS = [
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
  "StopFailure",
] as const;

export type ClaudeAutopilotEvent = (typeof CLAUDE_AUTOPILOT_EVENTS)[number];

export interface ClaudeHookHandler {
  type?: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface ClaudeMatcherGroup {
  matcher?: string;
  hooks?: ClaudeHookHandler[];
  [key: string]: unknown;
}

export interface ClaudeSettingsFile {
  env?: Record<string, unknown>;
  hooks?: Record<string, ClaudeMatcherGroup[] | unknown>;
  [key: string]: unknown;
}

function safeKeyLabel(key: string): string {
  const cleaned = key
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/ +/g, " ")
    .trim();
  return cleaned || "?";
}

/** Keys that must never be copied from JSON into merged objects (see config-merge). */
function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

/** Build the Autopilot command handler for a Claude hook event. */
export function autopilotClaudeHookHandler(
  event: ClaudeAutopilotEvent,
): ClaudeHookHandler {
  return {
    type: "command",
    command: `node .autopilot/bin/autopilot-harness-hook.mjs --event ${event}`,
  };
}

/** Matcher group Autopilot installs for one Claude event. */
export function autopilotClaudeMatcherGroup(
  event: ClaudeAutopilotEvent,
): ClaudeMatcherGroup {
  const handler = autopilotClaudeHookHandler(event);
  if (event === "PostToolUse") {
    return {
      matcher: "Edit|Write|NotebookEdit",
      hooks: [handler],
    };
  }
  return { hooks: [handler] };
}

/**
 * Ensure settings.json shape is merge-safe; otherwise refuse (do not wipe).
 */
export function validateClaudeSettingsShape(
  settings: ClaudeSettingsFile,
): string | null {
  for (const key of Object.keys(settings)) {
    if (isUnsafeKey(key)) {
      return `settings.json key "${safeKeyLabel(key)}" is not allowed.`;
    }
  }
  if (settings.env != null) {
    if (
      typeof settings.env !== "object" ||
      Array.isArray(settings.env) ||
      settings.env === null
    ) {
      return 'settings.json "env" must be an object.';
    }
    for (const key of Object.keys(settings.env)) {
      if (isUnsafeKey(key)) {
        return `settings.json env key "${safeKeyLabel(key)}" is not allowed.`;
      }
    }
  }
  if (settings.hooks == null) return null;
  if (
    typeof settings.hooks !== "object" ||
    Array.isArray(settings.hooks) ||
    settings.hooks === null
  ) {
    return 'settings.json "hooks" must be an object.';
  }
  for (const [key, value] of Object.entries(settings.hooks)) {
    const label = safeKeyLabel(key);
    if (isUnsafeKey(key)) {
      return `settings.json hooks key "${label}" is not allowed.`;
    }
    if (value == null) continue;
    if (!Array.isArray(value)) {
      return `settings.json hooks.${label} must be an array of matcher groups.`;
    }
    for (const group of value) {
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        return `settings.json hooks.${label} contains a non-object matcher group.`;
      }
      const g = group as ClaudeMatcherGroup;
      if (g.matcher != null && typeof g.matcher !== "string") {
        return `settings.json hooks.${label} has a non-string matcher.`;
      }
      if (g.hooks == null) continue;
      if (!Array.isArray(g.hooks)) {
        return `settings.json hooks.${label} matcher group hooks must be an array.`;
      }
      for (const h of g.hooks) {
        if (!h || typeof h !== "object" || Array.isArray(h)) {
          return `settings.json hooks.${label} contains a non-object hook handler.`;
        }
        if (h.command != null && typeof h.command !== "string") {
          return `settings.json hooks.${label} has a non-string command.`;
        }
        if (h.type != null && typeof h.type !== "string") {
          return `settings.json hooks.${label} has a non-string type.`;
        }
        if (
          h.timeout != null &&
          (typeof h.timeout !== "number" || !Number.isFinite(h.timeout))
        ) {
          return `settings.json hooks.${label} has a non-finite timeout.`;
        }
      }
    }
  }
  return null;
}

function stripAutopilotFromGroups(
  groups: ClaudeMatcherGroup[],
): ClaudeMatcherGroup[] {
  const out: ClaudeMatcherGroup[] = [];
  for (const group of groups) {
    if (!Array.isArray(group.hooks)) {
      // No hooks list — preserve foreign matcher metadata as-is.
      out.push({ ...group });
      continue;
    }
    const kept = group.hooks.filter((h) => !isAutopilotCommand(h?.command));
    if (kept.length === 0) {
      // Drop Autopilot-only groups; keep intentionally empty foreign groups.
      if (group.hooks.length === 0) {
        out.push({ ...group, hooks: [] });
      }
      continue;
    }
    out.push({ ...group, hooks: kept });
  }
  return out;
}

/**
 * Merge Autopilot Claude hooks + BLOCK_CAP=0 into existing or empty settings.
 */
export function mergeClaudeSettings(
  existing: ClaudeSettingsFile | null,
): ClaudeSettingsFile {
  const base: ClaudeSettingsFile = {};
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const shapeError = validateClaudeSettingsShape(existing);
    if (shapeError) {
      throw new Error(shapeError);
    }
    for (const [key, value] of Object.entries(existing)) {
      if (isUnsafeKey(key)) continue;
      base[key] = value;
    }
  } else {
    const shapeError = validateClaudeSettingsShape(base);
    if (shapeError) {
      throw new Error(shapeError);
    }
  }

  const prevEnv: Record<string, unknown> = Object.create(null);
  if (base.env && typeof base.env === "object" && !Array.isArray(base.env)) {
    for (const [key, value] of Object.entries(base.env)) {
      if (isUnsafeKey(key)) continue;
      prevEnv[key] = value;
    }
  }
  base.env = {
    ...prevEnv,
    [CLAUDE_BLOCK_CAP_ENV]: "0",
  };

  const nextHooks: Record<string, ClaudeMatcherGroup[]> = Object.create(null);
  if (base.hooks && typeof base.hooks === "object" && !Array.isArray(base.hooks)) {
    for (const [key, value] of Object.entries(base.hooks)) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(value)) {
        // validateClaudeSettingsShape should have rejected; keep fail-closed.
        continue;
      }
      nextHooks[key] = stripAutopilotFromGroups(value as ClaudeMatcherGroup[]);
    }
  }

  for (const event of CLAUDE_AUTOPILOT_EVENTS) {
    const current = Array.isArray(nextHooks[event])
      ? [...nextHooks[event]!]
      : [];
    const stripped = stripAutopilotFromGroups(current);
    stripped.push(autopilotClaudeMatcherGroup(event));
    nextHooks[event] = stripped;
  }

  base.hooks = nextHooks;
  return base;
}

/**
 * Remove Autopilot Claude hook handlers and BLOCK_CAP env; keep foreign hooks/env.
 * Does not delete settings.json — caller decides write/unlink.
 */
export function stripAutopilotClaudeSettings(
  existing: ClaudeSettingsFile,
): ClaudeSettingsFile {
  const shapeError = validateClaudeSettingsShape(existing);
  if (shapeError) {
    throw new Error(shapeError);
  }

  const base: ClaudeSettingsFile = {};
  for (const [key, value] of Object.entries(existing)) {
    if (isUnsafeKey(key)) continue;
    base[key] = value;
  }

  if (base.env && typeof base.env === "object" && !Array.isArray(base.env)) {
    const nextEnv: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(base.env)) {
      if (isUnsafeKey(key)) continue;
      if (key === CLAUDE_BLOCK_CAP_ENV) continue;
      nextEnv[key] = value;
    }
    if (Object.keys(nextEnv).length === 0) {
      delete base.env;
    } else {
      base.env = nextEnv;
    }
  }

  const prevHooks = base.hooks;
  if (prevHooks && typeof prevHooks === "object" && !Array.isArray(prevHooks)) {
    const nextHooks: Record<string, ClaudeMatcherGroup[]> = Object.create(null);
    for (const [key, value] of Object.entries(prevHooks)) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(value)) continue;
      const kept = stripAutopilotFromGroups(value as ClaudeMatcherGroup[]);
      // Drop empty event lists so uninstall does not leave Stop: [].
      if (kept.length > 0) nextHooks[key] = kept;
    }
    if (Object.keys(nextHooks).length === 0) {
      delete base.hooks;
    } else {
      base.hooks = nextHooks;
    }
  }

  return base;
}

/**
 * True when Autopilot Claude markers remain (hook commands and/or BLOCK_CAP env).
 * BLOCK_CAP alone counts so uninstall can clear leftover env after partial strip.
 */
export function claudeSettingsContainAutopilot(
  settings: ClaudeSettingsFile | null,
): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return false;
  }
  const env = settings.env;
  if (
    env &&
    typeof env === "object" &&
    !Array.isArray(env) &&
    Object.prototype.hasOwnProperty.call(env, CLAUDE_BLOCK_CAP_ENV)
  ) {
    return true;
  }
  const bag =
    settings.hooks &&
    typeof settings.hooks === "object" &&
    !Array.isArray(settings.hooks)
      ? settings.hooks
      : {};
  for (const value of Object.values(bag)) {
    if (!Array.isArray(value)) continue;
    for (const g of value as ClaudeMatcherGroup[]) {
      const hooks = Array.isArray(g?.hooks) ? g.hooks : [];
      if (hooks.some((h) => isAutopilotCommand(h?.command))) return true;
    }
  }
  return false;
}

/** True when BLOCK_CAP is present and set to "0" (string or number). */
export function hasClaudeBlockCapZero(settings: ClaudeSettingsFile): boolean {
  const env = settings.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return false;
  if (!Object.prototype.hasOwnProperty.call(env, CLAUDE_BLOCK_CAP_ENV)) {
    return false;
  }
  const raw = (env as Record<string, unknown>)[CLAUDE_BLOCK_CAP_ENV];
  if (raw === 0) return true;
  if (typeof raw === "string" && raw.trim() === "0") return true;
  return false;
}

/** Counts of Autopilot command handlers per required Claude event. */
export function summarizeClaudeAutopilotHooks(settings: ClaudeSettingsFile): {
  missingEvents: string[];
  duplicates: number;
} {
  const bag =
    settings.hooks &&
    typeof settings.hooks === "object" &&
    !Array.isArray(settings.hooks)
      ? settings.hooks
      : {};
  const missingEvents: string[] = [];
  let duplicates = 0;
  for (const event of CLAUDE_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(bag[event])
      ? (bag[event] as ClaudeMatcherGroup[])
      : [];
    let n = 0;
    for (const g of groups) {
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      n += hooks.filter((h) => isAutopilotCommand(h?.command)).length;
    }
    if (n === 0) missingEvents.push(event);
    if (n > 1) duplicates += n - 1;
  }
  return { missingEvents, duplicates };
}

export function hasCompleteClaudeAutopilotHooks(
  settings: ClaudeSettingsFile,
): boolean {
  const { missingEvents, duplicates } = summarizeClaudeAutopilotHooks(settings);
  return missingEvents.length === 0 && duplicates === 0;
}
