/**
 * Merge Autopilot hooks into Copilot CLI `.github/hooks/autopilot-harness.json`.
 * Preserves foreign hooks; replaces Autopilot-fingerprinted entries only.
 * Schema: version 1 + camelCase events; each entry dual bash + powershell.
 */
import {
  HOOK_PLATFORM_COPILOT_CLI,
  autopilotHookCommandLine,
  commandHasPlatformStamp,
  isAutopilotCommand,
} from "./hooks-merge.js";

/** Events Autopilot registers under Copilot hooks (no preToolUse). */
export const COPILOT_AUTOPILOT_EVENTS = [
  "userPromptSubmitted",
  "userPromptTransformed",
  "postToolUse",
  "agentStop",
] as const;

export type CopilotAutopilotEvent = (typeof COPILOT_AUTOPILOT_EVENTS)[number];

/** PostToolUse matcher (runtime toolName; edit|create). */
export const COPILOT_POST_TOOL_USE_MATCHER = "edit|create";

/** Confirm-chain budget; Copilot default timeoutSec is 30. */
export const COPILOT_HOOK_TIMEOUT_SEC = 120;

export const COPILOT_HOOKS_REL_PATH = pathJoinGithub(
  "hooks",
  "autopilot-harness.json",
);

function pathJoinGithub(...parts: string[]): string {
  return [".github", ...parts].join("/");
}

export interface CopilotHookHandler {
  type?: string;
  bash?: string;
  powershell?: string;
  /** Cross-platform alias some docs accept when bash/powershell omitted. */
  command?: string;
  cwd?: string;
  env?: Record<string, unknown>;
  timeoutSec?: number;
  timeout?: number;
  matcher?: string;
  [key: string]: unknown;
}

export interface CopilotHooksFile {
  version?: number;
  hooks?: Record<string, CopilotHookHandler[] | unknown>;
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

/** True when any command field on the handler is Autopilot-fingerprinted. */
export function isAutopilotCopilotHandler(
  h: CopilotHookHandler | null | undefined,
): boolean {
  if (!h || typeof h !== "object" || Array.isArray(h)) return false;
  return (
    isAutopilotCommand(h.bash) ||
    isAutopilotCommand(h.powershell) ||
    isAutopilotCommand(h.command)
  );
}

/** Primary command string used for stamp checks (prefer bash). */
export function copilotHandlerCommand(
  h: CopilotHookHandler | null | undefined,
): string | undefined {
  if (!h || typeof h !== "object") return undefined;
  if (typeof h.bash === "string" && h.bash.trim()) return h.bash;
  if (typeof h.powershell === "string" && h.powershell.trim()) {
    return h.powershell;
  }
  if (typeof h.command === "string" && h.command.trim()) return h.command;
  return undefined;
}

/** Build one Autopilot Copilot hook entry (dual OS + timeoutSec ≥120). */
export function autopilotCopilotHookHandler(
  event: CopilotAutopilotEvent,
): CopilotHookHandler {
  const cmd = autopilotHookCommandLine(HOOK_PLATFORM_COPILOT_CLI, event);
  const base: CopilotHookHandler = {
    type: "command",
    bash: cmd,
    powershell: cmd,
    timeoutSec: COPILOT_HOOK_TIMEOUT_SEC,
  };
  if (event === "postToolUse") {
    return { ...base, matcher: COPILOT_POST_TOOL_USE_MATCHER };
  }
  return base;
}

/**
 * Ensure hooks file shape is merge-safe; otherwise refuse (do not wipe).
 */
export function validateCopilotHooksShape(
  file: CopilotHooksFile,
): string | null {
  for (const key of Object.keys(file)) {
    if (isUnsafeKey(key)) {
      return `hooks file key "${safeKeyLabel(key)}" is not allowed.`;
    }
  }
  if (file.version != null) {
    if (typeof file.version !== "number" || !Number.isFinite(file.version)) {
      return 'hooks file "version" must be a finite number.';
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
      return `hooks file hooks.${label} must be an array of hook handlers.`;
    }
    for (const h of value) {
      if (!h || typeof h !== "object" || Array.isArray(h)) {
        return `hooks file hooks.${label} contains a non-object handler.`;
      }
      const handler = h as CopilotHookHandler;
      if (handler.type != null && typeof handler.type !== "string") {
        return `hooks file hooks.${label} has a non-string type.`;
      }
      for (const field of ["bash", "powershell", "command", "cwd", "matcher"] as const) {
        if (
          handler[field] != null &&
          typeof handler[field] !== "string"
        ) {
          return `hooks file hooks.${label} has a non-string ${field}.`;
        }
      }
      if (
        handler.timeoutSec != null &&
        (typeof handler.timeoutSec !== "number" ||
          !Number.isFinite(handler.timeoutSec))
      ) {
        return `hooks file hooks.${label} has a non-finite timeoutSec.`;
      }
      if (
        handler.timeout != null &&
        (typeof handler.timeout !== "number" ||
          !Number.isFinite(handler.timeout))
      ) {
        return `hooks file hooks.${label} has a non-finite timeout.`;
      }
      if (
        handler.env != null &&
        (typeof handler.env !== "object" ||
          Array.isArray(handler.env) ||
          handler.env === null)
      ) {
        return `hooks file hooks.${label} has a non-object env.`;
      }
    }
  }
  return null;
}

function stripAutopilotFromHandlers(
  handlers: CopilotHookHandler[],
): CopilotHookHandler[] {
  return handlers.filter((h) => !isAutopilotCopilotHandler(h));
}

/**
 * Merge Autopilot Copilot hooks into an existing file (or create fresh).
 * Always sets version: 1. Never clamps confirm_rounds (host config elsewhere).
 */
export function mergeCopilotHooks(
  existing: CopilotHooksFile | null,
): CopilotHooksFile {
  const base: CopilotHooksFile = {};
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    const shapeError = validateCopilotHooksShape(existing);
    if (shapeError) {
      throw new Error(shapeError);
    }
    for (const [key, value] of Object.entries(existing)) {
      if (isUnsafeKey(key)) continue;
      base[key] = value;
    }
  } else {
    const shapeError = validateCopilotHooksShape(base);
    if (shapeError) {
      throw new Error(shapeError);
    }
  }

  base.version = 1;

  const nextHooks: Record<string, CopilotHookHandler[]> = Object.create(null);
  if (base.hooks && typeof base.hooks === "object" && !Array.isArray(base.hooks)) {
    for (const [key, value] of Object.entries(base.hooks)) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(value)) continue;
      nextHooks[key] = stripAutopilotFromHandlers(
        value as CopilotHookHandler[],
      );
    }
  }

  for (const event of COPILOT_AUTOPILOT_EVENTS) {
    const current = Array.isArray(nextHooks[event])
      ? [...nextHooks[event]!]
      : [];
    const stripped = stripAutopilotFromHandlers(current);
    stripped.push(autopilotCopilotHookHandler(event));
    nextHooks[event] = stripped;
  }

  base.hooks = nextHooks;
  return base;
}

/** Remove Autopilot Copilot handlers; keep foreign hooks + version. */
export function stripAutopilotCopilotHooks(
  existing: CopilotHooksFile,
): CopilotHooksFile {
  const shapeError = validateCopilotHooksShape(existing);
  if (shapeError) {
    throw new Error(shapeError);
  }

  const base: CopilotHooksFile = {};
  for (const [key, value] of Object.entries(existing)) {
    if (isUnsafeKey(key)) continue;
    base[key] = value;
  }

  const prevHooks = base.hooks;
  if (prevHooks && typeof prevHooks === "object" && !Array.isArray(prevHooks)) {
    const nextHooks: Record<string, CopilotHookHandler[]> = Object.create(null);
    for (const [key, value] of Object.entries(prevHooks)) {
      if (isUnsafeKey(key)) continue;
      if (!Array.isArray(value)) continue;
      const kept = stripAutopilotFromHandlers(value as CopilotHookHandler[]);
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

export function copilotHooksContainAutopilot(
  file: CopilotHooksFile | null,
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
    if ((value as CopilotHookHandler[]).some((h) => isAutopilotCopilotHandler(h))) {
      return true;
    }
  }
  return false;
}

export function summarizeCopilotAutopilotHooks(file: CopilotHooksFile): {
  missingEvents: string[];
  duplicates: number;
} {
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  const missingEvents: string[] = [];
  let duplicates = 0;
  for (const event of COPILOT_AUTOPILOT_EVENTS) {
    const handlers = Array.isArray(bag[event])
      ? (bag[event] as CopilotHookHandler[])
      : [];
    const n = handlers.filter((h) => isAutopilotCopilotHandler(h)).length;
    if (n === 0) missingEvents.push(event);
    if (n > 1) duplicates += n - 1;
  }
  return { missingEvents, duplicates };
}

export function hasCompleteCopilotAutopilotHooks(
  file: CopilotHooksFile,
): boolean {
  const { missingEvents, duplicates } = summarizeCopilotAutopilotHooks(file);
  return missingEvents.length === 0 && duplicates === 0;
}

/** True when every Autopilot Copilot command stamps `--platform copilot-cli`. */
export function copilotHooksHavePlatformStamp(
  file: CopilotHooksFile,
): boolean {
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  let seen = 0;
  for (const event of COPILOT_AUTOPILOT_EVENTS) {
    const handlers = Array.isArray(bag[event])
      ? (bag[event] as CopilotHookHandler[])
      : [];
    for (const h of handlers) {
      if (!isAutopilotCopilotHandler(h)) continue;
      seen += 1;
      // Dual OS: every Autopilot-fingerprinted command field must stamp.
      let stampedField = false;
      for (const cmd of [h.bash, h.powershell, h.command]) {
        if (!isAutopilotCommand(cmd)) continue;
        stampedField = true;
        if (!commandHasPlatformStamp(cmd, HOOK_PLATFORM_COPILOT_CLI)) {
          return false;
        }
      }
      if (!stampedField) return false;
    }
  }
  return seen > 0;
}

/**
 * Effective timeout for a handler: timeoutSec wins over timeout.
 * Missing → treat as default 30 (Copilot host default).
 */
export function copilotHandlerTimeoutSec(h: CopilotHookHandler): number {
  if (typeof h.timeoutSec === "number" && Number.isFinite(h.timeoutSec)) {
    return h.timeoutSec;
  }
  if (typeof h.timeout === "number" && Number.isFinite(h.timeout)) {
    return h.timeout;
  }
  return 30;
}

/** True when any Autopilot handler has effective timeout &lt; 120s. */
export function copilotAutopilotHasSmallTimeout(
  file: CopilotHooksFile,
): boolean {
  const bag =
    file.hooks && typeof file.hooks === "object" && !Array.isArray(file.hooks)
      ? file.hooks
      : {};
  for (const event of COPILOT_AUTOPILOT_EVENTS) {
    const handlers = Array.isArray(bag[event])
      ? (bag[event] as CopilotHookHandler[])
      : [];
    for (const h of handlers) {
      if (!isAutopilotCopilotHandler(h)) continue;
      if (copilotHandlerTimeoutSec(h) < COPILOT_HOOK_TIMEOUT_SEC) {
        return true;
      }
    }
  }
  return false;
}
