/**
 * Merge Autopilot hooks into Gemini CLI `.gemini/settings.json`.
 * Claude-settings-merge style: nested matcher groups only; preserve foreign
 * top-level keys (general / hooksConfig / MCP / …); never rewrite hooksConfig.
 * Fingerprint: stable `name: autopilot-harness-…` and/or Autopilot command.
 */
import { GEMINI_AFTER_TOOL_MATCHER as PORT_GEMINI_AFTER_TOOL_MATCHER } from "@autopilot-harness/port-gemini-cli";
import {
  HOOK_PLATFORM_GEMINI_CLI,
  autopilotHookCommandLine,
  commandHasPlatformStamp,
  isAutopilotCommand,
} from "./hooks-merge.js";

/** Events Autopilot registers under Gemini CLI hooks (no StopFailure). */
export const GEMINI_AUTOPILOT_EVENTS = [
  "BeforeAgent",
  "AfterTool",
  "AfterAgent",
] as const;

export type GeminiAutopilotEvent = (typeof GEMINI_AUTOPILOT_EVENTS)[number];

/** AfterTool matcher (keep in sync with port-gemini-cli). */
export const GEMINI_AFTER_TOOL_MATCHER = PORT_GEMINI_AFTER_TOOL_MATCHER;

/** Gemini hook timeout is milliseconds (host docs). */
export const GEMINI_HOOK_TIMEOUT_MS = 120_000;

/** Wildcard matcher for BeforeAgent / AfterAgent. */
export const GEMINI_WILDCARD_MATCHER = "*";

/** Stable name prefix — strip/detect Autopilot handlers. */
export const GEMINI_HOOK_NAME_PREFIX = "autopilot-harness";

export const GEMINI_SETTINGS_REL_PATH = [".gemini", "settings.json"].join("/");

export interface GeminiHookHandler {
  name?: string;
  type?: string;
  command?: string;
  timeout?: number;
  description?: string;
  [key: string]: unknown;
}

export interface GeminiMatcherGroup {
  matcher?: string;
  hooks?: GeminiHookHandler[];
  [key: string]: unknown;
}

export interface GeminiSettingsFile {
  hooks?: Record<string, GeminiMatcherGroup[] | unknown>;
  hooksConfig?: unknown;
  general?: unknown;
  [key: string]: unknown;
}

function safeKeyLabel(key: string): string {
  const cleaned = key
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/ +/g, " ")
    .trim();
  return cleaned || "?";
}

function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

/** Stable Autopilot handler name for one Gemini event. */
export function autopilotGeminiHookName(event: GeminiAutopilotEvent): string {
  return `${GEMINI_HOOK_NAME_PREFIX}-${event}`;
}

/** True when a handler is Autopilot (name prefix and/or command fingerprint). */
export function isAutopilotGeminiHandler(
  h: GeminiHookHandler | null | undefined,
): boolean {
  if (!h || typeof h !== "object" || Array.isArray(h)) return false;
  if (isAutopilotCommand(h.command)) return true;
  if (
    typeof h.name === "string" &&
    h.name.startsWith(`${GEMINI_HOOK_NAME_PREFIX}-`)
  ) {
    return true;
  }
  return false;
}

/** Build the Autopilot command handler for a Gemini hook event. */
export function autopilotGeminiHookHandler(
  event: GeminiAutopilotEvent,
): GeminiHookHandler {
  return {
    name: autopilotGeminiHookName(event),
    type: "command",
    command: autopilotHookCommandLine(HOOK_PLATFORM_GEMINI_CLI, event),
    timeout: GEMINI_HOOK_TIMEOUT_MS,
    description: `Autopilot ${event}`,
  };
}

/** Matcher group Autopilot installs for one Gemini event. */
export function autopilotGeminiMatcherGroup(
  event: GeminiAutopilotEvent,
): GeminiMatcherGroup {
  const handler = autopilotGeminiHookHandler(event);
  if (event === "AfterTool") {
    return {
      matcher: GEMINI_AFTER_TOOL_MATCHER,
      hooks: [handler],
    };
  }
  return {
    matcher: GEMINI_WILDCARD_MATCHER,
    hooks: [handler],
  };
}

/**
 * Ensure settings.json shape is merge-safe; otherwise refuse (do not wipe).
 * Requires nested matcher groups when hooks are present (flat handlers rejected).
 */
export function validateGeminiSettingsShape(
  settings: GeminiSettingsFile,
): string | null {
  for (const key of Object.keys(settings)) {
    if (isUnsafeKey(key)) {
      return `settings.json key "${safeKeyLabel(key)}" is not allowed.`;
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
      const g = group as GeminiMatcherGroup & {
        type?: unknown;
        command?: unknown;
      };
      // Flat handler fields on the group — reject any non-null type/command
      // (incl. non-strings and empty `hooks: []`) so merge cannot preserve them.
      if (g.type != null || g.command != null) {
        return `settings.json hooks.${label} must use nested matcher groups (not flat handlers).`;
      }
      for (const gk of Object.keys(g)) {
        if (isUnsafeKey(gk)) {
          return `settings.json hooks.${label} matcher group key "${safeKeyLabel(gk)}" is not allowed.`;
        }
      }
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
        for (const hk of Object.keys(h)) {
          if (isUnsafeKey(hk)) {
            return `settings.json hooks.${label} hook key "${safeKeyLabel(hk)}" is not allowed.`;
          }
        }
        if (h.command != null && typeof h.command !== "string") {
          return `settings.json hooks.${label} has a non-string command.`;
        }
        if (h.type != null && typeof h.type !== "string") {
          return `settings.json hooks.${label} has a non-string type.`;
        }
        if (h.name != null && typeof h.name !== "string") {
          return `settings.json hooks.${label} has a non-string name.`;
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
  groups: GeminiMatcherGroup[],
): GeminiMatcherGroup[] {
  const out: GeminiMatcherGroup[] = [];
  for (const group of groups) {
    if (!Array.isArray(group.hooks)) {
      out.push({ ...group });
      continue;
    }
    const kept = group.hooks.filter((h) => !isAutopilotGeminiHandler(h));
    if (kept.length === 0) {
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
 * Merge Autopilot Gemini hooks into existing or empty settings.
 * Preserves hooksConfig / general / MCP and all other top-level keys as-is.
 */
export function mergeGeminiSettings(
  existing: GeminiSettingsFile | null,
): GeminiSettingsFile {
  const base: GeminiSettingsFile = {};
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const shapeError = validateGeminiSettingsShape(existing);
    if (shapeError) {
      throw new Error(shapeError);
    }
    for (const [key, value] of Object.entries(existing)) {
      if (isUnsafeKey(key)) continue;
      base[key] = value;
    }
  } else {
    const shapeError = validateGeminiSettingsShape(base);
    if (shapeError) {
      throw new Error(shapeError);
    }
  }

  const nextHooks: Record<string, GeminiMatcherGroup[]> = Object.create(null);
  if (base.hooks && typeof base.hooks === "object" && !Array.isArray(base.hooks)) {
    for (const [key, value] of Object.entries(base.hooks)) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(value)) continue;
      nextHooks[key] = stripAutopilotFromGroups(value as GeminiMatcherGroup[]);
    }
  }

  for (const event of GEMINI_AUTOPILOT_EVENTS) {
    const current = Array.isArray(nextHooks[event])
      ? [...nextHooks[event]!]
      : [];
    const stripped = stripAutopilotFromGroups(current);
    stripped.push(autopilotGeminiMatcherGroup(event));
    nextHooks[event] = stripped;
  }

  base.hooks = nextHooks;
  return base;
}

/**
 * Remove Autopilot Gemini hook handlers; keep foreign hooks and all siblings
 * (hooksConfig, general, MCP, …). Does not delete settings.json — caller writes
 * back (and keeps the file when foreign content remains).
 */
export function stripAutopilotGeminiSettings(
  existing: GeminiSettingsFile,
): GeminiSettingsFile {
  const shapeError = validateGeminiSettingsShape(existing);
  if (shapeError) {
    throw new Error(shapeError);
  }

  const base: GeminiSettingsFile = {};
  for (const [key, value] of Object.entries(existing)) {
    if (isUnsafeKey(key)) continue;
    base[key] = value;
  }

  const prevHooks = base.hooks;
  if (prevHooks && typeof prevHooks === "object" && !Array.isArray(prevHooks)) {
    const nextHooks: Record<string, GeminiMatcherGroup[]> = Object.create(null);
    for (const [key, value] of Object.entries(prevHooks)) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(value)) continue;
      const kept = stripAutopilotFromGroups(value as GeminiMatcherGroup[]);
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

/** True when Autopilot Gemini markers remain (name and/or command). */
export function geminiSettingsContainAutopilot(
  settings: GeminiSettingsFile | null,
): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return false;
  }
  const bag =
    settings.hooks &&
    typeof settings.hooks === "object" &&
    !Array.isArray(settings.hooks)
      ? settings.hooks
      : {};
  for (const value of Object.values(bag)) {
    if (!Array.isArray(value)) continue;
    for (const g of value as GeminiMatcherGroup[]) {
      const hooks = Array.isArray(g?.hooks) ? g.hooks : [];
      if (hooks.some((h) => isAutopilotGeminiHandler(h))) return true;
    }
  }
  return false;
}

/**
 * True when settings are empty after Autopilot strip (safe to unlink).
 * Empty/missing `hooks` (null or `{}`) counts as vacant — same idea as
 * {@link grokHooksFileIsVacant}. Any other top-level field keeps the file.
 */
export function geminiSettingsFileIsVacant(
  settings: GeminiSettingsFile | null,
): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return true;
  }
  for (const [key, value] of Object.entries(settings)) {
    if (isUnsafeKey(key)) continue;
    if (key === "hooks") {
      if (value == null) continue;
      if (typeof value === "object" && !Array.isArray(value)) {
        if (Object.keys(value as object).length === 0) continue;
        return false;
      }
      return false;
    }
    if (value !== undefined) return false;
  }
  return true;
}

/**
 * True when settings still hold non-Autopilot content after strip consideration
 * (foreign hooks, hooksConfig, general, MCP, other top-level keys).
 * Used by uninstall to keep the file when foreign keys remain.
 */
export function geminiSettingsHaveForeignContent(
  settings: GeminiSettingsFile | null,
): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return false;
  }
  return !geminiSettingsFileIsVacant(settings);
}

/** Counts of Autopilot handlers per required Gemini event. */
export function summarizeGeminiAutopilotHooks(settings: GeminiSettingsFile): {
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
  for (const event of GEMINI_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(bag[event])
      ? (bag[event] as GeminiMatcherGroup[])
      : [];
    let n = 0;
    for (const g of groups) {
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      n += hooks.filter((h) => isAutopilotGeminiHandler(h)).length;
    }
    if (n === 0) missingEvents.push(event);
    if (n > 1) duplicates += n - 1;
  }
  return { missingEvents, duplicates };
}

export function hasCompleteGeminiAutopilotHooks(
  settings: GeminiSettingsFile,
): boolean {
  const { missingEvents, duplicates } =
    summarizeGeminiAutopilotHooks(settings);
  return missingEvents.length === 0 && duplicates === 0;
}

/**
 * True when every Autopilot Gemini command stamps `--platform gemini-cli`.
 * Incomplete installs (no Autopilot handlers) return false.
 */
export function geminiHooksHavePlatformStamp(
  settings: GeminiSettingsFile,
): boolean {
  const bag =
    settings.hooks &&
    typeof settings.hooks === "object" &&
    !Array.isArray(settings.hooks)
      ? settings.hooks
      : {};
  let seen = 0;
  for (const event of GEMINI_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(bag[event])
      ? (bag[event] as GeminiMatcherGroup[])
      : [];
    for (const g of groups) {
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      for (const h of hooks) {
        if (!isAutopilotGeminiHandler(h)) continue;
        seen += 1;
        if (
          typeof h.command !== "string" ||
          !commandHasPlatformStamp(h.command, HOOK_PLATFORM_GEMINI_CLI)
        ) {
          return false;
        }
      }
    }
  }
  return seen > 0;
}

/** True when any Autopilot handler omits timeout or sets it below 120000 ms. */
export function geminiAutopilotHasSmallTimeout(
  settings: GeminiSettingsFile,
): boolean {
  const bag =
    settings.hooks &&
    typeof settings.hooks === "object" &&
    !Array.isArray(settings.hooks)
      ? settings.hooks
      : {};
  for (const event of GEMINI_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(bag[event])
      ? (bag[event] as GeminiMatcherGroup[])
      : [];
    for (const g of groups) {
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      for (const h of hooks) {
        if (!isAutopilotGeminiHandler(h)) continue;
        if (
          typeof h.timeout !== "number" ||
          !Number.isFinite(h.timeout) ||
          h.timeout < GEMINI_HOOK_TIMEOUT_MS
        ) {
          return true;
        }
      }
    }
  }
  return false;
}
