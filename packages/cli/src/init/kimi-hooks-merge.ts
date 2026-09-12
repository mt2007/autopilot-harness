/**
 * Merge Autopilot hooks into Kimi Code user-home `config.toml` `[[hooks]]`.
 * Default home: `$KIMI_CODE_HOME` or `~/.kimi-code`. Never writes `local.toml`.
 * Only the four Kimi fields (event / command / matcher / timeout) are emitted.
 */
import os from "node:os";
import path from "node:path";
import {
  HOOK_PLATFORM_KIMI_CODE,
  autopilotHookCommandLine,
  isAutopilotCommand,
} from "./hooks-merge.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
} from "../read-untrusted-file.js";

/** Events Autopilot registers under Kimi Code (no StopFailure). */
export const KIMI_AUTOPILOT_EVENTS = [
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
] as const;

export type KimiAutopilotEvent = (typeof KIMI_AUTOPILOT_EVENTS)[number];

/**
 * PostToolUse matcher — tools the Kimi port arms for product edits
 * (Bash dirty-arm is Stop-side; omit from matcher to avoid noise).
 */
export const KIMI_POST_TOOL_USE_MATCHER =
  "Write|Edit|StrReplace|MultiEdit|apply_patch|ApplyPatch";

/** Autopilot Stop/UPS budget; Kimi default is 30s (too low). Cap is 600. */
export const KIMI_HOOK_TIMEOUT_SEC = 120;

export const KIMI_HOOKS_BEGIN_MARKER = "# --- autopilot-harness hooks begin ---";
export const KIMI_HOOKS_END_MARKER = "# --- autopilot-harness hooks end ---";

export interface KimiHookEntry {
  event: string;
  command: string;
  matcher?: string;
  timeout?: number;
}

/** Resolve Kimi Code data home (env wins; never legacy `~/.kimi`). */
export function resolveKimiCodeHome(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.KIMI_CODE_HOME;
  if (typeof raw === "string") {
    // Strip C0 controls (hostile env) before resolve; blank → default home.
    const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (cleaned) return path.resolve(cleaned);
  }
  return path.join(os.homedir(), ".kimi-code");
}

export function kimiConfigTomlPath(
  home: string = resolveKimiCodeHome(),
): string {
  return path.join(home, "config.toml");
}

/** Build one Autopilot `[[hooks]]` table (timeout always ≥120). */
export function autopilotKimiHookEntry(
  event: KimiAutopilotEvent,
): KimiHookEntry {
  const entry: KimiHookEntry = {
    event,
    command: autopilotHookCommandLine(HOOK_PLATFORM_KIMI_CODE, event),
    timeout: KIMI_HOOK_TIMEOUT_SEC,
  };
  if (event === "PostToolUse") {
    return { ...entry, matcher: KIMI_POST_TOOL_USE_MATCHER };
  }
  return entry;
}

function tomlEscapeBasic(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/** Serialize one hook table — only the four allowed Kimi fields. */
export function formatKimiHookTable(entry: KimiHookEntry): string {
  const lines = ["[[hooks]]", `event = "${tomlEscapeBasic(entry.event)}"`];
  if (typeof entry.matcher === "string" && entry.matcher.length > 0) {
    lines.push(`matcher = "${tomlEscapeBasic(entry.matcher)}"`);
  }
  lines.push(`command = "${tomlEscapeBasic(entry.command)}"`);
  const timeout =
    typeof entry.timeout === "number" && Number.isFinite(entry.timeout)
      ? Math.max(1, Math.min(600, Math.trunc(entry.timeout)))
      : KIMI_HOOK_TIMEOUT_SEC;
  lines.push(`timeout = ${timeout}`);
  return lines.join("\n");
}

function parseTomlBasicString(raw: string): string | null {
  const t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    const inner = t.slice(1, -1);
    if (t.startsWith("'")) return inner;
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  // Bare token (rare for command) — reject controls.
  if (/[\u0000-\u001f\u007f]/.test(t)) return null;
  return t;
}

function parseHookAssignment(
  line: string,
): { key: string; value: string } | null {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line.trim());
  if (!m) return null;
  return { key: m[1]!, value: m[2]!.trim() };
}

/**
 * Split config.toml into preamble (non-hook body) + foreign hook tables to keep.
 * Autopilot-fingerprinted tables and marker-wrapped Autopilot blocks are dropped.
 */
export function stripAutopilotKimiHooks(toml: string): {
  preamble: string;
  foreignHookTables: string[];
} {
  const text = typeof toml === "string" ? toml.replace(/^\uFEFF/, "") : "";
  // Remove prior marker-wrapped Autopilot section first.
  const withoutMarked = text.replace(
    new RegExp(
      `${escapeRegExp(KIMI_HOOKS_BEGIN_MARKER)}[\\s\\S]*?${escapeRegExp(KIMI_HOOKS_END_MARKER)}\\s*`,
      "g",
    ),
    "",
  );

  const lines = withoutMarked.split(/\r?\n/);
  const preambleLines: string[] = [];
  const foreignHookTables: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "[[hooks]]") {
      const blockLines = [line];
      i += 1;
      while (i < lines.length) {
        const next = lines[i]!;
        if (/^\s*\[\[/.test(next) || /^\s*\[[^[\]]/.test(next)) break;
        blockLines.push(next);
        i += 1;
      }
      const block = blockLines.join("\n");
      const parsed = tryParseKimiHookTable(block);
      // Drop Autopilot by fingerprint even when the table is exotic/unparseable,
      // otherwise force refresh would stack a second Autopilot set beside it.
      // Prefer the install path segment (POSIX or Windows separators) so comments
      // / lookalike names do not drop foreign tables; parseable tables still use
      // isAutopilotCommand.
      if (
        (parsed && isAutopilotCommand(parsed.command)) ||
        (!parsed &&
          /^\s*command\s*=\s*.*autopilot[/\\]bin[/\\]autopilot-harness-hook\.mjs/m.test(
            block,
          ))
      ) {
        continue;
      }
      foreignHookTables.push(block);
      continue;
    }
    preambleLines.push(line);
    i += 1;
  }

  // Trim trailing blank lines from preamble for stable append.
  while (
    preambleLines.length > 0 &&
    preambleLines[preambleLines.length - 1]!.trim() === ""
  ) {
    preambleLines.pop();
  }

  return {
    preamble: preambleLines.join("\n"),
    foreignHookTables,
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a single `[[hooks]]` table; null if exotic / unsafe. */
export function tryParseKimiHookTable(block: string): KimiHookEntry | null {
  const lines = block.split(/\r?\n/);
  if (lines[0]?.trim() !== "[[hooks]]") return null;
  let event: string | undefined;
  let command: string | undefined;
  let matcher: string | undefined;
  let timeout: number | undefined;
  for (const raw of lines.slice(1)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const asg = parseHookAssignment(trimmed);
    if (!asg) return null;
    if (
      asg.key !== "event" &&
      asg.key !== "command" &&
      asg.key !== "matcher" &&
      asg.key !== "timeout"
    ) {
      // Extra fields break Kimi Code load — treat as opaque / refuse parse.
      return null;
    }
    if (asg.key === "timeout") {
      const n = Number(asg.value);
      if (!Number.isFinite(n)) return null;
      timeout = Math.trunc(n);
      continue;
    }
    const str = parseTomlBasicString(asg.value);
    if (str == null) return null;
    if (asg.key === "event") event = str;
    else if (asg.key === "command") command = str;
    else if (asg.key === "matcher") matcher = str;
  }
  if (!event || !command) return null;
  const entry: KimiHookEntry = { event, command };
  if (matcher != null) entry.matcher = matcher;
  if (timeout != null) entry.timeout = timeout;
  return entry;
}

/**
 * Non-destructive merge: keep non-hook config + foreign hooks; replace Autopilot
 * entries (fingerprint + markers) with fresh timeout≥120 tables.
 */
export function mergeKimiConfigToml(existing: string | null): string {
  const src = typeof existing === "string" ? existing : "";
  const { preamble, foreignHookTables } = stripAutopilotKimiHooks(src);
  const autopilotTables = KIMI_AUTOPILOT_EVENTS.map((ev) =>
    formatKimiHookTable(autopilotKimiHookEntry(ev)),
  );
  const parts: string[] = [];
  if (preamble.trim().length > 0) {
    parts.push(preamble.trimEnd());
  }
  for (const table of foreignHookTables) {
    parts.push(table.trimEnd());
  }
  parts.push(KIMI_HOOKS_BEGIN_MARKER);
  parts.push(...autopilotTables);
  parts.push(KIMI_HOOKS_END_MARKER);
  return `${parts.join("\n\n")}\n`;
}

/** True when any Autopilot-fingerprinted hook command is present. */
export function kimiHooksContainAutopilot(toml: string): boolean {
  return typeof toml === "string" && /autopilot-harness-hook\.mjs/.test(toml);
}

/** True when every Autopilot event has a stamped command. */
export function kimiHooksHavePlatformStamp(toml: string): boolean {
  const text = typeof toml === "string" ? toml : "";
  for (const event of KIMI_AUTOPILOT_EVENTS) {
    const needle = autopilotHookCommandLine(HOOK_PLATFORM_KIMI_CODE, event);
    if (!text.includes(needle)) return false;
  }
  return true;
}

/** True when an Autopilot hook table has timeout &lt; 120 or omits timeout (Kimi default 30s). */
export function kimiAutopilotHasSmallTimeout(toml: string): boolean {
  const text = typeof toml === "string" ? toml : "";
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trim() !== "[[hooks]]") {
      i += 1;
      continue;
    }
    const blockLines = [lines[i]!];
    i += 1;
    while (i < lines.length) {
      const next = lines[i]!;
      if (/^\s*\[\[/.test(next) || /^\s*\[[^[\]]/.test(next)) break;
      blockLines.push(next);
      i += 1;
    }
    const parsed = tryParseKimiHookTable(blockLines.join("\n"));
    if (!parsed || !isAutopilotCommand(parsed.command)) continue;
    // Kimi default timeout is 30s when the field is omitted — treat as too small.
    if (
      typeof parsed.timeout !== "number" ||
      !Number.isFinite(parsed.timeout) ||
      parsed.timeout < KIMI_HOOK_TIMEOUT_SEC
    ) {
      return true;
    }
  }
  return false;
}

/** Read config.toml; missing file → empty string; refuse symlink / oversize (O_NOFOLLOW). */
export function readKimiConfigToml(filePath: string): {
  ok: true;
  value: string;
} | { ok: false; error: string } {
  const label = path.basename(filePath) || "config.toml";
  try {
    // Do not existsSync first: dangling symlinks look missing there, but
    // O_NOFOLLOW open fails with ELOOP — fail closed before merge/write.
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
