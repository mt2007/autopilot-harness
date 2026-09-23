/**
 * Merge Autopilot hooks into Codex project `.codex/hooks.json`.
 * Preserves foreign hooks; replaces Autopilot-marked command entries only.
 * Does **not** write `config.toml` hooks (prefer hooks.json per Codex docs).
 */
import {
  HOOK_PLATFORM_CODEX,
  autopilotHookCommandLine,
  commandHasPlatformStamp,
  isAutopilotCommand,
} from "./hooks-merge.js";

/** Events Autopilot registers under Codex hooks (no StopFailure). */
export const CODEX_AUTOPILOT_EVENTS = [
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
] as const;

export type CodexAutopilotEvent = (typeof CODEX_AUTOPILOT_EVENTS)[number];

/**
 * PostToolUse matcher: `apply_patch` / `Edit` / `Write` plus `exec` / `js`
 * (hosts may wrap Begin Patch inside those generic tools).
 */
export const CODEX_POST_TOOL_USE_MATCHER = "apply_patch|Edit|Write|exec|js";

export interface CodexHookHandler {
  type?: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface CodexMatcherGroup {
  matcher?: string;
  hooks?: CodexHookHandler[];
  /** Legacy flat handler shape (not Codex canonical); still scrubbed if Autopilot. */
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface CodexHooksFile {
  description?: string;
  hooks?: Record<string, CodexMatcherGroup[] | unknown>;
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

/** Build the Autopilot command handler for a Codex hook event (no timeout). */
export function autopilotCodexHookHandler(
  event: CodexAutopilotEvent,
): CodexHookHandler {
  // Omit timeout → Codex default 600s (≥120s confirm-chain budget).
  return {
    type: "command",
    command: autopilotHookCommandLine(HOOK_PLATFORM_CODEX, event),
  };
}

/** Matcher group Autopilot installs for one Codex event. */
export function autopilotCodexMatcherGroup(
  event: CodexAutopilotEvent,
): CodexMatcherGroup {
  const handler = autopilotCodexHookHandler(event);
  if (event === "PostToolUse") {
    return {
      matcher: CODEX_POST_TOOL_USE_MATCHER,
      hooks: [handler],
    };
  }
  // UserPromptSubmit / Stop: matcher ignored by Codex; omit for clarity.
  return { hooks: [handler] };
}

/**
 * Ensure hooks.json shape is merge-safe; otherwise refuse (do not wipe).
 */
export function validateCodexHooksShape(file: CodexHooksFile): string | null {
  for (const key of Object.keys(file)) {
    if (isUnsafeKey(key)) {
      return `hooks.json key "${safeKeyLabel(key)}" is not allowed.`;
    }
  }
  if (file.hooks == null) return null;
  if (
    typeof file.hooks !== "object" ||
    Array.isArray(file.hooks) ||
    file.hooks === null
  ) {
    return 'hooks.json "hooks" must be an object.';
  }
  for (const [key, value] of Object.entries(file.hooks)) {
    const label = safeKeyLabel(key);
    if (isUnsafeKey(key)) {
      return `hooks.json hooks key "${label}" is not allowed.`;
    }
    if (value == null) continue;
    if (!Array.isArray(value)) {
      return `hooks.json hooks.${label} must be an array of matcher groups.`;
    }
    for (const group of value) {
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        return `hooks.json hooks.${label} contains a non-object matcher group.`;
      }
      const g = group as CodexMatcherGroup;
      if (g.matcher != null && typeof g.matcher !== "string") {
        return `hooks.json hooks.${label} has a non-string matcher.`;
      }
      if (g.command != null && typeof g.command !== "string") {
        return `hooks.json hooks.${label} has a non-string command.`;
      }
      if (
        g.timeout != null &&
        (typeof g.timeout !== "number" || !Number.isFinite(g.timeout))
      ) {
        return `hooks.json hooks.${label} has a non-finite timeout.`;
      }
      if (g.hooks == null) continue;
      if (!Array.isArray(g.hooks)) {
        return `hooks.json hooks.${label} matcher group hooks must be an array.`;
      }
      for (const h of g.hooks) {
        if (!h || typeof h !== "object" || Array.isArray(h)) {
          return `hooks.json hooks.${label} contains a non-object hook handler.`;
        }
        if (h.command != null && typeof h.command !== "string") {
          return `hooks.json hooks.${label} has a non-string command.`;
        }
        if (h.type != null && typeof h.type !== "string") {
          return `hooks.json hooks.${label} has a non-string type.`;
        }
        if (
          h.timeout != null &&
          (typeof h.timeout !== "number" || !Number.isFinite(h.timeout))
        ) {
          return `hooks.json hooks.${label} has a non-finite timeout.`;
        }
      }
    }
  }
  return null;
}

function copyGroupMeta(
  group: CodexMatcherGroup,
  omit: ReadonlySet<string>,
): CodexMatcherGroup {
  const meta: CodexMatcherGroup = {};
  for (const [key, value] of Object.entries(group)) {
    if (omit.has(key) || isUnsafeKey(key)) continue;
    meta[key] = value;
  }
  return meta;
}

/** Keys dropped when scrubbing an Autopilot top-level / empty shell. */
const OMIT_AUTOPILOT_SHELL: ReadonlySet<string> = new Set([
  "command",
  "timeout",
  "hooks",
  // Autopilot handlers always set type:"command" — not foreign meta.
  "type",
]);

/** Omit nested hooks when flattening a foreign top-level command group. */
const OMIT_HOOKS_ONLY: ReadonlySet<string> = new Set(["hooks"]);

/** No keys omitted — still skips unsafe keys via copyGroupMeta. */
const OMIT_NONE: ReadonlySet<string> = new Set();

function stripAutopilotFromGroups(
  groups: CodexMatcherGroup[],
): CodexMatcherGroup[] {
  const out: CodexMatcherGroup[] = [];
  for (const group of groups) {
    if (!Array.isArray(group.hooks)) {
      // Meta-only or legacy flat `{ command }` — drop Autopilot top-level commands
      // so force refresh cannot stack a second Autopilot matcher group beside them.
      // Preserve non-command meta (e.g. matcher) the same way as empty-hooks groups.
      if (isAutopilotCommand(group.command)) {
        const meta = copyGroupMeta(group, OMIT_AUTOPILOT_SHELL);
        if (Object.keys(meta).length > 0) {
          out.push(meta);
        }
        continue;
      }
      out.push(copyGroupMeta(group, OMIT_NONE));
      continue;
    }
    const kept = group.hooks.filter((h) => !isAutopilotCommand(h?.command));
    const next: CodexMatcherGroup = { ...group, hooks: kept };
    // Nested groups may also carry a legacy top-level command — scrub Autopilot there too.
    const hadTopAutopilot = isAutopilotCommand(group.command);
    if (hadTopAutopilot) {
      delete next.command;
      // Group-level timeout/type belonged to the Autopilot top-level handler; do not
      // leave them on remaining foreign nested hooks after scrub.
      delete next.timeout;
      delete next.type;
    }
    if (kept.length === 0) {
      if (group.hooks.length === 0) {
        if (hadTopAutopilot) {
          // Scrub Autopilot top-level; keep remaining matcher/meta as an empty
          // foreign group. Pure Autopilot shells (no meta) are dropped.
          const meta = copyGroupMeta(next, OMIT_AUTOPILOT_SHELL);
          if (Object.keys(meta).length > 0) {
            out.push({ ...meta, hooks: [] });
          }
          continue;
        }
        // Intentionally empty foreign group — keep matcher/meta (skip unsafe keys).
        out.push({ ...copyGroupMeta(next, OMIT_HOOKS_ONLY), hooks: [] });
        continue;
      }
      if (typeof next.command === "string" && next.command.trim() !== "") {
        // Nested Autopilot handlers removed; preserve foreign top-level command as flat.
        out.push(copyGroupMeta(next, OMIT_HOOKS_ONLY));
        continue;
      }
      // Nested Autopilot-only (or whitespace-only top command) — keep matcher/meta.
      // Drop timeout with the non-command top shell (same as Autopilot scrub).
      const meta = copyGroupMeta(next, OMIT_AUTOPILOT_SHELL);
      if (Object.keys(meta).length > 0) {
        out.push({ ...meta, hooks: [] });
        continue;
      }
      continue;
    }
    out.push({ ...copyGroupMeta(next, OMIT_HOOKS_ONLY), hooks: kept });
  }
  return out;
}

/**
 * Merge Autopilot Codex hooks into existing or empty hooks.json.
 * Never sets timeout (Codex default 600s). Never touches config.toml.
 */
export function mergeCodexHooks(existing: CodexHooksFile | null): CodexHooksFile {
  const base: CodexHooksFile = {};
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const shapeError = validateCodexHooksShape(existing);
    if (shapeError) {
      throw new Error(shapeError);
    }
    for (const [key, value] of Object.entries(existing)) {
      if (isUnsafeKey(key)) continue;
      base[key] = value;
    }
  } else {
    const shapeError = validateCodexHooksShape(base);
    if (shapeError) {
      throw new Error(shapeError);
    }
  }

  const nextHooks: Record<string, CodexMatcherGroup[]> = Object.create(null);
  if (base.hooks && typeof base.hooks === "object" && !Array.isArray(base.hooks)) {
    for (const [key, value] of Object.entries(base.hooks)) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(value)) continue;
      nextHooks[key] = stripAutopilotFromGroups(value as CodexMatcherGroup[]);
    }
  }

  for (const event of CODEX_AUTOPILOT_EVENTS) {
    const current = Array.isArray(nextHooks[event])
      ? [...nextHooks[event]!]
      : [];
    const stripped = stripAutopilotFromGroups(current);
    stripped.push(autopilotCodexMatcherGroup(event));
    nextHooks[event] = stripped;
  }

  base.hooks = nextHooks;
  return base;
}

/**
 * Remove Autopilot Codex hook handlers; keep foreign hooks.
 * Does not delete hooks.json — caller decides write/unlink.
 */
export function stripAutopilotCodexHooks(
  existing: CodexHooksFile,
): CodexHooksFile {
  const shapeError = validateCodexHooksShape(existing);
  if (shapeError) {
    throw new Error(shapeError);
  }

  const base: CodexHooksFile = {};
  for (const [key, value] of Object.entries(existing)) {
    if (isUnsafeKey(key)) continue;
    base[key] = value;
  }

  const prevHooks = base.hooks;
  if (prevHooks && typeof prevHooks === "object" && !Array.isArray(prevHooks)) {
    const nextHooks: Record<string, CodexMatcherGroup[]> = Object.create(null);
    for (const [key, value] of Object.entries(prevHooks)) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(value)) continue;
      const kept = stripAutopilotFromGroups(value as CodexMatcherGroup[]);
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

export function codexHooksContainAutopilot(
  file: CodexHooksFile | null,
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
    for (const g of value as CodexMatcherGroup[]) {
      if (isAutopilotCommand(g?.command)) return true;
      const hooks = Array.isArray(g?.hooks) ? g.hooks : [];
      if (hooks.some((h) => isAutopilotCommand(h?.command))) return true;
    }
  }
  return false;
}

export function summarizeCodexAutopilotHooks(file: CodexHooksFile): {
  missingEvents: string[];
  duplicates: number;
} {
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  const missingEvents: string[] = [];
  let duplicates = 0;
  for (const event of CODEX_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(bag[event])
      ? (bag[event] as CodexMatcherGroup[])
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

export function hasCompleteCodexAutopilotHooks(file: CodexHooksFile): boolean {
  const { missingEvents, duplicates } = summarizeCodexAutopilotHooks(file);
  return missingEvents.length === 0 && duplicates === 0;
}

/**
 * True when every Autopilot Codex command stamps `--platform codex`.
 * Incomplete installs return false.
 */
export function codexHooksHavePlatformStamp(file: CodexHooksFile): boolean {
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  let seen = 0;
  for (const event of CODEX_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(bag[event])
      ? (bag[event] as CodexMatcherGroup[])
      : [];
    for (const g of groups) {
      if (isAutopilotCommand(g.command)) {
        seen += 1;
        if (!commandHasPlatformStamp(g.command, HOOK_PLATFORM_CODEX)) {
          return false;
        }
      }
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      for (const h of hooks) {
        if (!isAutopilotCommand(h?.command)) continue;
        seen += 1;
        if (!commandHasPlatformStamp(h.command, HOOK_PLATFORM_CODEX)) {
          return false;
        }
      }
    }
  }
  return seen > 0;
}

/**
 * True when any Autopilot Codex handler sets an explicit timeout &lt; 120s
 * (doctor WARN). Omitted timeout is OK (Codex default 600).
 */
export function codexAutopilotHasSmallTimeout(file: CodexHooksFile): boolean {
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  for (const event of CODEX_AUTOPILOT_EVENTS) {
    const groups = Array.isArray(bag[event])
      ? (bag[event] as CodexMatcherGroup[])
      : [];
    for (const g of groups) {
      const handlers: CodexHookHandler[] = [];
      if (isAutopilotCommand(g.command)) {
        handlers.push(g as CodexHookHandler);
      }
      if (Array.isArray(g.hooks)) handlers.push(...g.hooks);
      for (const h of handlers) {
        if (!isAutopilotCommand(h?.command)) continue;
        if (
          typeof h.timeout === "number" &&
          Number.isFinite(h.timeout) &&
          h.timeout < 120
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * True when an Autopilot Codex PostToolUse group exists but its matcher does
 * not include both `exec` and `js` (pre-0.18.2 installs). Doctor WARNs.
 */
export function codexAutopilotPostToolUseMatcherStale(
  file: CodexHooksFile,
): boolean {
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  const groups = Array.isArray(bag.PostToolUse)
    ? (bag.PostToolUse as CodexMatcherGroup[])
    : [];
  for (const g of groups) {
    const handlers: CodexHookHandler[] = [];
    if (isAutopilotCommand(g.command)) {
      handlers.push(g as CodexHookHandler);
    }
    if (Array.isArray(g.hooks)) handlers.push(...g.hooks);
    const hasAutopilot = handlers.some((h) => isAutopilotCommand(h?.command));
    if (!hasAutopilot) continue;
    const matcher = typeof g.matcher === "string" ? g.matcher : "";
    const parts = matcher
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.includes("exec") || !parts.includes("js")) {
      return true;
    }
  }
  return false;
}
