/**
 * Merge Autopilot shell hooks into Hermes Agent `$HERMES_HOME/config.yaml`.
 * Default home: `$HERMES_HOME` or `~/.hermes`. Never writes `cli-config.yaml`.
 * Raises `agent.max_verify_nudges` to ≥32 when missing/lower; never lowers a
 * higher user value; never writes `hooks_auto_accept` / `verify_guidance`.
 */
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  HERMES_INIT_MAX_VERIFY_NUDGES,
  HERMES_POST_TOOL_MATCHER as PORT_HERMES_POST_TOOL_MATCHER,
} from "@autopilot-harness/port-hermes-agent";
import {
  HOOK_PLATFORM_HERMES_AGENT,
  autopilotHookCommandLine,
  commandHasPlatformStamp,
  isAutopilotCommand,
} from "./hooks-merge.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
} from "../read-untrusted-file.js";

/** Events Autopilot registers under Hermes Agent shell hooks. */
export const HERMES_AUTOPILOT_EVENTS = [
  "pre_llm_call",
  "post_tool_call",
  "pre_verify",
] as const;

export type HermesAutopilotEvent = (typeof HERMES_AUTOPILOT_EVENTS)[number];

const HERMES_EVENT_SET = new Set<string>(HERMES_AUTOPILOT_EVENTS);

/**
 * Reserved non-event subsections under `hooks:` (Hermes shell_hooks.py).
 * Preserve as opaque siblings — never treat as event entry lists.
 */
export const HERMES_HOOKS_RESERVED_KEYS = Object.freeze([
  "output_spill",
  "outbound",
] as const);

const HERMES_RESERVED_SET = new Set<string>(HERMES_HOOKS_RESERVED_KEYS);

/** post_tool_call matcher (keep in sync with port-hermes-agent). */
export const HERMES_POST_TOOL_MATCHER = PORT_HERMES_POST_TOOL_MATCHER;

/** Autopilot shell-hook timeout (Hermes default 60 is too low; host max 300). */
export const HERMES_HOOK_TIMEOUT_SEC = 120;

/** Init floor for `agent.max_verify_nudges` (port constant). */
export const HERMES_MAX_VERIFY_NUDGES = HERMES_INIT_MAX_VERIFY_NUDGES;

export const HERMES_CONFIG_REL_PATH = "config.yaml";

export interface HermesHookEntry {
  command: string;
  timeout?: number;
  matcher?: string;
  fail_closed?: boolean;
  failClosed?: boolean;
  [key: string]: unknown;
}

export type HermesConfigFile = {
  hooks?: Record<string, unknown>;
  agent?: Record<string, unknown> | unknown;
  hooks_auto_accept?: unknown;
  [key: string]: unknown;
};

function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

function safeKeyLabel(key: string): string {
  const cleaned = key
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/ +/g, " ")
    .trim();
  return cleaned || "?";
}

/** Plain object only — Map/Date/etc. would make Object.entries silently empty. */
function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Coerce YAML number or numeric string to a finite int.
 * Non-numeric strings / hostile controls → null (treat as missing).
 */
function coerceFiniteInt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.trunc(raw);
  }
  if (typeof raw === "string") {
    const t = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  }
  return null;
}

/** Resolve Hermes data home (env wins; default `~/.hermes`). */
export function resolveHermesHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.HERMES_HOME;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (cleaned) return path.resolve(cleaned);
  }
  return path.join(os.homedir(), ".hermes");
}

export function hermesConfigYamlPath(
  home: string = resolveHermesHome(),
): string {
  return path.join(home, HERMES_CONFIG_REL_PATH);
}

/** Build one Autopilot Hermes hook entry (relative command; timeout 120). */
export function autopilotHermesHookEntry(
  event: HermesAutopilotEvent,
): HermesHookEntry {
  const entry: HermesHookEntry = {
    command: autopilotHookCommandLine(HOOK_PLATFORM_HERMES_AGENT, event),
    timeout: HERMES_HOOK_TIMEOUT_SEC,
  };
  if (event === "post_tool_call") {
    return { ...entry, matcher: HERMES_POST_TOOL_MATCHER };
  }
  return entry;
}

function entryHasAutopilotCommand(entry: unknown): boolean {
  if (!isPlainObject(entry)) return false;
  const cmd = (entry as HermesHookEntry).command;
  return isAutopilotCommand(typeof cmd === "string" ? cmd : undefined);
}

/** True when command stamps `--event <event>` (token boundary). */
function commandHasEventStamp(cmd: string, event: string): boolean {
  if (typeof cmd !== "string" || !event) return false;
  const needle = `--event ${event}`;
  const re = new RegExp(
    `(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
  );
  return re.test(cmd);
}

/**
 * Autopilot entry under a YAML event key only counts when argv stamps
 * `--platform hermes-agent` and `--event` matches that key (hand-edits can
 * desync list key / platform from command).
 */
function entryAutopilotForEvent(entry: unknown, event: string): boolean {
  if (!entryHasAutopilotCommand(entry)) return false;
  const cmd = (entry as HermesHookEntry).command;
  return (
    typeof cmd === "string" &&
    commandHasPlatformStamp(cmd, HOOK_PLATFORM_HERMES_AGENT) &&
    commandHasEventStamp(cmd, event)
  );
}

function stripAutopilotFromEntries(entries: unknown[]): unknown[] {
  return entries.filter((e) => {
    // Drop null / non-plain slots (validate allows null; do not re-emit them).
    if (!isPlainObject(e)) return false;
    return !entryHasAutopilotCommand(e);
  });
}

/**
 * Validate top-level Hermes config shape for merge safety.
 * `hooks` must be a mapping of event → entry list (reserved keys opaque).
 */
export function validateHermesConfigShape(
  file: HermesConfigFile | null,
): string | null {
  if (file == null) return null;
  if (!isPlainObject(file)) {
    return "Hermes config.yaml root must be a mapping.";
  }
  for (const key of Object.keys(file)) {
    if (isUnsafeKey(key)) {
      return `Hermes config.yaml key "${safeKeyLabel(key)}" is not allowed.`;
    }
  }
  const hooks = file.hooks;
  if (hooks == null) {
    // fall through to agent check
  } else if (!isPlainObject(hooks)) {
    return 'Hermes config.yaml "hooks" must be a mapping of event → list.';
  } else {
    for (const [key, value] of Object.entries(hooks as Record<string, unknown>)) {
      if (isUnsafeKey(key)) {
        return `Hermes hooks key "${safeKeyLabel(key)}" is not allowed.`;
      }
      if (HERMES_RESERVED_SET.has(key)) continue;
      if (value == null) continue;
      if (!Array.isArray(value)) {
        return `Hermes hooks.${safeKeyLabel(key)} must be a list of hook entries.`;
      }
      for (const entry of value) {
        if (entry == null) continue;
        if (!isPlainObject(entry)) {
          return `Hermes hooks.${safeKeyLabel(key)} contains a non-object entry.`;
        }
        for (const ek of Object.keys(entry as object)) {
          if (isUnsafeKey(ek)) {
            return `Hermes hooks.${safeKeyLabel(key)} entry key "${safeKeyLabel(ek)}" is not allowed.`;
          }
        }
        const cmd = (entry as HermesHookEntry).command;
        if (cmd != null && typeof cmd !== "string") {
          return `Hermes hooks.${safeKeyLabel(key)} has a non-string command.`;
        }
        const matcher = (entry as HermesHookEntry).matcher;
        if (matcher != null && typeof matcher !== "string") {
          return `Hermes hooks.${safeKeyLabel(key)} has a non-string matcher.`;
        }
        const timeout = (entry as HermesHookEntry).timeout;
        if (
          timeout != null &&
          typeof timeout !== "number" &&
          typeof timeout !== "string"
        ) {
          return `Hermes hooks.${safeKeyLabel(key)} has a non-number/non-string timeout.`;
        }
        if (typeof timeout === "number" && !Number.isFinite(timeout)) {
          return `Hermes hooks.${safeKeyLabel(key)} has a non-finite timeout.`;
        }
        if (typeof timeout === "string") {
          const trimmed = timeout.replace(/[\u0000-\u001f\u007f]/g, "").trim();
          if (trimmed && coerceFiniteInt(timeout) == null) {
            return `Hermes hooks.${safeKeyLabel(key)} has a non-numeric timeout string.`;
          }
        }
        const failClosed = (entry as HermesHookEntry).fail_closed;
        if (failClosed != null && typeof failClosed !== "boolean") {
          return `Hermes hooks.${safeKeyLabel(key)} has a non-boolean fail_closed.`;
        }
        const failClosedCamel = (entry as HermesHookEntry).failClosed;
        if (failClosedCamel != null && typeof failClosedCamel !== "boolean") {
          return `Hermes hooks.${safeKeyLabel(key)} has a non-boolean failClosed.`;
        }
      }
    }
  }
  if (file.agent != null) {
    if (!isPlainObject(file.agent)) {
      return 'Hermes config.yaml "agent" must be a mapping when present.';
    }
    for (const key of Object.keys(file.agent as object)) {
      if (isUnsafeKey(key)) {
        return `Hermes agent key "${safeKeyLabel(key)}" is not allowed.`;
      }
    }
  }
  return null;
}

/**
 * Raise `agent.max_verify_nudges` to {@link HERMES_MAX_VERIFY_NUDGES} when
 * missing or lower. Never lowers a higher user value. Leaves other agent keys
 * (incl. verify_guidance) untouched.
 */
export function ensureHermesMaxVerifyNudges(
  file: HermesConfigFile,
): HermesConfigFile {
  const out: HermesConfigFile = { ...file };
  const prevAgent =
    out.agent && isPlainObject(out.agent)
      ? { ...(out.agent as Record<string, unknown>) }
      : (Object.create(null) as Record<string, unknown>);
  const raw = prevAgent.max_verify_nudges;
  const n = coerceFiniteInt(raw);
  if (n == null || n < HERMES_MAX_VERIFY_NUDGES) {
    prevAgent.max_verify_nudges = HERMES_MAX_VERIFY_NUDGES;
  } else if (typeof raw !== "number" || !Number.isFinite(raw) || raw !== n) {
    // Normalize numeric strings / floats to a clean int without lowering.
    prevAgent.max_verify_nudges = n;
  }
  out.agent = prevAgent;
  return out;
}

/**
 * Strip Autopilot-fingerprinted hook entries; keep foreign events + reserved
 * subsections. Drops empty non-reserved event lists (empty strip).
 */
export function stripAutopilotHermesHooks(
  existing: HermesConfigFile,
): HermesConfigFile {
  const shapeError = validateHermesConfigShape(existing);
  if (shapeError) {
    throw new Error(shapeError);
  }

  const base: HermesConfigFile = Object.create(null);
  for (const [key, value] of Object.entries(existing)) {
    if (isUnsafeKey(key)) continue;
    base[key] = value;
  }

  const hooksIn = base.hooks;
  if (hooksIn && isPlainObject(hooksIn)) {
    const hooksOut: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(
      hooksIn as Record<string, unknown>,
    )) {
      if (isUnsafeKey(key)) continue;
      if (HERMES_RESERVED_SET.has(key)) {
        hooksOut[key] = value;
        continue;
      }
      // Drop null slots (validate already rejects non-list non-null for
      // non-reserved keys; null is allowed and should not survive as `event: null`).
      // Non-array leftovers are unreachable after validate — drop fail-closed.
      if (value == null) continue;
      if (!Array.isArray(value)) continue;
      const kept = stripAutopilotFromEntries(value);
      if (kept.length === 0) continue;
      hooksOut[key] = kept;
    }
    if (Object.keys(hooksOut).length === 0) {
      delete base.hooks;
    } else {
      base.hooks = hooksOut;
    }
  }

  return base;
}

/**
 * Merge Autopilot Hermes hooks into existing or empty config.
 * Preserves sibling top-level keys; never sets hooks_auto_accept.
 */
export function mergeHermesConfig(
  existing: HermesConfigFile | null,
): HermesConfigFile {
  const base: HermesConfigFile = Object.create(null);
  if (existing && isPlainObject(existing)) {
    const shapeError = validateHermesConfigShape(existing);
    if (shapeError) {
      throw new Error(shapeError);
    }
    for (const [key, value] of Object.entries(existing)) {
      if (isUnsafeKey(key)) continue;
      // Never copy hostile auto-accept into our write path as an Autopilot
      // invent — leave user value if already present; do not invent one.
      base[key] = value;
    }
  } else if (existing != null) {
    throw new Error("Hermes config.yaml root must be a mapping.");
  } else {
    const shapeError = validateHermesConfigShape(base);
    if (shapeError) {
      throw new Error(shapeError);
    }
  }

  const stripped = stripAutopilotHermesHooks(base);
  const hooksIn =
    stripped.hooks && isPlainObject(stripped.hooks)
      ? { ...(stripped.hooks as Record<string, unknown>) }
      : (Object.create(null) as Record<string, unknown>);

  for (const event of HERMES_AUTOPILOT_EVENTS) {
    const current = Array.isArray(hooksIn[event])
      ? [...(hooksIn[event] as unknown[])]
      : [];
    const kept = stripAutopilotFromEntries(current);
    kept.push(autopilotHermesHookEntry(event));
    hooksIn[event] = kept;
  }

  // Drop empty non-reserved foreign leftovers after Autopilot replace.
  for (const [key, value] of Object.entries(hooksIn)) {
    if (HERMES_RESERVED_SET.has(key) || HERMES_EVENT_SET.has(key)) continue;
    if (Array.isArray(value) && value.length === 0) {
      delete hooksIn[key];
    }
  }

  stripped.hooks = hooksIn;
  return ensureHermesMaxVerifyNudges(stripped);
}

/** Parse YAML text → config object (null/empty → empty mapping). */
export function parseHermesConfigYaml(text: string | null): HermesConfigFile {
  const src = typeof text === "string" ? text.replace(/^\uFEFF/, "") : "";
  if (src.trim() === "") {
    return Object.create(null) as HermesConfigFile;
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(src);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Hermes config.yaml is not valid YAML: ${msg}`);
  }
  if (parsed == null) {
    return Object.create(null) as HermesConfigFile;
  }
  if (!isPlainObject(parsed)) {
    throw new Error("Hermes config.yaml root must be a mapping.");
  }
  const shapeError = validateHermesConfigShape(parsed as HermesConfigFile);
  if (shapeError) {
    throw new Error(shapeError);
  }
  return parsed as HermesConfigFile;
}

/** Serialize config (stable enough for init/force refresh). */
export function formatHermesConfigYaml(file: HermesConfigFile): string {
  const shapeError = validateHermesConfigShape(file);
  if (shapeError) {
    throw new Error(shapeError);
  }
  // lineWidth 0 → no forced wraps that break shell commands.
  const body = stringifyYaml(file, { lineWidth: 0, defaultKeyType: "PLAIN" });
  return body.endsWith("\n") ? body : `${body}\n`;
}

/** Merge from raw YAML string (or null/empty). */
export function mergeHermesConfigYaml(existing: string | null): string {
  const parsed = parseHermesConfigYaml(existing);
  return formatHermesConfigYaml(mergeHermesConfig(parsed));
}

/** Strip Autopilot hooks from YAML text; raise nudge only when still wiring. */
export function stripAutopilotHermesConfigYaml(existing: string): string {
  const parsed = parseHermesConfigYaml(existing);
  const stripped = stripAutopilotHermesHooks(parsed);
  // Uninstall path: do not invent agent.max_verify_nudges.
  if (!stripped.hooks || Object.keys(stripped.hooks).length === 0) {
    delete stripped.hooks;
  }
  return formatHermesConfigYaml(stripped);
}

export function hermesHooksContainAutopilot(
  file: HermesConfigFile | null,
): boolean {
  if (!file || !isPlainObject(file)) return false;
  const hooks = file.hooks;
  if (!hooks || !isPlainObject(hooks)) return false;
  for (const [key, value] of Object.entries(hooks as Record<string, unknown>)) {
    if (HERMES_RESERVED_SET.has(key)) continue;
    if (Array.isArray(value) && value.some((e) => entryHasAutopilotCommand(e))) {
      return true;
    }
    // Flat (non-list) Autopilot object under an event key — fingerprint for
    // uninstall even when validate would refuse the shape on parse.
    if (entryHasAutopilotCommand(value)) return true;
    if (typeof value === "string" && isAutopilotCommand(value)) return true;
  }
  return false;
}

export function hermesConfigYamlContainsAutopilot(yaml: string): boolean {
  try {
    return hermesHooksContainAutopilot(parseHermesConfigYaml(yaml));
  } catch {
    // Parse/validate failed — fingerprint hook invocations only (avoid comment
    // / prose false positives that merely mention the filename).
    if (typeof yaml !== "string") return false;
    return (
      // `command:` must look like an invocation (node … or …/hook.mjs), and
      // stop before `#` so trailing comments cannot invent a fingerprint.
      /(?:^|\n)\s*command:\s*[^\n#]*(?:\bnode\s+[^\n#]*|[/\\])autopilot-harness-hook\.mjs/m.test(
        yaml,
      ) ||
      // Relative Autopilot Hermes command (init always writes this shape).
      /(?:^|\n)[^\n#]*\bnode\s+\.autopilot\/bin\/autopilot-harness-hook\.mjs\b/m.test(
        yaml,
      )
    );
  }
}

export function summarizeHermesAutopilotHooks(file: HermesConfigFile): {
  missingEvents: string[];
  duplicates: number;
} {
  const missingEvents: string[] = [];
  let duplicates = 0;
  const hooks = file.hooks;
  for (const event of HERMES_AUTOPILOT_EVENTS) {
    const entries =
      hooks &&
      isPlainObject(hooks) &&
      Array.isArray((hooks as Record<string, unknown>)[event])
        ? ((hooks as Record<string, unknown>)[event] as unknown[])
        : [];
    let n = 0;
    for (const e of entries) {
      // Desynced `--event` under the wrong YAML key does not satisfy the event.
      if (entryAutopilotForEvent(e, event)) n += 1;
    }
    if (n === 0) missingEvents.push(event);
    if (n > 1) duplicates += n - 1;
  }
  return { missingEvents, duplicates };
}

export function hasCompleteHermesAutopilotHooks(
  file: HermesConfigFile,
): boolean {
  const { missingEvents, duplicates } = summarizeHermesAutopilotHooks(file);
  if (missingEvents.length !== 0 || duplicates !== 0) return false;
  // Wrong-platform / desynced leftovers under event keys do not affect
  // summarize counts (they are not event-aligned) — still incomplete.
  if (!hermesHooksHavePlatformStamp(file)) return false;
  // post_tool_call must carry the Autopilot matcher (omit → runs on all tools).
  const hooks = file.hooks;
  if (!hooks || !isPlainObject(hooks)) return false;
  const posts = Array.isArray((hooks as Record<string, unknown>).post_tool_call)
    ? ((hooks as Record<string, unknown>).post_tool_call as unknown[])
    : [];
  const postAp = posts.find((e) => entryAutopilotForEvent(e, "post_tool_call"));
  if (!postAp || !isPlainObject(postAp)) return false;
  return (postAp as HermesHookEntry).matcher === HERMES_POST_TOOL_MATCHER;
}

/**
 * True when every Autopilot command under Hermes event keys stamps
 * `--platform hermes-agent` and `--event` matching that YAML key.
 * Desynced / wrong-platform leftovers make this false (doctor refresh).
 * Autopilot under non-reserved foreign event keys also fails (stray).
 */
export function hermesHooksHavePlatformStamp(
  file: HermesConfigFile,
): boolean {
  let seen = 0;
  const hooks = file.hooks;
  if (!hooks || !isPlainObject(hooks)) return false;
  for (const [key, value] of Object.entries(hooks as Record<string, unknown>)) {
    if (HERMES_RESERVED_SET.has(key) || HERMES_EVENT_SET.has(key)) continue;
    if (Array.isArray(value)) {
      if (value.some((e) => entryHasAutopilotCommand(e))) {
        // Autopilot parked under an unexpected event key — treat as unstamped.
        return false;
      }
      continue;
    }
    // Flat Autopilot object / bare command string under a foreign key
    // (validate rejects on parse; still fail closed for in-memory callers).
    if (entryHasAutopilotCommand(value)) return false;
    if (typeof value === "string" && isAutopilotCommand(value)) return false;
  }
  for (const event of HERMES_AUTOPILOT_EVENTS) {
    const slot = (hooks as Record<string, unknown>)[event];
    if (slot == null) continue;
    // Canonical Autopilot events must be entry lists — flat/scalar is unstamped.
    if (!Array.isArray(slot)) return false;
    for (const raw of slot) {
      if (!entryHasAutopilotCommand(raw)) continue;
      seen += 1;
      const cmd = (raw as HermesHookEntry).command;
      if (
        typeof cmd !== "string" ||
        !commandHasPlatformStamp(cmd, HOOK_PLATFORM_HERMES_AGENT) ||
        !commandHasEventStamp(cmd, event)
      ) {
        return false;
      }
    }
  }
  return seen > 0;
}

/** True when Autopilot entries omit timeout or use timeout &lt; 120. */
export function hermesAutopilotHasOmittedOrSmallTimeout(
  file: HermesConfigFile,
): boolean {
  const hooks = file.hooks;
  if (!hooks || !isPlainObject(hooks)) return false;
  for (const event of HERMES_AUTOPILOT_EVENTS) {
    const entries = Array.isArray((hooks as Record<string, unknown>)[event])
      ? ((hooks as Record<string, unknown>)[event] as unknown[])
      : [];
    for (const raw of entries) {
      if (!entryHasAutopilotCommand(raw)) continue;
      const t = coerceFiniteInt((raw as HermesHookEntry).timeout);
      if (t == null || t < HERMES_HOOK_TIMEOUT_SEC) {
        return true;
      }
    }
  }
  return false;
}

/** Read current max_verify_nudges (null when missing/unreadable). */
export function readHermesMaxVerifyNudges(
  file: HermesConfigFile,
): number | null {
  const agent = file.agent;
  if (!agent || !isPlainObject(agent)) return null;
  const raw = (agent as Record<string, unknown>).max_verify_nudges;
  return coerceFiniteInt(raw);
}

export function hermesConfigHasVerifyNudgeFloor(
  file: HermesConfigFile,
): boolean {
  const n = readHermesMaxVerifyNudges(file);
  return n != null && n >= HERMES_MAX_VERIFY_NUDGES;
}

/** True when merge left nothing under hooks (uninstall may leave file). */
export function hermesHooksBlockIsVacant(file: HermesConfigFile | null): boolean {
  if (!file || !isPlainObject(file)) return true;
  const hooks = file.hooks;
  if (hooks == null) return true;
  if (!isPlainObject(hooks)) return false;
  for (const [key, value] of Object.entries(hooks as Record<string, unknown>)) {
    if (isUnsafeKey(key)) continue;
    if (value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return false;
  }
  return true;
}

export function readHermesConfigYaml(filePath: string):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  const label = path.basename(filePath) || "config.yaml";
  try {
    const raw = readUntrustedUtf8File(
      filePath,
      MAX_UNTRUSTED_TEXT_BYTES,
      label,
    );
    return { ok: true, value: raw };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: "" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read ${filePath}: ${msg}` };
  }
}
