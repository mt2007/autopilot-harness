/**
 * Merge Autopilot hooks into Factory Droid project `.factory/hooks.json`.
 * Top-level event keys (docs.factory.ai) — not a nested `"hooks":{…}` wrap.
 * Preserves foreign events + sibling files under `.factory/`; replaces
 * Autopilot-marked command entries only. Always writes timeout: 120.
 * Commands use `$FACTORY_PROJECT_DIR` (host cwd ≠ repo root).
 */
import { FACTORY_POST_TOOL_USE_MATCHER as PORT_FACTORY_POST_TOOL_USE_MATCHER } from "@autopilot-harness/port-factory-droid";
import {
  HOOK_PLATFORM_FACTORY_DROID,
  commandHasPlatformStamp,
  isAutopilotCommand,
} from "./hooks-merge.js";

/** Events Autopilot registers under Factory Droid hooks. */
export const FACTORY_AUTOPILOT_EVENTS = [
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
] as const;

export type FactoryAutopilotEvent = (typeof FACTORY_AUTOPILOT_EVENTS)[number];

/** PostToolUse matcher draft (keep in sync with port-factory-droid). */
export const FACTORY_POST_TOOL_USE_MATCHER = PORT_FACTORY_POST_TOOL_USE_MATCHER;

/** Confirm-chain budget; Factory default timeout is too low without this. */
export const FACTORY_HOOK_TIMEOUT_SEC = 120;

export const FACTORY_HOOKS_REL_PATH = [".factory", "hooks.json"].join("/");

/** Legacy nested path still loaded by Droid until next save migrates. */
export const FACTORY_LEGACY_HOOKS_REL_PATH = [".factory", "hooks", "hooks.json"].join(
  "/",
);

/** Project/user settings (hooksDisabled / allowManagedHooksOnly / nested hooks). */
export const FACTORY_SETTINGS_REL_PATH = [".factory", "settings.json"].join("/");

export interface FactoryHookHandler {
  type?: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface FactoryMatcherGroup {
  matcher?: string;
  hooks?: FactoryHookHandler[];
  /** Legacy flat handler shape; still scrubbed if Autopilot. */
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

/**
 * Top-level event → matcher groups (unwrapped). Extra top-level keys
 * (e.g. description) are preserved when safe.
 */
export interface FactoryHooksFile {
  [key: string]: FactoryMatcherGroup[] | unknown;
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

const FACTORY_EVENT_SET = new Set<string>(FACTORY_AUTOPILOT_EVENTS);

/**
 * Factory-stock command: absolute via `$FACTORY_PROJECT_DIR` (quoted).
 * Do not use relative `.autopilot/bin/…` — Droid cwd is not the project root.
 */
export function autopilotFactoryHookCommandLine(event: string): string {
  if (typeof event !== "string") {
    throw new Error("autopilotFactoryHookCommandLine: invalid event");
  }
  const safeEvent = event.replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 64);
  if (!safeEvent || safeEvent !== event) {
    throw new Error("autopilotFactoryHookCommandLine: invalid event");
  }
  return `node "$FACTORY_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform ${HOOK_PLATFORM_FACTORY_DROID} --event ${safeEvent}`;
}

/** Build the Autopilot command handler for a Factory hook event (timeout 120). */
export function autopilotFactoryHookHandler(
  event: FactoryAutopilotEvent,
): FactoryHookHandler {
  return {
    type: "command",
    command: autopilotFactoryHookCommandLine(event),
    timeout: FACTORY_HOOK_TIMEOUT_SEC,
  };
}

/** Matcher group Autopilot installs for one Factory event. */
export function autopilotFactoryMatcherGroup(
  event: FactoryAutopilotEvent,
): FactoryMatcherGroup {
  const handler = autopilotFactoryHookHandler(event);
  if (event === "PostToolUse") {
    return {
      matcher: FACTORY_POST_TOOL_USE_MATCHER,
      hooks: [handler],
    };
  }
  // UserPromptSubmit / Stop: omit matcher.
  return { hooks: [handler] };
}

/**
 * Bare string that looks like an Autopilot hook *invocation* (not prose that
 * merely mentions the hook filename). Used only for non-`.command` strings.
 */
function isLikelyAutopilotHookCommandLine(cmd: string): boolean {
  if (!isAutopilotCommand(cmd)) return false;
  return /\bnode(?:js)?\b/i.test(cmd) || cmd.includes("$FACTORY_PROJECT_DIR");
}

const AUTOPILOT_FINGERPRINT_MAX_DEPTH = 16;

/**
 * True when a nested `"hooks"` bag value carries an Autopilot command
 * (matcher-group array, flat handler object, or bare command string).
 */
function nestedEventValueHasAutopilot(value: unknown, depth = 0): boolean {
  if (depth > AUTOPILOT_FINGERPRINT_MAX_DEPTH) return false;
  if (typeof value === "string") return isLikelyAutopilotHookCommandLine(value);
  if (Array.isArray(value)) {
    // Recurse into each entry so malformed groups (e.g. hooks as object)
    // are still detected.
    return value.some((item) => nestedEventValueHasAutopilot(item, depth + 1));
  }
  return flatHandlerHasAutopilot(value, depth);
}

/** Flat handler object (not a matcher-group array) with an Autopilot command. */
function flatHandlerHasAutopilot(value: unknown, depth = 0): boolean {
  if (depth > AUTOPILOT_FINGERPRINT_MAX_DEPTH) return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as FactoryMatcherGroup;
  if (isAutopilotCommand(o.command)) return true;
  if (Array.isArray(o.hooks)) {
    return o.hooks.some(
      (h) =>
        isAutopilotCommand(h?.command) ||
        (h != null &&
          typeof h === "object" &&
          flatHandlerHasAutopilot(h, depth + 1)),
    );
  }
  // Malformed nested `.hooks` object (bag / flat) — walk as event bag.
  if (o.hooks != null && typeof o.hooks === "object") {
    return nestedHooksBagHasAutopilot(
      o.hooks as Record<string, unknown>,
      depth + 1,
    );
  }
  return false;
}

function nestedHooksBagHasAutopilot(
  nested: Record<string, unknown>,
  depth = 0,
): boolean {
  if (depth > AUTOPILOT_FINGERPRINT_MAX_DEPTH) return false;
  for (const value of Object.values(nested)) {
    if (nestedEventValueHasAutopilot(value, depth + 1)) return true;
  }
  return false;
}

/**
 * Ensure hooks file shape is merge-safe; otherwise refuse (do not wipe).
 * Rejects Claude-style top-level `"hooks":{…}` wrap when Autopilot is present.
 */
export function validateFactoryHooksShape(file: FactoryHooksFile): string | null {
  for (const key of Object.keys(file)) {
    if (isUnsafeKey(key)) {
      return `hooks file key "${safeKeyLabel(key)}" is not allowed.`;
    }
  }

  // Wrong wrap: Autopilot under nested hooks → fail-closed (must be top-level events).
  const nested = file.hooks;
  if (
    nested &&
    typeof nested === "object" &&
    !Array.isArray(nested) &&
    nested !== null
  ) {
    if (nestedHooksBagHasAutopilot(nested as Record<string, unknown>)) {
      return 'hooks file must use top-level event keys (not a nested "hooks" wrap) for Autopilot.';
    }
  }

  for (const [key, value] of Object.entries(file)) {
    const label = safeKeyLabel(key);
    if (isUnsafeKey(key)) {
      return `hooks file key "${label}" is not allowed.`;
    }
    if (key === "hooks") {
      // Nested wrap without Autopilot: still require object/array sanity.
      if (value == null) continue;
      if (typeof value !== "object" || Array.isArray(value)) {
        return 'hooks file "hooks" must be an object when present.';
      }
      continue;
    }

    const isAutopilotEvent = FACTORY_EVENT_SET.has(key);
    if (isAutopilotEvent) {
      if (value == null) continue;
      if (!Array.isArray(value)) {
        return `hooks file ${label} must be an array of matcher groups.`;
      }
    } else if (!Array.isArray(value)) {
      // Misplaced Autopilot flat handler under a non-event key — fail-closed.
      // Do not treat bare strings (e.g. description mentioning the hook
      // filename) as Autopilot; merge/strip only walk arrays / command fields.
      if (flatHandlerHasAutopilot(value)) {
        return `hooks file ${label} Autopilot handler must be under a top-level event array.`;
      }
      // Non-array metadata (description, etc.) — leave alone.
      continue;
    }

    // Autopilot events + foreign top-level arrays (merge/strip walk all arrays).
    for (const group of value as FactoryMatcherGroup[]) {
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        return `hooks file ${label} contains a non-object matcher group.`;
      }
      const g = group as FactoryMatcherGroup;
      if (g.matcher != null && typeof g.matcher !== "string") {
        return `hooks file ${label} has a non-string matcher.`;
      }
      if (g.command != null && typeof g.command !== "string") {
        return `hooks file ${label} has a non-string command.`;
      }
      if (
        g.timeout != null &&
        (typeof g.timeout !== "number" || !Number.isFinite(g.timeout))
      ) {
        return `hooks file ${label} has a non-finite timeout.`;
      }
      if (g.hooks == null) continue;
      if (!Array.isArray(g.hooks)) {
        return `hooks file ${label} matcher group hooks must be an array.`;
      }
      for (const h of g.hooks) {
        if (!h || typeof h !== "object" || Array.isArray(h)) {
          return `hooks file ${label} contains a non-object hook handler.`;
        }
        if (h.command != null && typeof h.command !== "string") {
          return `hooks file ${label} has a non-string command.`;
        }
        if (h.type != null && typeof h.type !== "string") {
          return `hooks file ${label} has a non-string type.`;
        }
        if (
          h.timeout != null &&
          (typeof h.timeout !== "number" || !Number.isFinite(h.timeout))
        ) {
          return `hooks file ${label} has a non-finite timeout.`;
        }
      }
    }
  }
  return null;
}

function copyGroupMeta(
  group: FactoryMatcherGroup,
  omit: ReadonlySet<string>,
): FactoryMatcherGroup {
  const meta: FactoryMatcherGroup = {};
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

function isDroppableAutopilotMatcherShell(meta: FactoryMatcherGroup): boolean {
  const keys = Object.keys(meta);
  if (keys.length === 0) return true;
  return keys.length === 1 && meta.matcher === FACTORY_POST_TOOL_USE_MATCHER;
}

function stripAutopilotFromGroups(
  groups: FactoryMatcherGroup[],
): FactoryMatcherGroup[] {
  const out: FactoryMatcherGroup[] = [];
  for (const group of groups) {
    // Defense in depth — validateFactoryHooksShape should already reject these.
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      throw new Error("hooks file contains a non-object matcher group.");
    }
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
    const next: FactoryMatcherGroup = { ...group, hooks: kept };
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
 * Merge Autopilot Factory hooks into existing or empty hooks file.
 * Always sets timeout: 120 on Autopilot handlers.
 */
export function mergeFactoryHooks(
  existing: FactoryHooksFile | null,
): FactoryHooksFile {
  const base: FactoryHooksFile = Object.create(null);
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const shapeError = validateFactoryHooksShape(existing);
    if (shapeError) {
      throw new Error(shapeError);
    }
    for (const [key, value] of Object.entries(existing)) {
      if (isUnsafeKey(key)) continue;
      base[key] = value;
    }
  } else {
    const shapeError = validateFactoryHooksShape(base);
    if (shapeError) {
      throw new Error(shapeError);
    }
  }

  // Strip Autopilot from all top-level event arrays (incl. foreign events).
  for (const [key, value] of Object.entries(base)) {
    if (isUnsafeKey(key) || key === "hooks") continue;
    if (!Array.isArray(value)) continue;
    const kept = stripAutopilotFromGroups(value as FactoryMatcherGroup[]);
    // Drop empty foreign arrays so init does not write `"SessionStart": []`
    // after scrubbing Autopilot-only leftovers under unknown event keys.
    if (kept.length === 0 && !FACTORY_EVENT_SET.has(key)) {
      delete base[key];
    } else {
      base[key] = kept;
    }
  }

  for (const event of FACTORY_AUTOPILOT_EVENTS) {
    const current = Array.isArray(base[event])
      ? [...(base[event] as FactoryMatcherGroup[])]
      : [];
    const stripped = stripAutopilotFromGroups(current);
    stripped.push(autopilotFactoryMatcherGroup(event));
    base[event] = stripped;
  }

  return base;
}

/**
 * Remove Autopilot Factory hook handlers; keep foreign hooks.
 * Does not delete the file — caller unlinks when {@link factoryHooksFileIsVacant}.
 */
export function stripAutopilotFactoryHooks(
  existing: FactoryHooksFile,
): FactoryHooksFile {
  const shapeError = validateFactoryHooksShape(existing);
  if (shapeError) {
    throw new Error(shapeError);
  }

  const base: FactoryHooksFile = Object.create(null);
  for (const [key, value] of Object.entries(existing)) {
    if (isUnsafeKey(key)) continue;
    base[key] = value;
  }

  for (const [key, value] of Object.entries(base)) {
    if (isUnsafeKey(key) || key === "hooks") continue;
    if (!Array.isArray(value)) continue;
    const kept = stripAutopilotFromGroups(value as FactoryMatcherGroup[]);
    if (kept.length === 0) {
      delete base[key];
    } else {
      base[key] = kept;
    }
  }

  return base;
}

/** True when strip left nothing worth keeping — uninstall should unlink the file. */
export function factoryHooksFileIsVacant(
  file: FactoryHooksFile | null,
): boolean {
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
    // Empty matcher-group arrays (Autopilot or foreign leftovers) are vacant.
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (Array.isArray(value)) return false;
    if (value !== undefined) return false;
  }
  return true;
}

export function factoryHooksContainAutopilot(
  file: FactoryHooksFile | null,
): boolean {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return false;
  }
  for (const [key, value] of Object.entries(file)) {
    if (key === "hooks") {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (nestedHooksBagHasAutopilot(value as Record<string, unknown>)) {
          return true;
        }
      }
      continue;
    }
    if (Array.isArray(value)) {
      // Same recursive walk as nested bags (malformed group.hooks object, etc.).
      if (value.some((item) => nestedEventValueHasAutopilot(item, 0))) {
        return true;
      }
      continue;
    }
    // Stranded flat Autopilot object outside event arrays (validate rejects).
    // Bare top-level strings are not fingerprints (avoid description false positives).
    if (flatHandlerHasAutopilot(value)) return true;
  }
  return false;
}

export function summarizeFactoryAutopilotHooks(file: FactoryHooksFile): {
  missingEvents: string[];
  duplicates: number;
} {
  const missingEvents: string[] = [];
  let duplicates = 0;
  for (const event of FACTORY_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(file[event])
      ? (file[event] as FactoryMatcherGroup[])
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

export function hasCompleteFactoryAutopilotHooks(
  file: FactoryHooksFile,
): boolean {
  const { missingEvents, duplicates } = summarizeFactoryAutopilotHooks(file);
  return missingEvents.length === 0 && duplicates === 0;
}

/**
 * True when every Autopilot Factory command stamps `--platform factory-droid`.
 */
export function factoryHooksHavePlatformStamp(file: FactoryHooksFile): boolean {
  let seen = 0;
  for (const event of FACTORY_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(file[event])
      ? (file[event] as FactoryMatcherGroup[])
      : [];
    for (const g of groups) {
      if (isAutopilotCommand(g.command)) {
        seen += 1;
        if (
          !commandHasPlatformStamp(g.command, HOOK_PLATFORM_FACTORY_DROID)
        ) {
          return false;
        }
      }
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      for (const h of hooks) {
        if (!isAutopilotCommand(h?.command)) continue;
        seen += 1;
        if (
          !commandHasPlatformStamp(h.command, HOOK_PLATFORM_FACTORY_DROID)
        ) {
          return false;
        }
      }
    }
  }
  return seen > 0;
}

/**
 * True when any Autopilot Factory handler omits timeout or sets timeout &lt; 120.
 */
export function factoryAutopilotHasOmittedOrSmallTimeout(
  file: FactoryHooksFile,
): boolean {
  for (const event of FACTORY_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(file[event])
      ? (file[event] as FactoryMatcherGroup[])
      : [];
    for (const g of groups) {
      const handlers: FactoryHookHandler[] = [];
      if (isAutopilotCommand(g.command)) {
        handlers.push(g as FactoryHookHandler);
      }
      if (Array.isArray(g.hooks)) handlers.push(...g.hooks);
      for (const h of handlers) {
        if (!isAutopilotCommand(h?.command)) continue;
        if (h.timeout == null) return true;
        if (
          typeof h.timeout === "number" &&
          Number.isFinite(h.timeout) &&
          h.timeout < FACTORY_HOOK_TIMEOUT_SEC
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** True when every Autopilot command embeds `$FACTORY_PROJECT_DIR`. */
export function factoryHooksUseProjectDirEnv(file: FactoryHooksFile): boolean {
  let seen = 0;
  for (const event of FACTORY_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(file[event])
      ? (file[event] as FactoryMatcherGroup[])
      : [];
    for (const g of groups) {
      const cmds: string[] = [];
      if (typeof g.command === "string") cmds.push(g.command);
      if (Array.isArray(g.hooks)) {
        for (const h of g.hooks) {
          if (typeof h?.command === "string") cmds.push(h.command);
        }
      }
      for (const cmd of cmds) {
        if (!isAutopilotCommand(cmd)) continue;
        seen += 1;
        if (!cmd.includes("$FACTORY_PROJECT_DIR")) return false;
      }
    }
  }
  return seen > 0;
}

/**
 * Best-effort parse of Factory `settings.json` flags (project or user home).
 * Missing/unreadable → all false.
 */
export function readFactorySettingsFlags(settings: unknown): {
  hooksDisabled: boolean;
  allowManagedHooksOnly: boolean;
  hooksContainAutopilot: boolean;
} {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {
      hooksDisabled: false,
      allowManagedHooksOnly: false,
      hooksContainAutopilot: false,
    };
  }
  const o = settings as Record<string, unknown>;
  return {
    hooksDisabled: o.hooksDisabled === true,
    allowManagedHooksOnly: o.allowManagedHooksOnly === true,
    // Nested `"hooks":{…}` under settings — same fingerprint walk as hooks.json wrap.
    hooksContainAutopilot: factoryHooksContainAutopilot(
      settings as FactoryHooksFile,
    ),
  };
}
