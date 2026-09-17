/**
 * Merge Autopilot hooks into Antigravity project `.agents/hooks.json`.
 * Named top-level block (`autopilot-harness`); preserves foreign named blocks.
 * PreInvocation / Stop: flat handler arrays. PostToolUse: matcher groups.
 * Always writes timeout: 120. Commands call `.agents/bin/` shim (cwd-agnostic
 * via import.meta.url → `../../.autopilot/bin/…`); never bare `../.autopilot`.
 */
import {
  ANTIGRAVITY_HOOK_BLOCK_NAME as PORT_BLOCK_NAME,
  ANTIGRAVITY_POST_TOOL_MATCHER as PORT_POST_TOOL_MATCHER,
  ANTIGRAVITY_TIMEOUT_SEC as PORT_TIMEOUT_SEC,
} from "@autopilot-harness/port-antigravity";
import {
  HOOK_PLATFORM_ANTIGRAVITY,
  commandHasPlatformStamp,
  isAutopilotCommand,
} from "./hooks-merge.js";

/** Events Autopilot registers under the Antigravity named block. */
export const ANTIGRAVITY_AUTOPILOT_EVENTS = [
  "PreInvocation",
  "PostToolUse",
  "Stop",
] as const;

export type AntigravityAutopilotEvent =
  (typeof ANTIGRAVITY_AUTOPILOT_EVENTS)[number];

/** Keep in sync with port-antigravity. */
export const ANTIGRAVITY_HOOK_BLOCK_NAME = PORT_BLOCK_NAME;

/** PostToolUse matcher (keep in sync with port-antigravity). */
export const ANTIGRAVITY_POST_TOOL_USE_MATCHER = PORT_POST_TOOL_MATCHER;

/** Confirm-chain budget; host default timeout is 30 without this. */
export const ANTIGRAVITY_HOOK_TIMEOUT_SEC = PORT_TIMEOUT_SEC;

export const ANTIGRAVITY_HOOKS_REL_PATH = [".agents", "hooks.json"].join("/");

/** Installed shim path (relative to project root). */
export const ANTIGRAVITY_HOOK_SHIM_REL_PATH = [
  ".agents",
  "bin",
  "autopilot-harness-hook.mjs",
].join("/");

/** Canonical hooks.json command prefix (shim entry). */
export const ANTIGRAVITY_HOOK_SHIM_COMMAND_PREFIX = `node ${ANTIGRAVITY_HOOK_SHIM_REL_PATH}`;

/** Legacy 0.10.0 command prefix (rewrite on init/upgrade). */
export const ANTIGRAVITY_HOOK_LEGACY_COMMAND_PREFIX =
  "node .autopilot/bin/autopilot-harness-hook.mjs";

/** Never write this legacy skills/hooks path (research lock). */
export const ANTIGRAVITY_LEGACY_AGENT_DIR = ".agent";

export interface AntigravityHookHandler {
  type?: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface AntigravityMatcherGroup {
  matcher?: string;
  hooks?: AntigravityHookHandler[];
  /** Flat handler shape (PreInvocation / Stop); still scrubbed if Autopilot. */
  type?: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

/** One named hook block (Autopilot or foreign). */
export interface AntigravityHookBlock {
  enabled?: boolean;
  PreInvocation?: AntigravityMatcherGroup[];
  PostToolUse?: AntigravityMatcherGroup[];
  Stop?: AntigravityMatcherGroup[];
  [key: string]: AntigravityMatcherGroup[] | boolean | unknown;
}

/** Top-level named-block map (`.agents/hooks.json`). */
export interface AntigravityHooksFile {
  [blockName: string]: AntigravityHookBlock | unknown;
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

/** True when command uses the `.agents/bin/` shim entry. */
export function isAntigravityShimHookCommand(
  cmd: string | undefined,
): boolean {
  return (
    typeof cmd === "string" && cmd.includes(ANTIGRAVITY_HOOK_SHIM_COMMAND_PREFIX)
  );
}

/**
 * True when command uses legacy project-root-relative `.autopilot/bin/…`
 * (not abs / `$ENV` / bare `../.autopilot`).
 */
export function isAntigravityLegacyRelativeHookCommand(
  cmd: string | undefined,
): boolean {
  return (
    typeof cmd === "string" &&
    cmd.includes(ANTIGRAVITY_HOOK_LEGACY_COMMAND_PREFIX)
  );
}

/**
 * Relative Autopilot command via `.agents/bin/` shim (real hook resolved by
 * shim file path — not host cwd).
 */
export function autopilotAntigravityHookCommandLine(event: string): string {
  if (typeof event !== "string") {
    throw new Error("autopilotAntigravityHookCommandLine: invalid event");
  }
  const safeEvent = event.replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 64);
  if (!safeEvent || safeEvent !== event) {
    throw new Error("autopilotAntigravityHookCommandLine: invalid event");
  }
  return `${ANTIGRAVITY_HOOK_SHIM_COMMAND_PREFIX} --platform ${HOOK_PLATFORM_ANTIGRAVITY} --event ${safeEvent}`;
}

/** Flat handler for PreInvocation / Stop (timeout 120). */
export function autopilotAntigravityHookHandler(
  event: AntigravityAutopilotEvent,
): AntigravityHookHandler {
  return {
    type: "command",
    command: autopilotAntigravityHookCommandLine(event),
    timeout: ANTIGRAVITY_HOOK_TIMEOUT_SEC,
  };
}

/**
 * Install payload for one event: PostToolUse = matcher group;
 * PreInvocation / Stop = flat handlers.
 */
export function autopilotAntigravityEventEntries(
  event: AntigravityAutopilotEvent,
): AntigravityMatcherGroup[] {
  const handler = autopilotAntigravityHookHandler(event);
  if (event === "PostToolUse") {
    return [
      {
        matcher: ANTIGRAVITY_POST_TOOL_USE_MATCHER,
        hooks: [handler],
      },
    ];
  }
  return [handler];
}

function isLikelyAutopilotHookCommandLine(cmd: string): boolean {
  if (!isAutopilotCommand(cmd)) return false;
  return /\bnode(?:js)?\b/i.test(cmd);
}

const AUTOPILOT_FINGERPRINT_MAX_DEPTH = 16;

function nestedValueHasAutopilot(value: unknown, depth = 0): boolean {
  if (depth > AUTOPILOT_FINGERPRINT_MAX_DEPTH) return false;
  if (typeof value === "string") return isLikelyAutopilotHookCommandLine(value);
  if (Array.isArray(value)) {
    return value.some((item) => nestedValueHasAutopilot(item, depth + 1));
  }
  if (!value || typeof value !== "object") return false;
  const o = value as AntigravityMatcherGroup;
  if (isAutopilotCommand(o.command)) return true;
  if (Array.isArray(o.hooks)) {
    if (o.hooks.some((h) => nestedValueHasAutopilot(h, depth + 1))) {
      return true;
    }
  } else if (o.hooks != null) {
    // Malformed `hooks` object (not an array) — still fingerprint.
    if (nestedValueHasAutopilot(o.hooks, depth + 1)) return true;
  }
  // Named blocks nest event arrays under PreInvocation / PostToolUse / Stop / …
  for (const [k, v] of Object.entries(o)) {
    if (k === "command" || k === "hooks" || k === "enabled") continue;
    if (isUnsafeKey(k)) continue;
    if (nestedValueHasAutopilot(v, depth + 1)) return true;
  }
  return false;
}

function stripAutopilotFromEntries(
  entries: AntigravityMatcherGroup[],
): AntigravityMatcherGroup[] {
  const out: AntigravityMatcherGroup[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    if (isAutopilotCommand(raw.command) && !Array.isArray(raw.hooks)) {
      // Flat Autopilot handler — drop.
      continue;
    }
    if (Array.isArray(raw.hooks)) {
      const keptHooks = raw.hooks.filter((h) => !isAutopilotCommand(h?.command));
      if (keptHooks.length === 0 && isAutopilotCommand(raw.command)) {
        continue;
      }
      if (keptHooks.length === 0 && !raw.command) {
        // Matcher group whose only Autopilot handlers were stripped.
        const hadOnlyAutopilot =
          raw.hooks.length > 0 &&
          raw.hooks.every((h) => isAutopilotCommand(h?.command));
        if (hadOnlyAutopilot) continue;
      }
      const next: AntigravityMatcherGroup = { ...raw, hooks: keptHooks };
      if (isAutopilotCommand(next.command)) {
        delete next.command;
        delete next.type;
        delete next.timeout;
      }
      if (
        (!Array.isArray(next.hooks) || next.hooks.length === 0) &&
        !next.command
      ) {
        continue;
      }
      // Malformed nest still fingerprinting Autopilot — drop (fail closed).
      if (nestedValueHasAutopilot(next)) continue;
      out.push(next);
      continue;
    }
    // Non-array hooks / opaque Autopilot nest — do not preserve.
    if (nestedValueHasAutopilot(raw)) continue;
    out.push(raw);
  }
  return out;
}

/**
 * Shape check for `.agents/hooks.json`. Autopilot block must use event arrays;
 * foreign blocks are preserved as opaque objects when merge-safe.
 */
export function validateAntigravityHooksShape(
  file: AntigravityHooksFile | null,
): string | null {
  if (file == null) return null;
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return ".agents/hooks.json must be a JSON object of named hook blocks.";
  }
  for (const [name, value] of Object.entries(file)) {
    if (isUnsafeKey(name)) {
      return `.agents/hooks.json has unsafe key "${safeKeyLabel(name)}".`;
    }
    if (value == null) continue;
    if (typeof value !== "object" || Array.isArray(value)) {
      return `.agents/hooks.json block "${safeKeyLabel(name)}" must be an object.`;
    }
    const block = value as AntigravityHookBlock;
    if (name === ANTIGRAVITY_HOOK_BLOCK_NAME) {
      for (const [ek, ev] of Object.entries(block)) {
        if (isUnsafeKey(ek)) {
          return `.agents/hooks.json Autopilot block has unsafe key "${safeKeyLabel(ek)}".`;
        }
        if (ek === "enabled") {
          if (ev != null && typeof ev !== "boolean") {
            return `.agents/hooks.json Autopilot block "enabled" must be a boolean.`;
          }
          continue;
        }
        if (ev == null) continue;
        if (typeof ev === "boolean") continue;
        if (!Array.isArray(ev)) {
          return `.agents/hooks.json Autopilot block.${safeKeyLabel(ek)} must be an array.`;
        }
        for (const entry of ev) {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return `.agents/hooks.json Autopilot block.${safeKeyLabel(ek)} contains a non-object entry.`;
          }
          const e = entry as AntigravityMatcherGroup;
          if (e.command != null && typeof e.command !== "string") {
            return `.agents/hooks.json Autopilot block.${safeKeyLabel(ek)} has a non-string command.`;
          }
          if (e.hooks != null && !Array.isArray(e.hooks)) {
            return `.agents/hooks.json Autopilot block.${safeKeyLabel(ek)} hooks must be an array.`;
          }
        }
      }
    }
  }
  return null;
}

function cloneFile(existing: AntigravityHooksFile | null): AntigravityHooksFile {
  const base: AntigravityHooksFile = Object.create(null);
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return base;
  }
  for (const [key, value] of Object.entries(existing)) {
    if (isUnsafeKey(key)) continue;
    base[key] = value;
  }
  return base;
}

function getOrCreateAutopilotBlock(
  file: AntigravityHooksFile,
): AntigravityHookBlock {
  const raw = file[ANTIGRAVITY_HOOK_BLOCK_NAME];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const block: AntigravityHookBlock = Object.create(null);
    for (const [k, v] of Object.entries(raw as AntigravityHookBlock)) {
      if (isUnsafeKey(k)) continue;
      block[k] = v;
    }
    return block;
  }
  return Object.create(null) as AntigravityHookBlock;
}

/**
 * Merge Autopilot named block into `.agents/hooks.json`.
 * Scrubs Autopilot from every named block first (avoids double-fire under a
 * wrong block name), then installs the canonical `autopilot-harness` block.
 * Preserves foreign handlers; forces `enabled: true` on the Autopilot block.
 */
export function mergeAntigravityHooks(
  existing: AntigravityHooksFile | null,
): AntigravityHooksFile {
  const shapeError = validateAntigravityHooksShape(existing);
  if (shapeError) {
    throw new Error(shapeError);
  }

  // Scrub Autopilot fingerprints from all blocks (incl. misnamed hand-edits)
  // before writing the canonical Autopilot block — mirrors Factory's
  // strip-then-append on every top-level event key.
  const empty: AntigravityHooksFile = Object.create(null);
  const base = stripAutopilotAntigravityHooks(existing ?? empty);
  const block = getOrCreateAutopilotBlock(base);
  // Ensure the Autopilot block is active after install/upgrade.
  block.enabled = true;

  for (const event of ANTIGRAVITY_AUTOPILOT_EVENTS) {
    const current = Array.isArray(block[event])
      ? [...(block[event] as AntigravityMatcherGroup[])]
      : [];
    const stripped = stripAutopilotFromEntries(current);
    stripped.push(...autopilotAntigravityEventEntries(event));
    block[event] = stripped;
  }

  base[ANTIGRAVITY_HOOK_BLOCK_NAME] = block;
  return base;
}

/**
 * Remove Autopilot handlers from every named block; delete the Autopilot block
 * when it has nothing left. Empty foreign shells (no enabled / no events) are
 * removed; enabled-only foreign blocks are kept.
 * Does not delete the file — caller unlinks when {@link antigravityHooksFileIsVacant}.
 */
export function stripAutopilotAntigravityHooks(
  existing: AntigravityHooksFile,
): AntigravityHooksFile {
  const shapeError = validateAntigravityHooksShape(existing);
  if (shapeError) {
    throw new Error(shapeError);
  }

  const base = cloneFile(existing);

  for (const [name, raw] of Object.entries(base)) {
    if (isUnsafeKey(name)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const block: AntigravityHookBlock = Object.create(null);
    for (const [k, v] of Object.entries(raw as AntigravityHookBlock)) {
      if (isUnsafeKey(k)) continue;
      block[k] = v;
    }

    for (const [ek, ev] of Object.entries(block)) {
      if (ek === "enabled" || isUnsafeKey(ek)) continue;
      if (Array.isArray(ev)) {
        const kept = stripAutopilotFromEntries(ev as AntigravityMatcherGroup[]);
        if (kept.length === 0) {
          delete block[ek];
        } else {
          block[ek] = kept;
        }
        continue;
      }
      // Foreign / malformed non-array event value carrying Autopilot — drop
      // (array-shaped Autopilot is handled above; do not leave fingerprint).
      if (nestedValueHasAutopilot(ev)) {
        delete block[ek];
      }
    }

    if (name === ANTIGRAVITY_HOOK_BLOCK_NAME) {
      const remainingKeys = Object.keys(block).filter((k) => {
        if (k === "enabled") return false;
        const v = block[k];
        if (v == null) return false;
        if (Array.isArray(v) && v.length === 0) return false;
        return true;
      });
      if (remainingKeys.length === 0) {
        delete base[name];
      } else {
        base[name] = block;
      }
    } else {
      // Drop empty foreign shells after scrubbing Autopilot-only leftovers
      // (keeps enabled-only / non-empty foreign blocks).
      const remainingKeys = Object.keys(block).filter((k) => {
        if (k === "enabled") return true;
        const v = block[k];
        if (v == null) return false;
        if (Array.isArray(v) && v.length === 0) return false;
        return true;
      });
      if (remainingKeys.length === 0) {
        delete base[name];
      } else {
        base[name] = block;
      }
    }
  }

  return base;
}

/**
 * True when strip left nothing worth keeping — uninstall should unlink the file.
 * Foreign named blocks (even `enabled`-only) keep the file; only an empty
 * Autopilot block (or missing file) counts as vacant.
 */
export function antigravityHooksFileIsVacant(
  file: AntigravityHooksFile | null,
): boolean {
  if (!file || typeof file !== "object" || Array.isArray(file)) return true;
  for (const [key, value] of Object.entries(file)) {
    if (isUnsafeKey(key)) continue;
    if (value == null) continue;
    if (
      key === ANTIGRAVITY_HOOK_BLOCK_NAME &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const block = value as AntigravityHookBlock;
      for (const [ek, ev] of Object.entries(block)) {
        if (isUnsafeKey(ek) || ek === "enabled") continue;
        if (ev == null) continue;
        if (Array.isArray(ev) && ev.length === 0) continue;
        return false;
      }
      continue;
    }
    // Any foreign block / non-object leftover keeps the file.
    return false;
  }
  return true;
}

export function antigravityHooksContainAutopilot(
  file: AntigravityHooksFile | null,
): boolean {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return false;
  }
  for (const [name, value] of Object.entries(file)) {
    if (isUnsafeKey(name)) continue;
    if (nestedValueHasAutopilot(value)) return true;
  }
  return false;
}

export function summarizeAntigravityAutopilotHooks(
  file: AntigravityHooksFile,
): { missingEvents: string[]; duplicates: number } {
  const missingEvents: string[] = [];
  let duplicates = 0;
  const raw = file[ANTIGRAVITY_HOOK_BLOCK_NAME];
  const block =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as AntigravityHookBlock)
      : null;

  for (const event of ANTIGRAVITY_AUTOPILOT_EVENTS) {
    const entries = block && Array.isArray(block[event])
      ? (block[event] as AntigravityMatcherGroup[])
      : [];
    let n = 0;
    for (const g of entries) {
      if (isAutopilotCommand(g.command)) n += 1;
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      n += hooks.filter((h) => isAutopilotCommand(h?.command)).length;
    }
    if (n === 0) missingEvents.push(event);
    if (n > 1) duplicates += n - 1;
  }
  return { missingEvents, duplicates };
}

export function hasCompleteAntigravityAutopilotHooks(
  file: AntigravityHooksFile,
): boolean {
  const { missingEvents, duplicates } = summarizeAntigravityAutopilotHooks(file);
  if (missingEvents.length > 0 || duplicates > 0) return false;
  const raw = file[ANTIGRAVITY_HOOK_BLOCK_NAME];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const block = raw as AntigravityHookBlock;
  // enabled:false would silently disable Autopilot — treat as incomplete.
  if (block.enabled === false) return false;
  // Wrong-platform leftovers / PostToolUse matcher drift are residual.
  if (!antigravityHooksHavePlatformStamp(file)) return false;
  if (!antigravityAutopilotHasExpectedPostMatcher(file)) return false;
  return true;
}

/**
 * True when every Autopilot PostToolUse entry uses the expected edit-tool matcher.
 * Flat Autopilot handlers under PostToolUse (no matcher) count as incomplete.
 */
export function antigravityAutopilotHasExpectedPostMatcher(
  file: AntigravityHooksFile,
): boolean {
  const raw = file[ANTIGRAVITY_HOOK_BLOCK_NAME];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const block = raw as AntigravityHookBlock;
  const entries = Array.isArray(block.PostToolUse)
    ? (block.PostToolUse as AntigravityMatcherGroup[])
    : [];
  let seen = 0;
  for (const g of entries) {
    const hasAutopilot =
      isAutopilotCommand(g.command) ||
      (Array.isArray(g.hooks) &&
        g.hooks.some((h) => isAutopilotCommand(h?.command)));
    if (!hasAutopilot) continue;
    seen += 1;
    if (g.matcher !== ANTIGRAVITY_POST_TOOL_USE_MATCHER) return false;
  }
  return seen > 0;
}

/** True when every Autopilot Antigravity command stamps `--platform antigravity`. */
export function antigravityHooksHavePlatformStamp(
  file: AntigravityHooksFile,
): boolean {
  let seen = 0;
  const raw = file[ANTIGRAVITY_HOOK_BLOCK_NAME];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const block = raw as AntigravityHookBlock;
  for (const event of ANTIGRAVITY_AUTOPILOT_EVENTS) {
    const entries = Array.isArray(block[event])
      ? (block[event] as AntigravityMatcherGroup[])
      : [];
    for (const g of entries) {
      if (isAutopilotCommand(g.command)) {
        seen += 1;
        if (
          !commandHasPlatformStamp(g.command, HOOK_PLATFORM_ANTIGRAVITY)
        ) {
          return false;
        }
      }
      const hooks = Array.isArray(g.hooks) ? g.hooks : [];
      for (const h of hooks) {
        if (!isAutopilotCommand(h?.command)) continue;
        seen += 1;
        if (
          !commandHasPlatformStamp(h.command, HOOK_PLATFORM_ANTIGRAVITY)
        ) {
          return false;
        }
      }
    }
  }
  return seen > 0;
}

/** True when any Autopilot Antigravity handler omits timeout or sets timeout &lt; 120. */
export function antigravityAutopilotHasOmittedOrSmallTimeout(
  file: AntigravityHooksFile,
): boolean {
  const raw = file[ANTIGRAVITY_HOOK_BLOCK_NAME];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const block = raw as AntigravityHookBlock;
  for (const event of ANTIGRAVITY_AUTOPILOT_EVENTS) {
    const entries = Array.isArray(block[event])
      ? (block[event] as AntigravityMatcherGroup[])
      : [];
    for (const g of entries) {
      const handlers: AntigravityHookHandler[] = [];
      if (isAutopilotCommand(g.command)) {
        handlers.push(g as AntigravityHookHandler);
      }
      if (Array.isArray(g.hooks)) handlers.push(...g.hooks);
      for (const h of handlers) {
        if (!isAutopilotCommand(h?.command)) continue;
        if (h.timeout == null) return true;
        if (
          typeof h.timeout === "number" &&
          Number.isFinite(h.timeout) &&
          h.timeout < ANTIGRAVITY_HOOK_TIMEOUT_SEC
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** True when every Autopilot command uses shim or legacy relative entry. */
export function antigravityHooksUseRelativeCommand(
  file: AntigravityHooksFile,
): boolean {
  let seen = 0;
  const raw = file[ANTIGRAVITY_HOOK_BLOCK_NAME];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const block = raw as AntigravityHookBlock;
  for (const event of ANTIGRAVITY_AUTOPILOT_EVENTS) {
    const entries = Array.isArray(block[event])
      ? (block[event] as AntigravityMatcherGroup[])
      : [];
    for (const g of entries) {
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
        // Reject bare ../.autopilot (CLI/IDE cwd split — not supported).
        if (/(^|[\s"'=])\.\.\/\.autopilot\b/.test(cmd)) return false;
        if (
          !isAntigravityShimHookCommand(cmd) &&
          !isAntigravityLegacyRelativeHookCommand(cmd)
        ) {
          return false;
        }
      }
    }
  }
  return seen > 0;
}

/** True when every Autopilot command already uses the `.agents/bin/` shim. */
export function antigravityHooksUseShimCommand(
  file: AntigravityHooksFile,
): boolean {
  let seen = 0;
  const raw = file[ANTIGRAVITY_HOOK_BLOCK_NAME];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const block = raw as AntigravityHookBlock;
  for (const event of ANTIGRAVITY_AUTOPILOT_EVENTS) {
    const entries = Array.isArray(block[event])
      ? (block[event] as AntigravityMatcherGroup[])
      : [];
    for (const g of entries) {
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
        if (!isAntigravityShimHookCommand(cmd)) return false;
      }
    }
  }
  return seen > 0;
}
