/**
 * Merge Autopilot hooks into Devin CLI `.devin/hooks.v1.json`.
 * The file is the event map — not a nested `"hooks"` wrap, and not
 * `.devin/config.json`. Sibling events stay. Commands use `$DEVIN_PROJECT_DIR`.
 * Strip any Autopilot hook command (not only `--platform devin`) before re-adding
 * the Devin stamp — leftover Claude/Factory fingerprints in this file would dual-fire.
 */
import {
  DEVIN_AUTOPILOT_EVENTS,
  DEVIN_HOOK_TIMEOUT_SEC,
  DEVIN_POST_TOOL_USE_MATCHER,
  DEVIN_SOFT_MIN_VERSION,
  DEVIN_STOP_CAP_RAISE_FOUND,
  devinHookCommandLine,
  type DevinHookEvent,
} from "@autopilot-harness/port-devin";
import {
  HOOK_PLATFORM_DEVIN,
  commandHasPlatformStamp,
  isAutopilotCommand,
} from "./hooks-merge.js";

export {
  DEVIN_AUTOPILOT_EVENTS,
  DEVIN_HOOK_TIMEOUT_SEC,
  DEVIN_POST_TOOL_USE_MATCHER,
  DEVIN_SOFT_MIN_VERSION,
  DEVIN_STOP_CAP_RAISE_FOUND,
};

/** Project hooks file. Do not write `.devin/config.json`. */
export const DEVIN_HOOKS_REL_PATH = [".devin", "hooks.v1.json"].join("/");

/** Never written by Autopilot; doctor WARNs if it still lists Autopilot hooks. */
export const DEVIN_CONFIG_REL_PATH = [".devin", "config.json"].join("/");

export interface DevinHookHandler {
  type?: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface DevinMatcherGroup {
  matcher?: string;
  hooks?: DevinHookHandler[];
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface DevinHooksFile {
  [key: string]: DevinMatcherGroup[] | unknown;
}

const DEVIN_EVENT_SET = new Set<string>(DEVIN_AUTOPILOT_EVENTS);

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

export function autopilotDevinHookCommandLine(event: DevinHookEvent): string {
  return devinHookCommandLine(event);
}

export function autopilotDevinMatcherGroup(
  event: DevinHookEvent,
): DevinMatcherGroup {
  const handler: DevinHookHandler = {
    type: "command",
    command: autopilotDevinHookCommandLine(event),
    timeout: DEVIN_HOOK_TIMEOUT_SEC,
  };
  if (event === "PostToolUse") {
    return { matcher: DEVIN_POST_TOOL_USE_MATCHER, hooks: [handler] };
  }
  return { hooks: [handler] };
}

function handlerIsAutopilot(handler: DevinHookHandler | undefined): boolean {
  return isAutopilotCommand(handler?.command);
}

/**
 * Bare strings (description / notes) may mention the hook filename.
 * Require an invocation-shaped line — same bar as Factory merge.
 */
function isLikelyAutopilotHookCommandLine(cmd: string): boolean {
  if (!isAutopilotCommand(cmd)) return false;
  return (
    /\bnode(?:js)?\b/i.test(cmd) ||
    cmd.includes("$DEVIN_PROJECT_DIR") ||
    cmd.includes("$FACTORY_PROJECT_DIR")
  );
}

function copyGroupMeta(
  group: DevinMatcherGroup,
  omit: ReadonlySet<string>,
): DevinMatcherGroup {
  const meta: DevinMatcherGroup = {};
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

function isDroppableAutopilotMatcherShell(meta: DevinMatcherGroup): boolean {
  const keys = Object.keys(meta);
  if (keys.length === 0) return true;
  return keys.length === 1 && meta.matcher === DEVIN_POST_TOOL_USE_MATCHER;
}

function stripAutopilotFromGroups(
  groups: DevinMatcherGroup[],
): DevinMatcherGroup[] {
  const out: DevinMatcherGroup[] = [];
  for (const group of groups) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      throw new Error("hooks file contains a non-object matcher group.");
    }
    if (!Array.isArray(group.hooks)) {
      if (handlerIsAutopilot(group)) {
        const meta = copyGroupMeta(group, OMIT_AUTOPILOT_SHELL);
        if (!isDroppableAutopilotMatcherShell(meta)) {
          out.push(meta);
        }
        continue;
      }
      out.push(copyGroupMeta(group, new Set()));
      continue;
    }
    const kept = group.hooks.filter((h) => !handlerIsAutopilot(h));
    const next: DevinMatcherGroup = { ...group, hooks: kept };
    const hadTopAutopilot = handlerIsAutopilot(group);
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
    out.push(next);
  }
  return out;
}

function nestedHasAutopilot(value: unknown, depth = 0): boolean {
  if (depth > 16 || value == null) return false;
  if (typeof value === "string") return isLikelyAutopilotHookCommandLine(value);
  if (Array.isArray(value)) {
    return value.some((item) => nestedHasAutopilot(item, depth + 1));
  }
  if (typeof value !== "object") return false;
  const o = value as DevinMatcherGroup & Record<string, unknown>;
  // `.command` is the hook field — filename alone is enough (no prose bar).
  if (isAutopilotCommand(o.command)) return true;
  if (o.hooks != null && nestedHasAutopilot(o.hooks, depth + 1)) return true;
  for (const [key, child] of Object.entries(o)) {
    if (key === "command" || key === "hooks" || isUnsafeKey(key)) continue;
    // Skip matcher / timeout / type scalars — not command lines.
    if (key === "matcher" || key === "timeout" || key === "type") continue;
    // Object string fields (description / notes) are prose. Bare command
    // strings still count when they appear as array entries.
    if (typeof child === "string") continue;
    if (nestedHasAutopilot(child, depth + 1)) return true;
  }
  return false;
}

/** Refuse a nested `"hooks"` wrap that already carries any Autopilot command. */
export function validateDevinHooksShape(file: DevinHooksFile): string | null {
  for (const key of Object.keys(file)) {
    if (isUnsafeKey(key)) {
      return `hooks file key "${safeKeyLabel(key)}" is not allowed.`;
    }
  }
  const nested = file.hooks;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    if (nestedHasAutopilot(nested)) {
      return 'hooks file must use top-level event keys (not a nested "hooks" wrap) for Autopilot.';
    }
  }
  for (const [key, value] of Object.entries(file)) {
    if (isUnsafeKey(key)) continue;
    if (key === "hooks") {
      // Array / scalar wrap is not the event map. Leaving it would keep a
      // second Autopilot command list beside the top-level stamps.
      if (value == null) continue;
      if (typeof value !== "object" || Array.isArray(value)) {
        return 'hooks file "hooks" must be an object when present.';
      }
      continue;
    }
    if (value == null) continue;
    if (!Array.isArray(value)) {
      if (DEVIN_EVENT_SET.has(key)) {
        return `hooks file ${safeKeyLabel(key)} must be an array of matcher groups.`;
      }
      // Misplaced Autopilot flat handler under a non-event key — fail-closed.
      // Bare strings (e.g. description mentioning the hook filename) are not
      // fingerprints — same bar as Factory / devinHooksContainAutopilot.
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        nestedHasAutopilot(value)
      ) {
        return `hooks file ${safeKeyLabel(key)} Autopilot handler must be under a top-level event array.`;
      }
      continue;
    }
    for (const group of value as DevinMatcherGroup[]) {
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        return `hooks file ${safeKeyLabel(key)} contains a non-object matcher group.`;
      }
      if (group.matcher != null && typeof group.matcher !== "string") {
        return `hooks file ${safeKeyLabel(key)} has a non-string matcher.`;
      }
      if (group.command != null && typeof group.command !== "string") {
        return `hooks file ${safeKeyLabel(key)} has a non-string command.`;
      }
      if (
        group.timeout != null &&
        (typeof group.timeout !== "number" || !Number.isFinite(group.timeout))
      ) {
        return `hooks file ${safeKeyLabel(key)} has a non-finite timeout.`;
      }
      if (group.hooks == null) continue;
      if (!Array.isArray(group.hooks)) {
        return `hooks file ${safeKeyLabel(key)} matcher group hooks must be an array.`;
      }
      for (const h of group.hooks) {
        if (!h || typeof h !== "object" || Array.isArray(h)) {
          return `hooks file ${safeKeyLabel(key)} contains a non-object hook handler.`;
        }
        if (h.command != null && typeof h.command !== "string") {
          return `hooks file ${safeKeyLabel(key)} has a non-string command.`;
        }
        if (h.type != null && typeof h.type !== "string") {
          return `hooks file ${safeKeyLabel(key)} has a non-string type.`;
        }
        if (
          h.timeout != null &&
          (typeof h.timeout !== "number" || !Number.isFinite(h.timeout))
        ) {
          return `hooks file ${safeKeyLabel(key)} has a non-finite timeout.`;
        }
      }
    }
  }
  return null;
}

export function mergeDevinHooks(existing: DevinHooksFile | null): DevinHooksFile {
  const base: DevinHooksFile = Object.create(null);
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const shapeError = validateDevinHooksShape(existing);
    if (shapeError) throw new Error(shapeError);
    for (const [key, value] of Object.entries(existing)) {
      if (isUnsafeKey(key)) continue;
      base[key] = value;
    }
  }
  for (const [key, value] of Object.entries(base)) {
    if (isUnsafeKey(key) || key === "hooks") continue;
    if (!Array.isArray(value)) continue;
    const kept = stripAutopilotFromGroups(value as DevinMatcherGroup[]);
    if (kept.length === 0 && !DEVIN_EVENT_SET.has(key)) {
      delete base[key];
    } else {
      base[key] = kept;
    }
  }
  for (const event of DEVIN_AUTOPILOT_EVENTS) {
    const current = Array.isArray(base[event])
      ? [...(base[event] as DevinMatcherGroup[])]
      : [];
    const stripped = stripAutopilotFromGroups(current);
    stripped.push(autopilotDevinMatcherGroup(event));
    base[event] = stripped;
  }
  return base;
}

/**
 * Remove Autopilot Devin hook handlers; keep foreign hooks.
 * Does not delete the file — caller unlinks when {@link devinHooksFileIsVacant}.
 */
export function stripAutopilotDevinHooks(
  existing: DevinHooksFile,
): DevinHooksFile {
  const shapeError = validateDevinHooksShape(existing);
  if (shapeError) {
    throw new Error(shapeError);
  }

  const base: DevinHooksFile = Object.create(null);
  for (const [key, value] of Object.entries(existing)) {
    if (isUnsafeKey(key)) continue;
    base[key] = value;
  }

  for (const [key, value] of Object.entries(base)) {
    if (isUnsafeKey(key) || key === "hooks") continue;
    if (!Array.isArray(value)) continue;
    const kept = stripAutopilotFromGroups(value as DevinMatcherGroup[]);
    if (kept.length === 0) {
      delete base[key];
    } else {
      base[key] = kept;
    }
  }

  return base;
}

/** True when strip left nothing worth keeping — uninstall should unlink the file. */
export function devinHooksFileIsVacant(file: DevinHooksFile | null): boolean {
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
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (Array.isArray(value)) return false;
    if (value !== undefined) return false;
  }
  return true;
}

export function devinHooksContainAutopilot(
  file: DevinHooksFile | null,
): boolean {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return false;
  }
  for (const [key, value] of Object.entries(file)) {
    if (key === "hooks") {
      // Nested wrap bag only (array/scalar wraps are shape errors on merge).
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (nestedHasAutopilot(value)) return true;
      }
      continue;
    }
    if (Array.isArray(value)) {
      if (value.some((item) => nestedHasAutopilot(item))) return true;
      continue;
    }
    // Stranded flat Autopilot object outside event arrays (validate rejects).
    // Bare top-level strings are not fingerprints (avoid description false positives).
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      nestedHasAutopilot(value)
    ) {
      return true;
    }
  }
  return false;
}

export function summarizeDevinAutopilotHooks(file: DevinHooksFile): {
  missingEvents: string[];
  duplicates: number;
} {
  const missingEvents: string[] = [];
  let duplicates = 0;
  for (const event of DEVIN_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(file[event])
      ? (file[event] as DevinMatcherGroup[])
      : [];
    let n = 0;
    for (const g of groups) {
      if (!g || typeof g !== "object" || Array.isArray(g)) continue;
      if (isAutopilotCommand(g.command)) n += 1;
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      n += hooks.filter((h) => isAutopilotCommand(h?.command)).length;
    }
    if (n === 0) missingEvents.push(event);
    if (n > 1) duplicates += n - 1;
  }
  return { missingEvents, duplicates };
}

export function hasCompleteDevinAutopilotHooks(file: DevinHooksFile): boolean {
  const { missingEvents, duplicates } = summarizeDevinAutopilotHooks(file);
  return missingEvents.length === 0 && duplicates === 0;
}

/** True when every Autopilot Devin command stamps `--platform devin`. */
export function devinHooksHavePlatformStamp(file: DevinHooksFile): boolean {
  let seen = 0;
  for (const event of DEVIN_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(file[event])
      ? (file[event] as DevinMatcherGroup[])
      : [];
    for (const g of groups) {
      if (!g || typeof g !== "object" || Array.isArray(g)) continue;
      if (isAutopilotCommand(g.command)) {
        seen += 1;
        if (!commandHasPlatformStamp(g.command, HOOK_PLATFORM_DEVIN)) {
          return false;
        }
      }
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      for (const h of hooks) {
        if (!isAutopilotCommand(h?.command)) continue;
        seen += 1;
        if (!commandHasPlatformStamp(h.command, HOOK_PLATFORM_DEVIN)) {
          return false;
        }
      }
    }
  }
  return seen > 0;
}

/**
 * True when any Autopilot Devin handler omits timeout or sets timeout &lt; 120.
 */
export function devinAutopilotHasOmittedOrSmallTimeout(
  file: DevinHooksFile,
): boolean {
  for (const event of DEVIN_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(file[event])
      ? (file[event] as DevinMatcherGroup[])
      : [];
    for (const g of groups) {
      if (!g || typeof g !== "object" || Array.isArray(g)) continue;
      const handlers: DevinHookHandler[] = [];
      if (isAutopilotCommand(g.command)) {
        handlers.push(g as DevinHookHandler);
      }
      if (Array.isArray(g.hooks)) handlers.push(...g.hooks);
      for (const h of handlers) {
        if (!h || typeof h !== "object" || Array.isArray(h)) continue;
        if (!isAutopilotCommand(h?.command)) continue;
        if (h.timeout == null) return true;
        if (
          typeof h.timeout === "number" &&
          Number.isFinite(h.timeout) &&
          h.timeout < DEVIN_HOOK_TIMEOUT_SEC
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** True when every Autopilot command embeds `$DEVIN_PROJECT_DIR`. */
export function devinHooksUseProjectDirEnv(file: DevinHooksFile): boolean {
  let seen = 0;
  for (const event of DEVIN_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(file[event])
      ? (file[event] as DevinMatcherGroup[])
      : [];
    for (const g of groups) {
      if (!g || typeof g !== "object" || Array.isArray(g)) continue;
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
        if (!cmd.includes("$DEVIN_PROJECT_DIR")) return false;
      }
    }
  }
  return seen > 0;
}

/**
 * Best-effort: Autopilot under `.devin/config.json` nested `hooks`.
 * Autopilot never writes this file; doctor WARNs only.
 */
export function devinConfigJsonContainsAutopilot(settings: unknown): boolean {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return false;
  }
  const o = settings as Record<string, unknown>;
  if (o.hooks == null) return false;
  return nestedHasAutopilot(o.hooks);
}
