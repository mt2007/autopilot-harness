/**
 * Merge Autopilot hooks into Grok Build project
 * `.grok/hooks/autopilot-harness.json` (Codex-shaped nested matcher groups).
 * Preserves foreign hooks + sibling files under `.grok/hooks/`; replaces
 * Autopilot-marked command entries only. Always writes timeout: 120.
 */
import { GROK_POST_TOOL_USE_MATCHER as PORT_GROK_POST_TOOL_USE_MATCHER } from "@autopilot-harness/port-grok-build";
import {
  HOOK_PLATFORM_GROK_BUILD,
  autopilotHookCommandLine,
  commandHasPlatformStamp,
  isAutopilotCommand,
} from "./hooks-merge.js";

/** Events Autopilot registers under Grok Build hooks (no StopFailure). */
export const GROK_AUTOPILOT_EVENTS = [
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
] as const;

export type GrokAutopilotEvent = (typeof GROK_AUTOPILOT_EVENTS)[number];

/** PostToolUse matcher draft (keep in sync with port-grok-build). */
export const GROK_POST_TOOL_USE_MATCHER = PORT_GROK_POST_TOOL_USE_MATCHER;

/** Confirm-chain budget; Grok default timeout is too low without this. */
export const GROK_HOOK_TIMEOUT_SEC = 120;

export const GROK_HOOKS_REL_PATH = [".grok", "hooks", "autopilot-harness.json"].join(
  "/",
);

export interface GrokHookHandler {
  type?: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface GrokMatcherGroup {
  matcher?: string;
  hooks?: GrokHookHandler[];
  /** Legacy flat handler shape; still scrubbed if Autopilot. */
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface GrokHooksFile {
  description?: string;
  hooks?: Record<string, GrokMatcherGroup[] | unknown>;
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

/** Build the Autopilot command handler for a Grok hook event (timeout 120). */
export function autopilotGrokHookHandler(
  event: GrokAutopilotEvent,
): GrokHookHandler {
  return {
    type: "command",
    command: autopilotHookCommandLine(HOOK_PLATFORM_GROK_BUILD, event),
    timeout: GROK_HOOK_TIMEOUT_SEC,
  };
}

/** Matcher group Autopilot installs for one Grok event. */
export function autopilotGrokMatcherGroup(
  event: GrokAutopilotEvent,
): GrokMatcherGroup {
  const handler = autopilotGrokHookHandler(event);
  if (event === "PostToolUse") {
    return {
      matcher: GROK_POST_TOOL_USE_MATCHER,
      hooks: [handler],
    };
  }
  // UserPromptSubmit / Stop: omit matcher (host ignores / burns clarity).
  return { hooks: [handler] };
}

/**
 * Ensure hooks file shape is merge-safe; otherwise refuse (do not wipe).
 */
export function validateGrokHooksShape(file: GrokHooksFile): string | null {
  for (const key of Object.keys(file)) {
    if (isUnsafeKey(key)) {
      return `hooks file key "${safeKeyLabel(key)}" is not allowed.`;
    }
  }
  if (file.hooks == null) return null;
  if (
    typeof file.hooks !== "object" ||
    Array.isArray(file.hooks) ||
    file.hooks === null
  ) {
    return 'hooks file "hooks" must be an object.';
  }
  for (const [key, value] of Object.entries(file.hooks)) {
    const label = safeKeyLabel(key);
    if (isUnsafeKey(key)) {
      return `hooks file hooks key "${label}" is not allowed.`;
    }
    if (value == null) continue;
    if (!Array.isArray(value)) {
      return `hooks file hooks.${label} must be an array of matcher groups.`;
    }
    for (const group of value) {
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        return `hooks file hooks.${label} contains a non-object matcher group.`;
      }
      const g = group as GrokMatcherGroup;
      if (g.matcher != null && typeof g.matcher !== "string") {
        return `hooks file hooks.${label} has a non-string matcher.`;
      }
      if (g.command != null && typeof g.command !== "string") {
        return `hooks file hooks.${label} has a non-string command.`;
      }
      if (
        g.timeout != null &&
        (typeof g.timeout !== "number" || !Number.isFinite(g.timeout))
      ) {
        return `hooks file hooks.${label} has a non-finite timeout.`;
      }
      if (g.hooks == null) continue;
      if (!Array.isArray(g.hooks)) {
        return `hooks file hooks.${label} matcher group hooks must be an array.`;
      }
      for (const h of g.hooks) {
        if (!h || typeof h !== "object" || Array.isArray(h)) {
          return `hooks file hooks.${label} contains a non-object hook handler.`;
        }
        if (h.command != null && typeof h.command !== "string") {
          return `hooks file hooks.${label} has a non-string command.`;
        }
        if (h.type != null && typeof h.type !== "string") {
          return `hooks file hooks.${label} has a non-string type.`;
        }
        if (
          h.timeout != null &&
          (typeof h.timeout !== "number" || !Number.isFinite(h.timeout))
        ) {
          return `hooks file hooks.${label} has a non-finite timeout.`;
        }
      }
    }
  }
  return null;
}

function copyGroupMeta(
  group: GrokMatcherGroup,
  omit: ReadonlySet<string>,
): GrokMatcherGroup {
  const meta: GrokMatcherGroup = {};
  for (const [key, value] of Object.entries(group)) {
    if (omit.has(key) || isUnsafeKey(key)) continue;
    meta[key] = value;
  }
  return meta;
}

const OMIT_AUTOPILOT_SHELL: ReadonlySet<string> = new Set([
  "command",
  "timeout",
  "hooks",
  "type",
]);

const OMIT_HOOKS_ONLY: ReadonlySet<string> = new Set(["hooks"]);
const OMIT_NONE: ReadonlySet<string> = new Set();

/**
 * True when scrub left only Autopilot's own PostToolUse matcher (or nothing).
 * Drop these so Autopilot-only files become vacant; keep foreign matcher shells.
 */
function isDroppableAutopilotMatcherShell(meta: GrokMatcherGroup): boolean {
  const keys = Object.keys(meta);
  if (keys.length === 0) return true;
  return (
    keys.length === 1 && meta.matcher === GROK_POST_TOOL_USE_MATCHER
  );
}

function stripAutopilotFromGroups(
  groups: GrokMatcherGroup[],
): GrokMatcherGroup[] {
  const out: GrokMatcherGroup[] = [];
  for (const group of groups) {
    if (!Array.isArray(group.hooks)) {
      if (isAutopilotCommand(group.command)) {
        const meta = copyGroupMeta(group, OMIT_AUTOPILOT_SHELL);
        if (!isDroppableAutopilotMatcherShell(meta)) {
          out.push(meta);
        }
        continue;
      }
      out.push(copyGroupMeta(group, OMIT_NONE));
      continue;
    }
    const kept = group.hooks.filter((h) => !isAutopilotCommand(h?.command));
    const next: GrokMatcherGroup = { ...group, hooks: kept };
    const hadTopAutopilot = isAutopilotCommand(group.command);
    if (hadTopAutopilot) {
      delete next.command;
      delete next.timeout;
      delete next.type;
    }
    if (kept.length === 0) {
      if (group.hooks.length === 0) {
        if (hadTopAutopilot) {
          const meta = copyGroupMeta(next, OMIT_AUTOPILOT_SHELL);
          if (!isDroppableAutopilotMatcherShell(meta)) {
            out.push({ ...meta, hooks: [] });
          }
          continue;
        }
        out.push({ ...copyGroupMeta(next, OMIT_HOOKS_ONLY), hooks: [] });
        continue;
      }
      if (typeof next.command === "string" && next.command.trim() !== "") {
        out.push(copyGroupMeta(next, OMIT_HOOKS_ONLY));
        continue;
      }
      // Nested hooks were all Autopilot — keep foreign matcher shells; drop
      // Autopilot's own PostToolUse matcher leftover so vacant unlink works.
      const meta = copyGroupMeta(next, OMIT_AUTOPILOT_SHELL);
      if (!isDroppableAutopilotMatcherShell(meta)) {
        out.push({ ...meta, hooks: [] });
      }
      continue;
    }
    out.push({ ...copyGroupMeta(next, OMIT_HOOKS_ONLY), hooks: kept });
  }
  return out;
}

/**
 * Merge Autopilot Grok hooks into existing or empty hooks file.
 * Always sets timeout: 120 on Autopilot handlers.
 */
export function mergeGrokHooks(existing: GrokHooksFile | null): GrokHooksFile {
  const base: GrokHooksFile = {};
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const shapeError = validateGrokHooksShape(existing);
    if (shapeError) {
      throw new Error(shapeError);
    }
    for (const [key, value] of Object.entries(existing)) {
      if (isUnsafeKey(key)) continue;
      base[key] = value;
    }
  } else {
    const shapeError = validateGrokHooksShape(base);
    if (shapeError) {
      throw new Error(shapeError);
    }
  }

  const nextHooks: Record<string, GrokMatcherGroup[]> = Object.create(null);
  if (base.hooks && typeof base.hooks === "object" && !Array.isArray(base.hooks)) {
    for (const [key, value] of Object.entries(base.hooks)) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(value)) continue;
      nextHooks[key] = stripAutopilotFromGroups(value as GrokMatcherGroup[]);
    }
  }

  for (const event of GROK_AUTOPILOT_EVENTS) {
    const current = Array.isArray(nextHooks[event])
      ? [...nextHooks[event]!]
      : [];
    const stripped = stripAutopilotFromGroups(current);
    stripped.push(autopilotGrokMatcherGroup(event));
    nextHooks[event] = stripped;
  }

  base.hooks = nextHooks;
  return base;
}

/**
 * Remove Autopilot Grok hook handlers; keep foreign hooks.
 * Does not delete the file — caller unlinks when {@link grokHooksFileIsVacant}.
 */
export function stripAutopilotGrokHooks(
  existing: GrokHooksFile,
): GrokHooksFile {
  const shapeError = validateGrokHooksShape(existing);
  if (shapeError) {
    throw new Error(shapeError);
  }

  const base: GrokHooksFile = {};
  for (const [key, value] of Object.entries(existing)) {
    if (isUnsafeKey(key)) continue;
    base[key] = value;
  }

  const prevHooks = base.hooks;
  if (prevHooks && typeof prevHooks === "object" && !Array.isArray(prevHooks)) {
    const nextHooks: Record<string, GrokMatcherGroup[]> = Object.create(null);
    for (const [key, value] of Object.entries(prevHooks)) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(value)) continue;
      const kept = stripAutopilotFromGroups(value as GrokMatcherGroup[]);
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

/** True when strip left nothing worth keeping — uninstall should unlink the file. */
export function grokHooksFileIsVacant(file: GrokHooksFile | null): boolean {
  if (!file || typeof file !== "object" || Array.isArray(file)) return true;
  for (const [key, value] of Object.entries(file)) {
    if (isUnsafeKey(key)) continue;
    if (key === "hooks") {
      if (value == null) continue;
      if (typeof value === "object" && !Array.isArray(value)) {
        if (Object.keys(value as object).length === 0) continue;
        return false;
      }
      return false;
    }
    // Any other top-level field (e.g. description) keeps the file.
    if (value !== undefined) return false;
  }
  return true;
}

export function grokHooksContainAutopilot(
  file: GrokHooksFile | null,
): boolean {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return false;
  }
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  for (const value of Object.values(bag)) {
    if (!Array.isArray(value)) continue;
    for (const g of value as GrokMatcherGroup[]) {
      if (isAutopilotCommand(g?.command)) return true;
      const hooks = Array.isArray(g?.hooks) ? g.hooks : [];
      if (hooks.some((h) => isAutopilotCommand(h?.command))) return true;
    }
  }
  return false;
}

export function summarizeGrokAutopilotHooks(file: GrokHooksFile): {
  missingEvents: string[];
  duplicates: number;
} {
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  const missingEvents: string[] = [];
  let duplicates = 0;
  for (const event of GROK_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(bag[event])
      ? (bag[event] as GrokMatcherGroup[])
      : [];
    let n = 0;
    for (const g of groups) {
      if (isAutopilotCommand(g.command)) n += 1;
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      n += hooks.filter((h) => isAutopilotCommand(h?.command)).length;
    }
    if (n === 0) missingEvents.push(event);
    if (n > 1) duplicates += n - 1;
  }
  return { missingEvents, duplicates };
}

export function hasCompleteGrokAutopilotHooks(file: GrokHooksFile): boolean {
  const { missingEvents, duplicates } = summarizeGrokAutopilotHooks(file);
  return missingEvents.length === 0 && duplicates === 0;
}

/**
 * True when every Autopilot Grok command stamps `--platform grok-build`.
 * Incomplete installs return false.
 */
export function grokHooksHavePlatformStamp(file: GrokHooksFile): boolean {
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  let seen = 0;
  for (const event of GROK_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(bag[event])
      ? (bag[event] as GrokMatcherGroup[])
      : [];
    for (const g of groups) {
      if (isAutopilotCommand(g.command)) {
        seen += 1;
        if (!commandHasPlatformStamp(g.command, HOOK_PLATFORM_GROK_BUILD)) {
          return false;
        }
      }
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      for (const h of hooks) {
        if (!isAutopilotCommand(h?.command)) continue;
        seen += 1;
        if (!commandHasPlatformStamp(h.command, HOOK_PLATFORM_GROK_BUILD)) {
          return false;
        }
      }
    }
  }
  return seen > 0;
}

/**
 * True when any Autopilot Grok handler omits timeout or sets timeout &lt; 120
 * (doctor WARN — Grok default is too low for confirm chains).
 */
export function grokAutopilotHasOmittedOrSmallTimeout(
  file: GrokHooksFile,
): boolean {
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  for (const event of GROK_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(bag[event])
      ? (bag[event] as GrokMatcherGroup[])
      : [];
    for (const g of groups) {
      const handlers: GrokHookHandler[] = [];
      if (isAutopilotCommand(g.command)) {
        handlers.push(g as GrokHookHandler);
      }
      if (Array.isArray(g.hooks)) handlers.push(...g.hooks);
      for (const h of handlers) {
        if (!isAutopilotCommand(h?.command)) continue;
        if (h.timeout == null) return true;
        if (
          typeof h.timeout === "number" &&
          Number.isFinite(h.timeout) &&
          h.timeout < GROK_HOOK_TIMEOUT_SEC
        ) {
          return true;
        }
      }
    }
  }
  return false;
}
