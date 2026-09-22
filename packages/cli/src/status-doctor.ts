import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getLatestSchemaVersion,
  normalizeInProjectPlansDir,
  sanitizeSessionDisplayText,
  StateStore,
  type Phase,
  type PausedReason,
  type SessionRow,
} from "@autopilot-harness/core";
import { parseDocument } from "yaml";
import {
  formatPlatformsDisplay,
  configWantsAgentsSkills,
  configWantsInstallableHost,
  hasInstallableHookHost,
  parsePlatformBindingsFromConfig,
  type PlatformBinding,
} from "./init/platforms.js";
import {
  hasRunnerCommand,
  normalizeRunnerConfig,
  RUNNER_MIN_RECOMMENDED_ITERATIONS,
  type RunnerConfigInput,
} from "@autopilot-harness/port-runner";
import {
  autopilotStopHasUnlimitedLoop,
  autopilotSubagentStopHasUnlimitedLoop,
  cursorHooksHavePlatformStamp,
  isAutopilotCommand,
  summarizeAutopilotHooks,
  validateHooksShape,
} from "./init/hooks-merge.js";
import {
  claudeHooksHavePlatformStamp,
  claudeSettingsContainAutopilot,
  hasClaudeBlockCapZero,
  summarizeClaudeAutopilotHooks,
  validateClaudeSettingsShape,
  type ClaudeSettingsFile,
} from "./init/claude-settings-merge.js";
import {
  codexAutopilotHasSmallTimeout,
  codexHooksHavePlatformStamp,
  summarizeCodexAutopilotHooks,
  validateCodexHooksShape,
  type CodexHooksFile,
} from "./init/codex-hooks-merge.js";
import {
  kimiAutopilotHasSmallTimeout,
  kimiAutopilotMissingHookEvents,
  kimiConfigTomlPath,
  readKimiConfigToml,
  resolveKimiCodeHome,
} from "./init/kimi-hooks-merge.js";
import {
  HERMES_HOOK_TIMEOUT_SEC,
  HERMES_MAX_VERIFY_NUDGES,
  hermesAutopilotHasExpectedPostMatcher,
  hermesAutopilotHasOmittedOrSmallTimeout,
  hermesConfigHasVerifyNudgeFloor,
  hermesConfigYamlContainsAutopilot,
  hermesConfigYamlPath,
  hermesHooksHavePlatformStamp,
  hasCompleteHermesAutopilotHooks,
  parseHermesConfigYaml,
  readHermesConfigYaml,
  readHermesMaxVerifyNudges,
  resolveHermesHome,
  summarizeHermesAutopilotHooks,
} from "./init/hermes-hooks-merge.js";
import {
  COPILOT_HOOKS_REL_PATH,
  COPILOT_HOOK_TIMEOUT_SEC,
  copilotAutopilotHasSmallTimeout,
  copilotHooksContainAutopilot,
  copilotHooksHavePlatformStamp,
  hasCompleteCopilotAutopilotHooks,
  summarizeCopilotAutopilotHooks,
  validateCopilotHooksShape,
  type CopilotHooksFile,
} from "./init/copilot-hooks-merge.js";
import {
  GROK_HOOKS_REL_PATH,
  GROK_HOOK_TIMEOUT_SEC,
  grokAutopilotHasOmittedOrSmallTimeout,
  grokHooksContainAutopilot,
  grokHooksHavePlatformStamp,
  hasCompleteGrokAutopilotHooks,
  summarizeGrokAutopilotHooks,
  validateGrokHooksShape,
  type GrokHooksFile,
} from "./init/grok-hooks-merge.js";
import {
  GEMINI_SETTINGS_REL_PATH,
  GEMINI_HOOK_TIMEOUT_MS,
  geminiAutopilotHasSmallTimeout,
  geminiAutopilotNamesInHooksConfigDisabled,
  geminiHooksConfigEnabledIsFalse,
  geminiHooksHavePlatformStamp,
  geminiSettingsContainAutopilot,
  hasCompleteGeminiAutopilotHooks,
  summarizeGeminiAutopilotHooks,
  validateGeminiSettingsShape,
  type GeminiSettingsFile,
} from "./init/gemini-settings-merge.js";
import {
  FACTORY_HOOKS_REL_PATH,
  FACTORY_HOOK_TIMEOUT_SEC,
  FACTORY_LEGACY_HOOKS_REL_PATH,
  FACTORY_SETTINGS_REL_PATH,
  factoryAutopilotHasOmittedOrSmallTimeout,
  factoryHooksContainAutopilot,
  factoryHooksHavePlatformStamp,
  factoryHooksUseProjectDirEnv,
  hasCompleteFactoryAutopilotHooks,
  readFactorySettingsFlags,
  summarizeFactoryAutopilotHooks,
  validateFactoryHooksShape,
  type FactoryHooksFile,
} from "./init/factory-hooks-merge.js";
import {
  DEVIN_CONFIG_REL_PATH,
  DEVIN_HOOKS_REL_PATH,
  DEVIN_HOOK_TIMEOUT_SEC,
  DEVIN_SOFT_MIN_VERSION,
  DEVIN_STOP_CAP_RAISE_FOUND,
  devinAutopilotHasOmittedOrSmallTimeout,
  devinConfigJsonContainsAutopilot,
  devinHooksContainAutopilot,
  devinHooksHavePlatformStamp,
  devinHooksUseProjectDirEnv,
  hasCompleteDevinAutopilotHooks,
  summarizeDevinAutopilotHooks,
  validateDevinHooksShape,
  type DevinHooksFile,
} from "./init/devin-hooks-merge.js";
import {
  isDevinVersionBelowSoftMin,
  isParseableDevinVersion,
  probeDevinCliVersion,
} from "./init/devin-cli.js";
import {
  COPILOT_STOP_CAP_RAISE_FOUND,
  COPILOT_STOP_CONSECUTIVE_BLOCK_CAP,
} from "@autopilot-harness/port-copilot-cli";
import {
  GROK_STOP_CAP_RAISE_FOUND,
  GROK_STOP_PER_TURN_BLOCK_CAP,
} from "@autopilot-harness/port-grok-build";
import {
  GEMINI_AFTER_AGENT_TURN_CAP,
  GEMINI_MIN_CLI_VERSION_HINT,
  GEMINI_STOP_CAP_RAISE_FOUND,
} from "@autopilot-harness/port-gemini-cli";
import {
  FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE,
  FACTORY_DROID_DEGRADED_STOP_CONTINUE_CAP,
  FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN,
  FACTORY_DROID_STOP_CAP_RAISE_FOUND,
} from "@autopilot-harness/port-factory-droid";
import { ANTIGRAVITY_STOP_CAP_RAISE_FOUND } from "@autopilot-harness/port-antigravity";
import {
  PI_EXTENSION_REL_PATH,
  PI_SOFT_MIN_VERSION,
  isPiVersionBelowSoftMin,
  piExtensionContainsAutopilot,
  probePiCliVersion,
  readPiExtensionFile,
} from "./init/pi-extension.js";
import {
  ANTIGRAVITY_HOOKS_REL_PATH,
  ANTIGRAVITY_HOOK_BLOCK_NAME,
  ANTIGRAVITY_HOOK_TIMEOUT_SEC,
  ANTIGRAVITY_HOOK_SHIM_REL_PATH,
  antigravityAutopilotHasOmittedOrSmallTimeout,
  antigravityHooksContainAutopilot,
  antigravityHooksHavePlatformStamp,
  antigravityHooksUseRelativeCommand,
  antigravityHooksUseShimCommand,
  antigravityAutopilotHasExpectedPostMatcher,
  hasCompleteAntigravityAutopilotHooks,
  summarizeAntigravityAutopilotHooks,
  validateAntigravityHooksShape,
  type AntigravityHooksFile,
} from "./init/antigravity-hooks-merge.js";
import { PACKAGE_VERSION, type HooksFile } from "./init/types.js";
import { assertNotSymlink, assertRealpathInside } from "./init/wizard-helpers.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
} from "./read-untrusted-file.js";
import { formatSessionDisplayName, shortSessionId } from "./session.js";
import { AUTOPILOT_SKILL_NAMES } from "./init/install.js";

const VALID_PHASES = new Set<Phase>([
  "idle",
  "planning",
  "executing",
  "done",
]);
const VALID_PAUSED_REASONS = new Set<PausedReason>([
  "stuck",
  "repeated_errors",
  "human_gate",
]);
const DEFAULT_STALE_HOURS = 72;
/** Cap absurd values so hours→ms math stays finite. */
const MAX_STALE_HOURS = 24 * 365 * 100;
const SKILL_NAMES = AUTOPILOT_SKILL_NAMES;

const YAML_TO_JS_OPTS = { maxAliasCount: 64 } as const;
/** Refuse absurd configs (DoS / accidental paste) — same cap as locale-set. */
const MAX_CONFIG_BYTES = MAX_UNTRUSTED_TEXT_BYTES;

/** In-flight marker — never auto-purge. */
function isProtectedFromPrune(row: SessionRow): boolean {
  // armed executor (incl. corrupt phase); paused gate (human_gate/stuck/errors);
  // pending_action mid-flow (run pick / replan).
  if (row.armed === 1) return true;
  if (row.paused === 1) return true;
  const pending = row.pending_action;
  return typeof pending === "string" && pending.length > 0;
}

/**
 * one_executor / findExecutingSession gate: phase=executing && armed && not paused.
 * Status + doctor must surface these so opaque busy hosts can find the holder.
 */
function isArmedExecutorOccupier(row: SessionRow): boolean {
  return row.phase === "executing" && row.armed === 1 && row.paused === 0;
}

/** How to release a stuck/dead armed executor (no auto-disarm). */
const OCCUPIER_RELEASE_HINT =
  "Autopilot OFF in that chat, or: session purge <id>";

/** Cap listed holders in status/doctor (avoid huge dumps). */
const MAX_OCCUPIERS_SHOWN = 8;

function listArmedExecutorOccupiers(rows: SessionRow[]): SessionRow[] {
  return rows.filter(isArmedExecutorOccupier);
}

/** Append status/doctor lines for one_executor holders (shared gate + release hint). */
function pushOccupierDisplayLines(
  lines: string[],
  rows: SessionRow[],
  style: "status" | "doctor",
): void {
  const occupiers = listArmedExecutorOccupiers(rows);
  if (occupiers.length === 0) return;

  if (style === "status") {
    lines.push("  executors:");
    for (const ex of occupiers.slice(0, MAX_OCCUPIERS_SHOWN)) {
      lines.push(
        `    - ${shortSessionId(ex.conversation_id)}  track=${safeDisplayToken(ex.track_id || "?")}  (${OCCUPIER_RELEASE_HINT})`,
      );
    }
  } else {
    // Informational WARN — does not fail doctor. Same gate as findExecutingSession;
    // under one_executor these block peer RUN (worktree mode may allow several).
    lines.push(
      `WARN  ${occupiers.length} executing+armed session(s) — ${OCCUPIER_RELEASE_HINT}`,
    );
    for (const ex of occupiers.slice(0, MAX_OCCUPIERS_SHOWN)) {
      lines.push(
        `      - ${shortSessionId(ex.conversation_id)}  track=${safeDisplayToken(ex.track_id || "?")}`,
      );
    }
  }

  if (occupiers.length > MAX_OCCUPIERS_SHOWN) {
    const more = occupiers.length - MAX_OCCUPIERS_SHOWN;
    lines.push(
      style === "status" ? `    …and ${more} more` : `      …and ${more} more`,
    );
  }
}

function coercePositiveHours(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(raw, MAX_STALE_HOURS);
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw.trim());
    if (Number.isFinite(n) && n > 0) return Math.min(n, MAX_STALE_HOURS);
  }
  return null;
}

/**
 * Parse session.stale_after_hours.
 * - missing → default 72
 * - 0 / "0" / "0.0" → disable stale detection (never stale)
 * - positive number/numeric string → capped hours
 * - other → default + invalid flag
 */
function parseStaleAfterHours(raw: unknown): {
  hours: number;
  invalid: boolean;
} {
  if (raw === undefined || raw === null) {
    return { hours: DEFAULT_STALE_HOURS, invalid: false };
  }
  if (typeof raw === "number" && raw === 0) {
    return { hours: 0, invalid: false };
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw.trim());
    if (n === 0) return { hours: 0, invalid: false };
  }
  const coerced = coercePositiveHours(raw);
  if (coerced != null) return { hours: coerced, invalid: false };
  return { hours: DEFAULT_STALE_HOURS, invalid: true };
}

function safeDisplayToken(value: string, fallback = "?"): string {
  const cleaned = sanitizeSessionDisplayText(value);
  return cleaned || fallback;
}

/** Safe slug list from session.track_candidates_json (status pick UX). */
function parseTrackCandidateSlugs(
  raw: string | null | undefined,
  max = 12,
): string[] {
  if (!raw || typeof raw !== "string") return [];
  // Bound parse cost for corrupt / hostile rows in state.db.
  const MAX_CANDIDATES_JSON_CHARS = 32_768;
  if (raw.length > MAX_CANDIDATES_JSON_CHARS) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    const slugs: string[] = [];
    // Cap how many entries we walk so a huge junk array cannot stall status.
    const scanCap = Math.min(parsed.length, Math.max(max * 16, 64));
    for (let i = 0; i < scanCap && slugs.length < max; i++) {
      const c = parsed[i];
      if (
        !c ||
        typeof c !== "object" ||
        Array.isArray(c) ||
        typeof (c as { slug?: unknown }).slug !== "string"
      ) {
        continue;
      }
      const token = safeDisplayToken(String((c as { slug: string }).slug));
      if (token && token !== "?") slugs.push(token);
    }
    return slugs;
  } catch {
    return [];
  }
}

export type DoctorOptions = {
  pruneStale?: boolean;
  /** Injectable clock for stale checks (tests). */
  nowMs?: number;
  /** Injectable package version (defaults to PACKAGE_VERSION). */
  packageVersion?: string;
  /** Injectable home directory for global hooks dual-inject check (tests). */
  homeDir?: string;
  /**
   * Injectable Kimi Code data home (absolute). Tests only — production uses
   * `$KIMI_CODE_HOME` / `~/.kimi-code` via {@link resolveKimiCodeHome}.
   */
  kimiCodeHome?: string;
  /**
   * Injectable Hermes Agent data home (absolute). Tests only — production uses
   * `$HERMES_HOME` / `~/.hermes` via {@link resolveHermesHome}.
   */
  hermesHome?: string;
};

export type DoctorResult = {
  ok: boolean;
  lines: string[];
  pruned?: number;
};

/** pin.json is tiny (version string); refuse absurd blobs before parse. */
const MAX_PIN_BYTES = 64_000;

/** True when user-level Cursor hooks still run a legacy global self-review script. */
export function hasGlobalSelfReviewHooks(homeDir: string): boolean {
  // homeDir inject được (tests) — chỉ chấp nhận absolute để chặn path lung tung.
  if (typeof homeDir !== "string" || !homeDir || !path.isAbsolute(homeDir)) {
    return false;
  }
  const hooksPath = path.join(homeDir, ".cursor", "hooks.json");
  try {
    const raw = readUntrustedUtf8File(
      hooksPath,
      MAX_CONFIG_BYTES,
      "~/.cursor/hooks.json",
    );
    return (
      raw.includes("run-global-self-review") ||
      raw.includes("self-review-on-stop.py")
    );
  } catch {
    return false;
  }
}

/** True when project `.cursor/hooks.json` still has Autopilot command fingerprints. */
function cursorHooksContainAutopilot(hooks: HooksFile | null): boolean {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return false;
  }
  const bag =
    hooks.hooks && typeof hooks.hooks === "object" && !Array.isArray(hooks.hooks)
      ? hooks.hooks
      : {};
  for (const value of Object.values(bag)) {
    if (!Array.isArray(value)) continue;
    if (value.some((h) => isAutopilotCommand(h?.command))) return true;
  }
  return false;
}

/**
 * Best-effort: leftover Grok Autopilot fingerprint on disk.
 * Missing/unreadable/non-object → false (dual-fingerprint WARN only).
 */
function projectHasGrokAutopilotFingerprint(projectRoot: string): boolean {
  try {
    const raw = readUntrustedUtf8File(
      path.join(projectRoot, ".grok", "hooks", "autopilot-harness.json"),
      MAX_CONFIG_BYTES,
      GROK_HOOKS_REL_PATH,
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    return grokHooksContainAutopilot(parsed as GrokHooksFile);
  } catch {
    return false;
  }
}

/**
 * Best-effort: leftover Gemini Autopilot fingerprint on disk.
 * Missing/unreadable/non-object → false (dual-fingerprint WARN only).
 */
function projectHasGeminiAutopilotFingerprint(projectRoot: string): boolean {
  try {
    const raw = readUntrustedUtf8File(
      path.join(projectRoot, ".gemini", "settings.json"),
      MAX_CONFIG_BYTES,
      GEMINI_SETTINGS_REL_PATH,
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    return geminiSettingsContainAutopilot(parsed as GeminiSettingsFile);
  } catch {
    return false;
  }
}

/**
 * Best-effort: leftover Antigravity Autopilot fingerprint on disk.
 * Missing/unreadable/non-object → false (dual-fingerprint WARN only).
 */
function projectHasAntigravityAutopilotFingerprint(
  projectRoot: string,
): boolean {
  try {
    const raw = readUntrustedUtf8File(
      path.join(projectRoot, ".agents", "hooks.json"),
      MAX_CONFIG_BYTES,
      ANTIGRAVITY_HOOKS_REL_PATH,
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    return antigravityHooksContainAutopilot(parsed as AntigravityHooksFile);
  } catch {
    return false;
  }
}

/**
 * Best-effort: leftover Factory Autopilot fingerprint on disk.
 * Checks modern hooks.json, settings.json nested hooks, and legacy path.
 * Missing/unreadable/non-object → false (dual-fingerprint WARN only).
 */
function projectHasFactoryAutopilotFingerprint(projectRoot: string): boolean {
  if (
    factoryFileHasAutopilotFingerprint(
      path.join(projectRoot, ".factory", "hooks.json"),
      FACTORY_HOOKS_REL_PATH,
    )
  ) {
    return true;
  }
  if (
    tryReadFactorySettingsFlags(
      path.join(projectRoot, ".factory", "settings.json"),
      FACTORY_SETTINGS_REL_PATH,
    ).hooksContainAutopilot
  ) {
    return true;
  }
  return factoryFileHasAutopilotFingerprint(
    path.join(projectRoot, ".factory", "hooks", "hooks.json"),
    FACTORY_LEGACY_HOOKS_REL_PATH,
  );
}

/**
 * Best-effort: leftover Devin Autopilot residue on disk.
 * Valid hooks.v1.json is uninstallable. Invalid shape is not — uninstall
 * soft-skips and add-platform refuses. config.json Autopilot is never stripped.
 */
function projectDevinAutopilotResidue(projectRoot: string): {
  hooksStrippable: boolean;
  hooksBlocked: boolean;
  configJson: boolean;
} {
  let hooksStrippable = false;
  let hooksBlocked = false;
  let configJson = false;
  try {
    const raw = readUntrustedUtf8File(
      path.join(projectRoot, ".devin", "hooks.v1.json"),
      MAX_CONFIG_BYTES,
      DEVIN_HOOKS_REL_PATH,
    );
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const file = parsed as DevinHooksFile;
      if (devinHooksContainAutopilot(file)) {
        if (validateDevinHooksShape(file)) hooksBlocked = true;
        else hooksStrippable = true;
      }
    }
  } catch {
    /* missing/unreadable */
  }
  try {
    const raw = readUntrustedUtf8File(
      path.join(projectRoot, ".devin", "config.json"),
      MAX_CONFIG_BYTES,
      DEVIN_CONFIG_REL_PATH,
    );
    const parsed: unknown = JSON.parse(raw);
    configJson = devinConfigJsonContainsAutopilot(parsed);
  } catch {
    /* missing/unreadable */
  }
  return { hooksStrippable, hooksBlocked, configJson };
}

/** Best-effort Autopilot fingerprint in a Factory hooks.json-shaped file. */
function factoryFileHasAutopilotFingerprint(
  filePath: string,
  label: string,
): boolean {
  try {
    const raw = readUntrustedUtf8File(filePath, MAX_CONFIG_BYTES, label);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    return factoryHooksContainAutopilot(parsed as FactoryHooksFile);
  } catch {
    return false;
  }
}

/** Best-effort Factory settings.json flags (project or ~/.factory). */
function tryReadFactorySettingsFlags(
  filePath: string,
  label: string,
): ReturnType<typeof readFactorySettingsFlags> {
  try {
    const raw = readUntrustedUtf8File(filePath, MAX_CONFIG_BYTES, label);
    const parsed: unknown = JSON.parse(raw);
    return readFactorySettingsFlags(parsed);
  } catch {
    return {
      hooksDisabled: false,
      allowManagedHooksOnly: false,
      hooksContainAutopilot: false,
    };
  }
}

/**
 * True when two absolute dirs are the same tree (resolve + realpath when possible).
 * Avoids false ~/.factory dual-load WARNs when homeDir is a symlink to projectRoot.
 */
function isSameAbsoluteDir(a: string, b: string): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (ra === rb) return true;
  try {
    return fs.realpathSync(ra) === fs.realpathSync(rb);
  } catch {
    return false;
  }
}

export function readPinVersion(projectRoot: string): string | null {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    return null;
  }
  const pinPath = path.join(
    path.resolve(projectRoot.trim()),
    ".autopilot",
    "pin.json",
  );
  try {
    const raw = readUntrustedUtf8File(pinPath, MAX_PIN_BYTES, ".autopilot/pin.json");
    const pin = JSON.parse(raw) as { "autopilot-harness"?: string };
    return typeof pin["autopilot-harness"] === "string"
      ? pin["autopilot-harness"]
      : null;
  } catch {
    return null;
  }
}

/** Read config.yml with symlink refuse + size cap (untrusted project file). */
function readProjectConfigYaml(configPath: string): string {
  return readUntrustedUtf8File(
    configPath,
    MAX_CONFIG_BYTES,
    ".autopilot/config.yml",
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function parseConfigObject(configYaml: string): Record<string, unknown> | null {
  try {
    const doc = parseDocument(configYaml);
    if (doc.errors.length > 0) return null;
    const parsed: unknown = doc.toJS(YAML_TO_JS_OPTS);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** YAML `review.confirm_rounds` as doctor sees it (1..5; missing/invalid → 5).
 * Matches core `coerceIntInRange(String(...))` — never use `Number(true)===1`. */
function parseConfiguredConfirmRounds(parsed: Record<string, unknown>): number {
  const review = isPlainObject(parsed.review) ? parsed.review : {};
  const raw = review.confirm_rounds;
  if (raw == null) return 5;
  const s = String(raw).trim();
  if (!s) return 5;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 5;
  if (n > 5) return 5;
  return n;
}

function readStatusConfig(
  configYaml: string,
  projectRoot: string,
): {
  configOk: boolean;
  platform: string;
  platforms: PlatformBinding[];
  locale: string;
  preferredName: string;
  plansDir: string;
  /** Set when artifacts.plans_dir failed core normalizeInProjectPlansDir. */
  plansDirError: string | null;
  staleAfterHours: number;
  /** True when session.stale_after_hours was present but unusable. */
  staleHoursInvalid: boolean;
  /** Configured confirm_rounds (pre–Kimi runtime clamp). */
  confirmRounds: number;
} {
  const parsed = parseConfigObject(configYaml);
  if (!parsed) {
    return {
      configOk: false,
      platform: "?",
      platforms: [],
      locale: "?",
      preferredName: "Autopilot",
      plansDir: "plans",
      plansDirError: null,
      staleAfterHours: DEFAULT_STALE_HOURS,
      staleHoursInvalid: false,
      confirmRounds: 5,
    };
  }
  const cli = isPlainObject(parsed.cli) ? parsed.cli : {};
  const artifacts = isPlainObject(parsed.artifacts) ? parsed.artifacts : {};
  const session = isPlainObject(parsed.session) ? parsed.session : {};
  let plansRaw: string | undefined = "plans";
  let plansDirTypeError: string | null = null;
  if (
    Object.prototype.hasOwnProperty.call(artifacts, "plans_dir") &&
    artifacts.plans_dir !== undefined &&
    artifacts.plans_dir !== null
  ) {
    if (typeof artifacts.plans_dir === "string") {
      plansRaw = artifacts.plans_dir;
    } else {
      plansDirTypeError = "artifacts.plans_dir must be a string";
      plansRaw = undefined;
    }
  }
  // Same normalizer as hook/runtime — keep status/doctor and RUN looking at one tree.
  const plansNorm = normalizeInProjectPlansDir(projectRoot, plansRaw);
  const staleParsed = parseStaleAfterHours(session.stale_after_hours);
  const preferredRaw =
    typeof cli.preferred_name === "string" && cli.preferred_name.trim()
      ? sanitizeSessionDisplayText(cli.preferred_name)
      : "Autopilot";
  const platforms = parsePlatformBindingsFromConfig(parsed);
  return {
    configOk: true,
    platform: safeDisplayToken(formatPlatformsDisplay(platforms)),
    platforms,
    locale:
      typeof parsed.locale === "string"
        ? safeDisplayToken(parsed.locale)
        : "?",
    preferredName: preferredRaw || "Autopilot",
    plansDir: plansNorm ?? "plans",
    plansDirError: plansDirTypeError
      ? plansDirTypeError
      : plansNorm
        ? null
        : "artifacts.plans_dir is not a valid in-project path",
    staleAfterHours: staleParsed.hours,
    staleHoursInvalid: staleParsed.invalid,
    confirmRounds: parseConfiguredConfirmRounds(parsed),
  };
}

/** Read `session.stale_after_hours` (0 = disabled). Missing file → default 72; bad/invalid config → 0. */
export function readStaleAfterHours(projectRoot: string): number {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    return 0;
  }
  const root = path.resolve(projectRoot.trim());
  const configPath = path.join(root, ".autopilot", "config.yml");
  try {
    const cfg = readStatusConfig(readProjectConfigYaml(configPath), root);
    if (!cfg.configOk || cfg.staleHoursInvalid) return 0;
    return cfg.staleAfterHours;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return DEFAULT_STALE_HOURS;
    return 0;
  }
}

function formatPhase(row: SessionRow): string {
  const phase = safeDisplayToken(String(row.phase), "?");
  if (row.paused === 1) return `${phase} (paused)`;
  return phase;
}

function isStaleSession(
  row: SessionRow,
  staleAfterHours: number,
  nowMs: number,
): boolean {
  if (!(staleAfterHours > 0)) return false;
  const t = Date.parse(row.last_active_at);
  if (Number.isNaN(t)) return false;
  return nowMs - t > staleAfterHours * 3600 * 1000;
}

function openStateStore(
  projectRoot: string,
): { ok: true; store: StateStore } | { ok: false; error: string } {
  const dbPath = path.join(projectRoot, ".autopilot", "state.db");
  try {
    const st = fs.lstatSync(dbPath);
    if (st.isSymbolicLink()) {
      return { ok: false, error: "symlink" };
    }
    if (!st.isFile()) {
      return { ok: false, error: "not a regular file" };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: false, error: "missing" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: safeDisplayToken(msg, "error") };
  }
  try {
    assertNotSymlink(path.join(projectRoot, ".autopilot"), ".autopilot/");
    assertNotSymlink(dbPath, ".autopilot/state.db");
    return { ok: true, store: new StateStore(projectRoot) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: safeDisplayToken(msg, "error") };
  }
}

export function formatStatus(projectRoot: string): string {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    return "Autopilot status: projectRoot must be a non-empty string";
  }
  const root = path.resolve(projectRoot.trim());
  const configPath = path.join(root, ".autopilot", "config.yml");
  let cfg: ReturnType<typeof readStatusConfig>;
  try {
    cfg = readStatusConfig(readProjectConfigYaml(configPath), root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return "Autopilot status: not initialized (no .autopilot/config.yml)";
    }
    const msg = err instanceof Error ? err.message : String(err);
    return `Autopilot status: cannot read config.yml (${safeDisplayToken(msg, "error")})`;
  }
  const pin = safeDisplayToken(readPinVersion(root) ?? "unknown");
  const lines = [
    `${cfg.preferredName} status`,
    `  project:  ${root}`,
    `  pin:      autopilot-harness@${pin}`,
    `  platforms: ${cfg.platform}`,
    `  locale:   ${cfg.locale}`,
    cfg.plansDirError
      ? `  plans:    invalid (${cfg.plansDirError})`
      : `  plans:    ${cfg.plansDir}`,
  ];
  if (!cfg.configOk) {
    lines.push("  config:   invalid YAML (showing defaults)");
  }

  const opened = openStateStore(root);
  if (!opened.ok) {
    if (opened.error === "missing") {
      lines.push("  state:    no state.db yet");
      lines.push("  sessions: 0");
    } else {
      lines.push(`  state:    cannot open (${opened.error})`);
    }
    return lines.join("\n");
  }

  try {
    const rows = opened.store.listSessions();
    lines.push(`  state:    state.db ok (schema ${safeDisplayToken(String(opened.store.getSchemaVersion()))})`);
    lines.push(`  sessions: ${rows.length}`);
    if (rows.length > 0) {
      const latest = rows[0]!;
      lines.push(
        `  latest:   ${shortSessionId(latest.conversation_id)}  ${formatSessionDisplayName(latest)}`,
      );
      lines.push(
        `  phase:    ${formatPhase(latest)}${latest.armed === 1 ? " · armed" : ""}`,
      );

      // Cursor pick UX: surface pending_action + candidates so agents can list
      // plans without relying on hook toast. Prefer latest when it is mid-pick;
      // otherwise first pending=run, else pending=replan.
      const isMidPick = (r: SessionRow) =>
        r.pending_action === "run" || r.pending_action === "replan";
      const pickRow = isMidPick(latest)
        ? latest
        : (rows.find((r) => r.pending_action === "run") ??
          rows.find((r) => r.pending_action === "replan") ??
          null);
      if (pickRow) {
        const pendingLabel =
          pickRow.conversation_id === latest.conversation_id
            ? safeDisplayToken(String(pickRow.pending_action))
            : `${safeDisplayToken(String(pickRow.pending_action))} @ ${shortSessionId(pickRow.conversation_id)}`;
        lines.push(`  pending:  ${pendingLabel}`);
        const candidateSlugs = parseTrackCandidateSlugs(
          pickRow.track_candidates_json,
        );
        if (candidateSlugs.length > 0) {
          lines.push(`  candidates: ${candidateSlugs.join(", ")}`);
        }
      }

      pushOccupierDisplayLines(lines, rows, "status");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`  state:    error (${safeDisplayToken(msg, "error")})`);
  } finally {
    opened.store.close();
  }
  return lines.join("\n");
}

export function runDoctor(
  projectRoot: string,
  opts: DoctorOptions = {},
): DoctorResult {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    return {
      ok: false,
      lines: ["FAIL  projectRoot must be a non-empty string"],
    };
  }
  const root = path.resolve(projectRoot.trim());
  const lines: string[] = [];
  let ok = true;
  let pruned: number | undefined;
  const nowMs = opts.nowMs ?? Date.now();
  const packageVersion = opts.packageVersion ?? PACKAGE_VERSION;

  const configPath = path.join(root, ".autopilot", "config.yml");
  let cfg: ReturnType<typeof readStatusConfig>;
  /** Same bytes as {@link cfg} — runner checks must not re-read (TOCTOU drift). */
  let configYamlText = "";
  try {
    configYamlText = readProjectConfigYaml(configPath);
    cfg = readStatusConfig(configYamlText, root);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      lines.push("FAIL  .autopilot/config.yml missing — run init");
      return { ok: false, lines };
    }
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(
      `FAIL  .autopilot/config.yml unreadable (${safeDisplayToken(msg, "error")})`,
    );
    return { ok: false, lines };
  }
  if (!cfg.configOk) {
    lines.push("FAIL  config.yml unreadable or invalid YAML");
    ok = false;
  } else {
    lines.push("OK    config.yml");
  }

  const ignorePath = path.join(root, ".autopilotignore");
  try {
    assertNotSymlink(ignorePath, ".autopilotignore");
    const st = fs.lstatSync(ignorePath);
    if (!st.isFile()) {
      lines.push("WARN  .autopilotignore is not a regular file — using built-in defaults");
    } else {
      lines.push("OK    .autopilotignore");
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      lines.push(
        "WARN  .autopilotignore missing — using built-in defaults; run upgrade to add",
      );
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push(
        `WARN  .autopilotignore unreadable (${safeDisplayToken(msg, "error")}) — using built-in defaults`,
      );
    }
  }

  if (cfg.staleHoursInvalid) {
    // Fail closed: do not claim we "use default" while --prune-stale refuses.
    lines.push("FAIL  session.stale_after_hours invalid — fix or remove the key");
    ok = false;
  }

  const pin = readPinVersion(root);
  if (!pin) {
    lines.push("FAIL  pin.json missing or invalid");
    ok = false;
  } else {
    const pinShown = safeDisplayToken(pin);
    lines.push(`OK    pin.json → ${pinShown}`);
    if (pin !== packageVersion) {
      lines.push(
        `WARN  pin ${pinShown} ≠ package ${safeDisplayToken(packageVersion)} — consider upgrade`,
      );
    }
  }

  const binDir = path.join(root, ".autopilot", "bin");
  const hook = path.join(binDir, "autopilot-harness-hook.mjs");
  let binTrusted = true;
  try {
    assertNotSymlink(binDir, ".autopilot/bin/");
    try {
      const binSt = fs.lstatSync(binDir);
      if (binSt.isDirectory() && !binSt.isSymbolicLink()) {
        assertRealpathInside(root, binDir, ".autopilot/bin/");
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw err;
    }
  } catch (err) {
    binTrusted = false;
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`FAIL  hook bin — ${safeDisplayToken(msg, "unreadable")}`);
    ok = false;
  }
  if (!binTrusted) {
    // bin path already FAILed above
  } else {
    try {
      // lstat/assert — existsSync misses dangling hook symlinks.
      assertNotSymlink(hook, ".autopilot/bin/autopilot-harness-hook.mjs");
      const st = fs.lstatSync(hook);
      if (!st.isFile()) {
        lines.push("FAIL  hook binary is not a regular file");
        ok = false;
      } else {
        lines.push("OK    autopilot-harness-hook.mjs");
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push("FAIL  hook binary missing");
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  hook binary — ${safeDisplayToken(msg, "unreadable")}`,
        );
      }
      ok = false;
    }
  }

  const vendorDir = path.join(binDir, "vendor");
  const vendorRuntime = path.join(vendorDir, "runtime.mjs");
  const vendorMigDir = path.join(vendorDir, "migrations");
  const vendorMig = path.join(vendorMigDir, "001_initial.sql");
  try {
    assertNotSymlink(vendorDir, ".autopilot/bin/vendor/");
    assertNotSymlink(vendorRuntime, ".autopilot/bin/vendor/runtime.mjs");
    assertNotSymlink(vendorMigDir, ".autopilot/bin/vendor/migrations/");
    assertNotSymlink(
      vendorMig,
      ".autopilot/bin/vendor/migrations/001_initial.sql",
    );
    try {
      const vendSt = fs.lstatSync(vendorDir);
      if (vendSt.isDirectory() && !vendSt.isSymbolicLink()) {
        assertRealpathInside(root, vendorDir, ".autopilot/bin/vendor/");
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw err;
    }
    // lstat isFile: existsSync follows pointing symlinks and lies on dangling.
    let vendorPresent = false;
    try {
      const rt = fs.lstatSync(vendorRuntime);
      const mig = fs.lstatSync(vendorMig);
      if (rt.isSymbolicLink() || mig.isSymbolicLink()) {
        throw new Error("hook vendor path is a symlink; refusing to open");
      }
      vendorPresent = rt.isFile() && mig.isFile();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw err;
      vendorPresent = false;
    }
    if (!vendorPresent) {
      lines.push(
        "FAIL  hook vendor runtime missing — run upgrade (or init --force)",
      );
      ok = false;
    } else if (binTrusted) {
      lines.push("OK    hook vendor runtime");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(
      `FAIL  hook vendor — ${safeDisplayToken(msg, "unreadable")}`,
    );
    ok = false;
  }

  const hooksPath = path.join(root, ".cursor", "hooks.json");
  const wantCursor = configWantsInstallableHost(cfg.platforms, "cursor");
  const wantClaude = configWantsInstallableHost(cfg.platforms, "claude-code");
  const wantCodex = configWantsInstallableHost(cfg.platforms, "codex");

  if (wantCursor) {
    try {
      // Avoid existsSync: dangling symlinks look missing but must FAIL as unreadable.
      const raw = readUntrustedUtf8File(
        hooksPath,
        MAX_CONFIG_BYTES,
        ".cursor/hooks.json",
      );
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lines.push("FAIL  hooks.json is not a JSON object");
        ok = false;
      } else {
        const hooks = parsed as HooksFile;
        const shapeError = validateHooksShape(
          hooks.hooks ? hooks : { version: 1, hooks: {} },
        );
        if (shapeError) {
          lines.push(`FAIL  ${safeDisplayToken(shapeError, "invalid hooks.json")}`);
          ok = false;
        } else {
          const { missingEvents, duplicates } = summarizeAutopilotHooks(hooks);
          if (missingEvents.length > 0) {
            lines.push(
              `FAIL  hooks.json missing Autopilot for: ${missingEvents.join(", ")} — run init --force`,
            );
            ok = false;
          }
          if (duplicates > 0) {
            lines.push(
              `WARN  hooks.json has ${duplicates} duplicate Autopilot entr(y/ies)`,
            );
          }
          // Warn even when other events are missing/duplicated — stop / subagentStop
          // can still be present without loop_limit:null and get Cursor-capped.
          if (
            !missingEvents.includes("stop") &&
            !autopilotStopHasUnlimitedLoop(hooks)
          ) {
            lines.push(
              "WARN  Autopilot stop missing loop_limit:null — Cursor defaults to 5 and may skip mid review chain; run upgrade",
            );
          }
          if (
            !missingEvents.includes("subagentStop") &&
            !autopilotSubagentStopHasUnlimitedLoop(hooks)
          ) {
            lines.push(
              "WARN  Autopilot subagentStop missing loop_limit:null — Cursor defaults to 5; run upgrade",
            );
          }
          if (
            missingEvents.length === 0 &&
            !cursorHooksHavePlatformStamp(hooks)
          ) {
            lines.push(
              "WARN  Autopilot hooks missing --platform cursor — run upgrade",
            );
          }
          if (
            missingEvents.length === 0 &&
            duplicates === 0 &&
            autopilotStopHasUnlimitedLoop(hooks) &&
            autopilotSubagentStopHasUnlimitedLoop(hooks) &&
            cursorHooksHavePlatformStamp(hooks)
          ) {
            lines.push("OK    hooks.json Autopilot entries");
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push("FAIL  .cursor/hooks.json missing");
        ok = false;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  hooks.json unreadable (${safeDisplayToken(msg, "error")})`,
        );
        ok = false;
      }
    }
  }

  if (wantClaude) {
    const claudeSettingsPath = path.join(root, ".claude", "settings.json");
    try {
      const raw = readUntrustedUtf8File(
        claudeSettingsPath,
        MAX_CONFIG_BYTES,
        ".claude/settings.json",
      );
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lines.push("FAIL  .claude/settings.json is not a JSON object");
        ok = false;
      } else {
        const settings = parsed as ClaudeSettingsFile;
        const shapeError = validateClaudeSettingsShape(settings);
        if (shapeError) {
          lines.push(
            `FAIL  ${safeDisplayToken(shapeError, "invalid settings.json")}`,
          );
          ok = false;
        } else {
          const { missingEvents, duplicates } =
            summarizeClaudeAutopilotHooks(settings);
          if (missingEvents.length > 0) {
            lines.push(
              `FAIL  settings.json missing Autopilot for: ${missingEvents.join(", ")} — run init --force`,
            );
            ok = false;
          }
          if (duplicates > 0) {
            lines.push(
              `WARN  settings.json has ${duplicates} duplicate Autopilot entr(y/ies)`,
            );
          }
          if (!hasClaudeBlockCapZero(settings)) {
            lines.push(
              "WARN  CLAUDE_CODE_STOP_HOOK_BLOCK_CAP missing or not 0 — Stop may be capped mid review chain; run upgrade",
            );
          }
          if (
            missingEvents.length === 0 &&
            !claudeHooksHavePlatformStamp(settings)
          ) {
            lines.push(
              "WARN  Autopilot Claude hooks missing --platform claude-code — run upgrade",
            );
          }
          if (
            missingEvents.length === 0 &&
            duplicates === 0 &&
            hasClaudeBlockCapZero(settings) &&
            claudeHooksHavePlatformStamp(settings)
          ) {
            lines.push("OK    .claude/settings.json Autopilot entries");
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push("FAIL  .claude/settings.json missing");
        ok = false;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  settings.json unreadable (${safeDisplayToken(msg, "error")})`,
        );
        ok = false;
      }
    }
  }

  if (wantCodex) {
    const codexHooksPath = path.join(root, ".codex", "hooks.json");
    try {
      const raw = readUntrustedUtf8File(
        codexHooksPath,
        MAX_CONFIG_BYTES,
        ".codex/hooks.json",
      );
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lines.push("FAIL  .codex/hooks.json is not a JSON object");
        ok = false;
      } else {
        const file = parsed as CodexHooksFile;
        const shapeError = validateCodexHooksShape(file);
        if (shapeError) {
          lines.push(
            `FAIL  .codex/hooks.json: ${safeDisplayToken(shapeError, "invalid shape")}`,
          );
          ok = false;
        } else {
          const { missingEvents, duplicates } =
            summarizeCodexAutopilotHooks(file);
          if (missingEvents.length > 0) {
            lines.push(
              `FAIL  .codex/hooks.json missing Autopilot for: ${missingEvents.join(", ")} — run init --force`,
            );
            ok = false;
          }
          if (duplicates > 0) {
            lines.push(
              `WARN  .codex/hooks.json has ${duplicates} duplicate Autopilot entr(y/ies)`,
            );
          }
          if (codexAutopilotHasSmallTimeout(file)) {
            lines.push(
              "WARN  Autopilot Codex hook timeout set below 120s — omit timeout (Codex default 600s) or raise it; run upgrade",
            );
          }
          if (
            missingEvents.length === 0 &&
            !codexHooksHavePlatformStamp(file)
          ) {
            lines.push(
              "WARN  Autopilot Codex hooks missing --platform codex — run upgrade",
            );
          }
          // Informational: Codex requires project hook trust via /hooks (re-trust after upgrade).
          if (missingEvents.length === 0) {
            lines.push(
              "WARN  Codex project hooks need /hooks trust (re-trust after install or upgrade)",
            );
          }
          if (
            missingEvents.length === 0 &&
            duplicates === 0 &&
            !codexAutopilotHasSmallTimeout(file) &&
            codexHooksHavePlatformStamp(file)
          ) {
            lines.push("OK    .codex/hooks.json Autopilot entries");
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push("FAIL  .codex/hooks.json missing");
        ok = false;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  .codex/hooks.json unreadable (${safeDisplayToken(msg, "error")})`,
        );
        ok = false;
      }
    }
  }

  const wantKimi = configWantsInstallableHost(cfg.platforms, "kimi-code");
  if (wantKimi) {
    const injectHome = opts.kimiCodeHome;
    const kimiHome =
      typeof injectHome === "string" &&
      injectHome &&
      path.isAbsolute(injectHome)
        ? injectHome
        : resolveKimiCodeHome();
    const kimiTomlPath = kimiConfigTomlPath(kimiHome);
    const kimiRead = readKimiConfigToml(kimiTomlPath);
    // Host hard-cap: always surface when this installable host is enabled.
    // Do not imply confirm×5 works on Kimi — recommend / warn toward 1.
    lines.push(
      "WARN  Kimi Code hard-caps Stop-continue at ≤1/turn — prefer confirm_rounds: 1",
    );
    if (cfg.configOk && cfg.confirmRounds > 1) {
      lines.push(
        `WARN  review.confirm_rounds is ${cfg.confirmRounds} but Kimi Stop-continue is ≤1/turn — set confirm_rounds: 1 (runtime clamps to 1)`,
      );
    }
    if (!kimiRead.ok) {
      lines.push(
        `FAIL  Kimi Code config.toml unreadable (${safeDisplayToken(kimiRead.error, "error")})`,
      );
      ok = false;
    } else {
      // Event coverage from droppable [[hooks]] only — comment stamps do not count.
      const missing = kimiAutopilotMissingHookEvents(kimiRead.value);
      const smallTimeout = kimiAutopilotHasSmallTimeout(kimiRead.value);
      if (missing.length > 0) {
        lines.push(
          `WARN  Kimi Code config.toml missing Autopilot for: ${missing.join(", ")} — run init --force`,
        );
      }
      if (smallTimeout) {
        lines.push(
          "WARN  Autopilot Kimi hook timeout below 120s (or omitted; host default 30s) — run upgrade",
        );
      }
      if (missing.length === 0) {
        lines.push(
          "WARN  Kimi Code hooks need host trust/reload after install or upgrade (/hooks if offered)",
        );
      }
      if (missing.length === 0 && !smallTimeout) {
        lines.push("OK    Kimi Code config.toml Autopilot entries");
      }
    }
    const userHome = opts.homeDir ?? os.homedir();
    if (typeof userHome === "string" && userHome && path.isAbsolute(userHome)) {
      const legacyPath = path.join(userHome, ".kimi");
      let hasLegacy = false;
      let hasCodeHome = false;
      try {
        // Real directory only (symlink ≠ Autopilot-usable home; init refuses).
        hasLegacy = fs.lstatSync(legacyPath).isDirectory();
      } catch {
        /* missing */
      }
      try {
        hasCodeHome = fs.lstatSync(kimiHome).isDirectory();
      } catch {
        /* missing */
      }
      if (hasLegacy && !hasCodeHome) {
        lines.push(
          "WARN  legacy ~/.kimi present but Kimi Code home missing — Autopilot uses $KIMI_CODE_HOME or ~/.kimi-code; run init",
        );
      }
    }
  }

  const wantCopilot = configWantsInstallableHost(cfg.platforms, "copilot-cli");
  if (wantCopilot) {
    const copilotHooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    // Host hard-cap: always surface when this installable host is enabled.
    if (!COPILOT_STOP_CAP_RAISE_FOUND) {
      lines.push(
        `WARN  Copilot CLI Stop-continue consecutive block cap ≤${COPILOT_STOP_CONSECUTIVE_BLOCK_CAP} (no raise found) — expect mid-chain cutoffs`,
      );
    }
    try {
      const raw = readUntrustedUtf8File(
        copilotHooksPath,
        MAX_CONFIG_BYTES,
        COPILOT_HOOKS_REL_PATH,
      );
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lines.push(`FAIL  ${COPILOT_HOOKS_REL_PATH} is not a JSON object`);
        ok = false;
      } else {
        const file = parsed as CopilotHooksFile;
        const shapeError = validateCopilotHooksShape(file);
        if (shapeError) {
          lines.push(
            `FAIL  ${COPILOT_HOOKS_REL_PATH}: ${safeDisplayToken(shapeError, "invalid shape")}`,
          );
          ok = false;
        } else {
          const { missingEvents, duplicates } =
            summarizeCopilotAutopilotHooks(file);
          if (missingEvents.length > 0) {
            lines.push(
              `FAIL  ${COPILOT_HOOKS_REL_PATH} missing Autopilot for: ${missingEvents.join(", ")} — run init --force`,
            );
            ok = false;
          }
          if (duplicates > 0) {
            lines.push(
              `WARN  ${COPILOT_HOOKS_REL_PATH} has ${duplicates} duplicate Autopilot entr(y/ies)`,
            );
          }
          if (copilotAutopilotHasSmallTimeout(file)) {
            lines.push(
              `WARN  Autopilot Copilot hook timeoutSec below ${COPILOT_HOOK_TIMEOUT_SEC} (or omitted; host default 30s) — run upgrade`,
            );
          }
          if (
            missingEvents.length === 0 &&
            !copilotHooksHavePlatformStamp(file)
          ) {
            lines.push(
              "WARN  Autopilot Copilot hooks missing --platform copilot-cli — run upgrade",
            );
          }
          // Align with Codex/Kimi reload tips: only after Autopilot event coverage
          // is present (not on missing/corrupt/invalid shape / incomplete install).
          if (missingEvents.length === 0) {
            lines.push(
              "WARN  Restart Copilot CLI after install or upgrade so Autopilot hooks reload",
            );
          }
          // hasComplete ≡ missingEvents+duplicates; keep both for defense in depth.
          if (
            missingEvents.length === 0 &&
            duplicates === 0 &&
            !copilotAutopilotHasSmallTimeout(file) &&
            copilotHooksHavePlatformStamp(file) &&
            hasCompleteCopilotAutopilotHooks(file)
          ) {
            lines.push(
              `OK    ${COPILOT_HOOKS_REL_PATH} Autopilot entries`,
            );
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push(`FAIL  ${COPILOT_HOOKS_REL_PATH} missing`);
        ok = false;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  ${COPILOT_HOOKS_REL_PATH} unreadable (${safeDisplayToken(msg, "error")})`,
        );
        ok = false;
      }
    }
  }

  const wantGrok = configWantsInstallableHost(cfg.platforms, "grok-build");
  if (wantGrok) {
    const grokHooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    // Host hard-cap: always surface when this installable host is enabled.
    if (!GROK_STOP_CAP_RAISE_FOUND) {
      lines.push(
        `WARN  Grok Build Stop-continue per-turn block cap ≤${GROK_STOP_PER_TURN_BLOCK_CAP} (no raise found) — expect mid-chain cutoffs`,
      );
    }
    try {
      const raw = readUntrustedUtf8File(
        grokHooksPath,
        MAX_CONFIG_BYTES,
        GROK_HOOKS_REL_PATH,
      );
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lines.push(`FAIL  ${GROK_HOOKS_REL_PATH} is not a JSON object`);
        ok = false;
      } else {
        const file = parsed as GrokHooksFile;
        const shapeError = validateGrokHooksShape(file);
        if (shapeError) {
          lines.push(
            `FAIL  ${GROK_HOOKS_REL_PATH}: ${safeDisplayToken(shapeError, "invalid shape")}`,
          );
          ok = false;
        } else {
          const { missingEvents, duplicates } =
            summarizeGrokAutopilotHooks(file);
          const badTimeout = grokAutopilotHasOmittedOrSmallTimeout(file);
          const hasStamp = grokHooksHavePlatformStamp(file);
          if (missingEvents.length > 0) {
            lines.push(
              `FAIL  ${GROK_HOOKS_REL_PATH} missing Autopilot for: ${missingEvents.join(", ")} — run init --force`,
            );
            ok = false;
          }
          if (duplicates > 0) {
            lines.push(
              `WARN  ${GROK_HOOKS_REL_PATH} has ${duplicates} duplicate Autopilot entr(y/ies)`,
            );
          }
          if (badTimeout) {
            lines.push(
              `WARN  Autopilot Grok hook timeout below ${GROK_HOOK_TIMEOUT_SEC} (or omitted; host default too low) — run upgrade`,
            );
          }
          if (missingEvents.length === 0 && !hasStamp) {
            lines.push(
              "WARN  Autopilot Grok hooks missing --platform grok-build — run upgrade",
            );
          }
          // Align with Codex/Kimi reload tips: only after Autopilot event coverage
          // is present (not on missing/corrupt/invalid shape / incomplete install).
          if (missingEvents.length === 0) {
            lines.push(
              "WARN  Grok Build project hooks need /hooks-trust or --trust after install or upgrade",
            );
            lines.push(
              "WARN  Reload Grok Build or open a new session after install or upgrade so Autopilot hooks reload",
            );
          }
          // hasComplete ≡ missingEvents+duplicates; keep both for defense in depth.
          if (
            missingEvents.length === 0 &&
            duplicates === 0 &&
            !badTimeout &&
            hasStamp &&
            hasCompleteGrokAutopilotHooks(file)
          ) {
            lines.push(`OK    ${GROK_HOOKS_REL_PATH} Autopilot entries`);
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push(`FAIL  ${GROK_HOOKS_REL_PATH} missing`);
        ok = false;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  ${GROK_HOOKS_REL_PATH} unreadable (${safeDisplayToken(msg, "error")})`,
        );
        ok = false;
      }
    }
  }

  const wantGemini = configWantsInstallableHost(cfg.platforms, "gemini-cli");
  if (wantGemini) {
    const geminiSettingsPath = path.join(root, ".gemini", "settings.json");
    // Host hard-cap: always surface when this installable host is enabled.
    if (!GEMINI_STOP_CAP_RAISE_FOUND) {
      lines.push(
        `WARN  Gemini CLI AfterAgent turn cap ≤${GEMINI_AFTER_AGENT_TURN_CAP} (MAX_TURNS; no raise found) — expect mid-chain cutoffs on long review`,
      );
    }
    lines.push(
      `WARN  Prefer Gemini CLI ≥${GEMINI_MIN_CLI_VERSION_HINT} so AfterAgent retry still fires with stop_hook_active`,
    );
    try {
      const raw = readUntrustedUtf8File(
        geminiSettingsPath,
        MAX_CONFIG_BYTES,
        GEMINI_SETTINGS_REL_PATH,
      );
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lines.push(`FAIL  ${GEMINI_SETTINGS_REL_PATH} is not a JSON object`);
        ok = false;
      } else {
        const file = parsed as GeminiSettingsFile;
        const shapeError = validateGeminiSettingsShape(file);
        if (shapeError) {
          lines.push(
            `FAIL  ${GEMINI_SETTINGS_REL_PATH}: ${safeDisplayToken(shapeError, "invalid shape")}`,
          );
          ok = false;
        } else {
          const { missingEvents, duplicates } =
            summarizeGeminiAutopilotHooks(file);
          const badTimeout = geminiAutopilotHasSmallTimeout(file);
          const hasStamp = geminiHooksHavePlatformStamp(file);
          if (missingEvents.length > 0) {
            lines.push(
              `FAIL  ${GEMINI_SETTINGS_REL_PATH} missing Autopilot for: ${missingEvents.join(", ")} — run init --force`,
            );
            ok = false;
          }
          if (duplicates > 0) {
            lines.push(
              `WARN  ${GEMINI_SETTINGS_REL_PATH} has ${duplicates} duplicate Autopilot entr(y/ies)`,
            );
          }
          if (badTimeout) {
            lines.push(
              `WARN  Autopilot Gemini hook timeout below ${GEMINI_HOOK_TIMEOUT_MS}ms (or omitted) — run upgrade`,
            );
          }
          if (missingEvents.length === 0 && !hasStamp) {
            lines.push(
              "WARN  Autopilot Gemini hooks missing --platform gemini-cli — run upgrade",
            );
          }
          const hooksConfigDisabled =
            geminiHooksConfigEnabledIsFalse(file);
          if (hooksConfigDisabled) {
            lines.push(
              `WARN  ${GEMINI_SETTINGS_REL_PATH} hooksConfig.enabled===false — Autopilot hooks may not run; enable hooks or remove the disable`,
            );
          }
          const disabledNames = geminiAutopilotNamesInHooksConfigDisabled(file);
          if (disabledNames.length > 0) {
            const shown = disabledNames
              .map((n) => safeDisplayToken(n, "name"))
              .join(", ");
            lines.push(
              `WARN  ${GEMINI_SETTINGS_REL_PATH} disabled lists Autopilot name(s): ${shown} — remove from hooksConfig.disabled or legacy hooks.disabled`,
            );
          }
          // Trust/reload tips only after Autopilot event coverage is present.
          if (missingEvents.length === 0) {
            lines.push(
              "WARN  Gemini CLI: /trust (re-trust hooks), check /hooks panel, and ensure folder trust after install or upgrade",
            );
            lines.push(
              "WARN  After Gemini install/upgrade: reload session so Autopilot hooks reload, and run /skills reload so skills appear",
            );
          }
          // Withhold OK when hooksConfig would skip Autopilot (same bar as stamp/timeout).
          if (
            missingEvents.length === 0 &&
            duplicates === 0 &&
            !badTimeout &&
            hasStamp &&
            !hooksConfigDisabled &&
            disabledNames.length === 0 &&
            hasCompleteGeminiAutopilotHooks(file)
          ) {
            lines.push(`OK    ${GEMINI_SETTINGS_REL_PATH} Autopilot entries`);
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push(`FAIL  ${GEMINI_SETTINGS_REL_PATH} missing`);
        ok = false;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  ${GEMINI_SETTINGS_REL_PATH} unreadable (${safeDisplayToken(msg, "error")})`,
        );
        ok = false;
      }
    }
  }

  const wantFactory = configWantsInstallableHost(cfg.platforms, "factory-droid");
  if (wantFactory) {
    const factoryHooksPath = path.join(root, ".factory", "hooks.json");
    // Cap / multi-continue research tip (always when this installable host is enabled).
    if (!FACTORY_DROID_STOP_CAP_RAISE_FOUND) {
      lines.push(
        FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN
          ? "WARN  Factory Droid Stop-continue: no documented raise/hard-cap (research) — multi-block under stop_hook_active live-proved; still no raise knob"
          : "WARN  Factory Droid Stop-continue: no documented raise/hard-cap (research) — expect mid-chain cutoffs or degraded≤1 until live proves multi under stop_hook_active",
      );
    }
    if (
      !FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE ||
      !FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN
    ) {
      if (!FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE) {
        lines.push(
          `WARN  Factory Droid Stop-continue degraded ≤${FACTORY_DROID_DEGRADED_STOP_CONTINUE_CAP} (ALLOW_MULTI_BLOCK_WHEN_ACTIVE=false)`,
        );
      } else if (!FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN) {
        lines.push(
          "WARN  Factory Droid multi-block under stop_hook_active is unproven (live smoke pending) — treat long confirm chains cautiously",
        );
      }
    }
    const projectSettings = tryReadFactorySettingsFlags(
      path.join(root, ".factory", "settings.json"),
      FACTORY_SETTINGS_REL_PATH,
    );
    const factoryHomeDir = opts.homeDir ?? os.homedir();
    const factoryHomeOk =
      typeof factoryHomeDir === "string" &&
      factoryHomeDir.length > 0 &&
      path.isAbsolute(factoryHomeDir);
    // When doctor runs with projectRoot === home (e.g. init in ~), or homeDir is
    // a symlink to the project, home and project .factory paths are the same
    // tree — do not dual-count or false-WARN.
    const factoryHomeDistinct =
      factoryHomeOk && !isSameAbsoluteDir(factoryHomeDir, root);
    const homeSettings = factoryHomeDistinct
      ? tryReadFactorySettingsFlags(
          path.join(factoryHomeDir, ".factory", "settings.json"),
          "~/.factory/settings.json",
        )
      : {
          hooksDisabled: false,
          allowManagedHooksOnly: false,
          hooksContainAutopilot: false,
        };
    try {
      const raw = readUntrustedUtf8File(
        factoryHooksPath,
        MAX_CONFIG_BYTES,
        FACTORY_HOOKS_REL_PATH,
      );
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lines.push(`FAIL  ${FACTORY_HOOKS_REL_PATH} is not a JSON object`);
        ok = false;
      } else {
        const file = parsed as FactoryHooksFile;
        const shapeError = validateFactoryHooksShape(file);
        if (shapeError) {
          lines.push(
            `FAIL  ${FACTORY_HOOKS_REL_PATH}: ${safeDisplayToken(shapeError, "invalid shape")}`,
          );
          ok = false;
        } else {
          const { missingEvents, duplicates } =
            summarizeFactoryAutopilotHooks(file);
          const badTimeout = factoryAutopilotHasOmittedOrSmallTimeout(file);
          const hasStamp = factoryHooksHavePlatformStamp(file);
          const usesProjectDir = factoryHooksUseProjectDirEnv(file);
          if (missingEvents.length > 0) {
            lines.push(
              `FAIL  ${FACTORY_HOOKS_REL_PATH} missing Autopilot for: ${missingEvents.join(", ")} — run init --force`,
            );
            ok = false;
          }
          if (duplicates > 0) {
            lines.push(
              `WARN  ${FACTORY_HOOKS_REL_PATH} has ${duplicates} duplicate Autopilot entr(y/ies)`,
            );
          }
          if (badTimeout) {
            lines.push(
              `WARN  Autopilot Factory hook timeout below ${FACTORY_HOOK_TIMEOUT_SEC} (or omitted; host default too low) — run upgrade`,
            );
          }
          if (missingEvents.length === 0 && !hasStamp) {
            lines.push(
              "WARN  Autopilot Factory hooks missing --platform factory-droid — run upgrade",
            );
          }
          if (missingEvents.length === 0 && !usesProjectDir) {
            lines.push(
              "WARN  Autopilot Factory hooks missing $FACTORY_PROJECT_DIR — run upgrade (Droid cwd ≠ project root)",
            );
          }
          // Trust/reload tips only after Autopilot event coverage is present.
          if (missingEvents.length === 0) {
            lines.push(
              "WARN  Factory Droid: review hooks in /hooks after install or upgrade (session snapshots hooks at startup)",
            );
            lines.push(
              "WARN  Reload Factory Droid or open a new session after install or upgrade so the hooks snapshot refreshes",
            );
          }
          const hooksWontRun =
            projectSettings.hooksDisabled ||
            projectSettings.allowManagedHooksOnly ||
            homeSettings.hooksDisabled ||
            homeSettings.allowManagedHooksOnly;
          // Withhold OK when settings would skip Autopilot (Gemini hooksConfig parity).
          if (
            missingEvents.length === 0 &&
            duplicates === 0 &&
            !badTimeout &&
            hasStamp &&
            usesProjectDir &&
            !hooksWontRun &&
            hasCompleteFactoryAutopilotHooks(file)
          ) {
            lines.push(`OK    ${FACTORY_HOOKS_REL_PATH} Autopilot entries`);
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push(`FAIL  ${FACTORY_HOOKS_REL_PATH} missing`);
        ok = false;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  ${FACTORY_HOOKS_REL_PATH} unreadable (${safeDisplayToken(msg, "error")})`,
        );
        ok = false;
      }
    }

    // Legacy nested path + project settings flags / misplaced Autopilot.
    if (
      factoryFileHasAutopilotFingerprint(
        path.join(root, ".factory", "hooks", "hooks.json"),
        FACTORY_LEGACY_HOOKS_REL_PATH,
      )
    ) {
      lines.push(
        `WARN  legacy ${FACTORY_LEGACY_HOOKS_REL_PATH} still has Autopilot — prefer ${FACTORY_HOOKS_REL_PATH}; open /hooks and save to migrate (Autopilot does not dual-write)`,
      );
    }
    if (projectSettings.hooksDisabled) {
      lines.push(
        `WARN  ${FACTORY_SETTINGS_REL_PATH} hooksDisabled===true — Autopilot hooks will not run; toggle in /hooks or /settings`,
      );
    }
    if (projectSettings.allowManagedHooksOnly) {
      lines.push(
        `WARN  ${FACTORY_SETTINGS_REL_PATH} allowManagedHooksOnly===true — org policy drops project/user hooks; Autopilot project hooks will not load`,
      );
    }
    if (projectSettings.hooksContainAutopilot) {
      lines.push(
        `WARN  ${FACTORY_SETTINGS_REL_PATH} hooks still list Autopilot — move to ${FACTORY_HOOKS_REL_PATH} and review in /hooks (Autopilot does not migrate settings.json)`,
      );
    }

    // User-home Factory residual / settings flags (never edited by Autopilot).
    // Reuse the same absolute-home settings snapshot used for OK gating.
    // Skip when home === projectRoot (same .factory tree as project checks).
    if (factoryHomeDistinct) {
      if (
        factoryFileHasAutopilotFingerprint(
          path.join(factoryHomeDir, ".factory", "hooks.json"),
          "~/.factory/hooks.json",
        )
      ) {
        lines.push(
          "WARN  ~/.factory/hooks.json has Autopilot — may double-load with project hooks; remove user-home Autopilot or rely on project .factory/hooks.json only",
        );
      }
      if (homeSettings.hooksDisabled) {
        lines.push(
          "WARN  ~/.factory/settings.json hooksDisabled===true — Autopilot hooks will not run; toggle in /hooks or /settings",
        );
      }
      if (homeSettings.allowManagedHooksOnly) {
        lines.push(
          "WARN  ~/.factory/settings.json allowManagedHooksOnly===true — org policy drops project/user hooks; Autopilot project hooks will not load",
        );
      }
      if (homeSettings.hooksContainAutopilot) {
        lines.push(
          "WARN  ~/.factory/settings.json hooks still list Autopilot — move to project .factory/hooks.json and review in /hooks",
        );
      }
    }
  }

  const wantDevin = configWantsInstallableHost(cfg.platforms, "devin");
  if (wantDevin) {
    const devinHooksPath = path.join(root, ".devin", "hooks.v1.json");
    if (!DEVIN_STOP_CAP_RAISE_FOUND) {
      lines.push(
        "WARN  Devin CLI Stop-continue: no documented raise/hard-cap (research) — interactive CLI live continue ≥1× proved; no numeric cap",
      );
    }
    lines.push(
      "WARN  Devin CLI: review hooks in /hooks after install or upgrade, then start a new session",
    );
    lines.push(
      "WARN  Devin tip: Autopilot surface is interactive CLI — Stop-under-`-p` / print is unproven (not a FAIL)",
    );
    lines.push(
      "WARN  Devin tip: CLI only — Desktop not tested; same .devin/ files may be readable there (not a FAIL)",
    );
    if (process.env.DEVIN_SANDBOX) {
      lines.push(
        "WARN  DEVIN_SANDBOX is set — sandbox wraps exec-tool processes; whether Autopilot hook children can write .autopilot/ is unproven",
      );
    }
    const devinVer = probeDevinCliVersion();
    if (!devinVer) {
      lines.push(
        "WARN  devin CLI not found on PATH (or --version unreadable) — soft min " +
          DEVIN_SOFT_MIN_VERSION,
      );
    } else if (!isParseableDevinVersion(devinVer)) {
      lines.push(
        `WARN  devin version unparseable (${safeDisplayToken(devinVer)}) — trust the live CLI; soft min ${DEVIN_SOFT_MIN_VERSION}`,
      );
    } else if (isDevinVersionBelowSoftMin(devinVer)) {
      lines.push(
        `WARN  devin ${safeDisplayToken(devinVer)} is below soft min ${DEVIN_SOFT_MIN_VERSION} — upgrade Devin when possible`,
      );
    } else {
      lines.push(
        `OK    devin ${safeDisplayToken(devinVer)} (>= soft min ${DEVIN_SOFT_MIN_VERSION})`,
      );
    }
    try {
      const raw = readUntrustedUtf8File(
        devinHooksPath,
        MAX_CONFIG_BYTES,
        DEVIN_HOOKS_REL_PATH,
      );
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lines.push(`FAIL  ${DEVIN_HOOKS_REL_PATH} is not a JSON object`);
        ok = false;
      } else {
        const file = parsed as DevinHooksFile;
        const shapeError = validateDevinHooksShape(file);
        if (shapeError) {
          lines.push(
            `FAIL  ${DEVIN_HOOKS_REL_PATH}: ${safeDisplayToken(shapeError, "invalid shape")}`,
          );
          ok = false;
        } else {
          const { missingEvents, duplicates } =
            summarizeDevinAutopilotHooks(file);
          const badTimeout = devinAutopilotHasOmittedOrSmallTimeout(file);
          const hasStamp = devinHooksHavePlatformStamp(file);
          const usesProjectDir = devinHooksUseProjectDirEnv(file);
          if (missingEvents.length > 0) {
            lines.push(
              `FAIL  ${DEVIN_HOOKS_REL_PATH} missing Autopilot for: ${missingEvents.join(", ")} — run init --force`,
            );
            ok = false;
          }
          if (duplicates > 0) {
            lines.push(
              `WARN  ${DEVIN_HOOKS_REL_PATH} has ${duplicates} duplicate Autopilot entr(y/ies)`,
            );
          }
          if (badTimeout) {
            lines.push(
              `WARN  Autopilot Devin hook timeout below ${DEVIN_HOOK_TIMEOUT_SEC} (or omitted) — run upgrade`,
            );
          }
          if (missingEvents.length === 0 && !hasStamp) {
            lines.push(
              "WARN  Autopilot Devin hooks missing --platform devin — run upgrade",
            );
          }
          if (missingEvents.length === 0 && !usesProjectDir) {
            lines.push(
              "WARN  Autopilot Devin hooks missing $DEVIN_PROJECT_DIR — run upgrade (hook cwd ≠ project root)",
            );
          }
          if (
            missingEvents.length === 0 &&
            duplicates === 0 &&
            !badTimeout &&
            hasStamp &&
            usesProjectDir &&
            hasCompleteDevinAutopilotHooks(file)
          ) {
            lines.push(`OK    ${DEVIN_HOOKS_REL_PATH} Autopilot entries`);
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push(`FAIL  ${DEVIN_HOOKS_REL_PATH} missing`);
        ok = false;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  ${DEVIN_HOOKS_REL_PATH} unreadable (${safeDisplayToken(msg, "error")})`,
        );
        ok = false;
      }
    }

    // Misplaced Autopilot under .devin/config.json (Autopilot never writes this).
    try {
      const raw = readUntrustedUtf8File(
        path.join(root, ".devin", "config.json"),
        MAX_CONFIG_BYTES,
        DEVIN_CONFIG_REL_PATH,
      );
      const parsed: unknown = JSON.parse(raw);
      if (devinConfigJsonContainsAutopilot(parsed)) {
        lines.push(
          `WARN  ${DEVIN_CONFIG_REL_PATH} hooks still list Autopilot — move to ${DEVIN_HOOKS_REL_PATH} (Autopilot does not write config.json hooks)`,
        );
      }
    } catch {
      /* missing/unreadable — ignore */
    }

    // Skills dual-open: Autopilot under both .devin/skills and .agents/skills.
    // Real file inside the project only — a symlink escape is not dual-open.
    let hasDevinSkills = false;
    let hasAgentsSkills = false;
    const skillInProject = (skillPath: string): boolean => {
      const st = fs.lstatSync(skillPath);
      if (st.isSymbolicLink() || !st.isFile()) return false;
      assertRealpathInside(root, skillPath, skillPath);
      return true;
    };
    for (const name of SKILL_NAMES) {
      try {
        if (
          skillInProject(path.join(root, ".devin", "skills", name, "SKILL.md"))
        ) {
          hasDevinSkills = true;
        }
      } catch {
        /* missing / escape */
      }
      try {
        if (
          skillInProject(path.join(root, ".agents", "skills", name, "SKILL.md"))
        ) {
          hasAgentsSkills = true;
        }
      } catch {
        /* missing / escape */
      }
    }
    if (hasDevinSkills && hasAgentsSkills) {
      lines.push(
        "WARN  Autopilot skills under both .devin/skills and .agents/skills — dual discovery; prefer .devin/skills for Devin (`.agents/skills` is also used by Antigravity/Pi/Codex/Kimi)",
      );
    }
  } else {
    // When Claude is also enabled, the dual-fingerprint block below names the
    // residue more accurately (config.json is not uninstallable).
    const residue = projectDevinAutopilotResidue(root);
    if (!wantClaude) {
      if (residue.hooksBlocked) {
        lines.push(
          `WARN  leftover ${DEVIN_HOOKS_REL_PATH} Autopilot is an invalid shape (devin not in platforms) — uninstall and add-platform will not strip it; fix the file manually`,
        );
      }
      if (residue.hooksStrippable && residue.configJson) {
        lines.push(
          `WARN  leftover Devin Autopilot in ${DEVIN_HOOKS_REL_PATH} and ${DEVIN_CONFIG_REL_PATH} (devin not in platforms) — uninstall strips hooks.v1.json only; remove config.json Autopilot manually or add-platform devin`,
        );
      } else if (residue.hooksStrippable) {
        lines.push(
          `WARN  leftover ${DEVIN_HOOKS_REL_PATH} Autopilot fingerprint (devin not in platforms) — uninstall or add-platform devin`,
        );
      } else if (residue.configJson) {
        lines.push(
          `WARN  leftover ${DEVIN_CONFIG_REL_PATH} Autopilot hooks (devin not in platforms) — Autopilot does not strip config.json; remove manually or add-platform devin`,
        );
      }
    }
  }

  const wantHermes = configWantsInstallableHost(cfg.platforms, "hermes-agent");
  if (wantHermes) {
    const injectHermesHome = opts.hermesHome;
    const hermesHome =
      typeof injectHermesHome === "string" &&
      injectHermesHome &&
      path.isAbsolute(injectHermesHome)
        ? injectHermesHome
        : resolveHermesHome();
    const hermesYamlPath = hermesConfigYamlPath(hermesHome);
    // Always-on tips when this installable host is enabled (consent / multi-repo /
    // edit-only / plugin order / host doctor CLI).
    lines.push(
      "WARN  Hermes Agent $HERMES_HOME is shared across repos (default ~/.hermes; hooks in config.yaml + skills/) — multi-repo installs share one home; keep relative node .autopilot/bin/… commands",
    );
    lines.push(
      "WARN  Hermes consent/non-TTY: approve hooks at TTY or use --accept-hooks / HERMES_ACCEPT_HOOKS (Autopilot does not set hooks_auto_accept)",
    );
    lines.push(
      "WARN  Hermes pre_verify is edit-only — no product edit that turn → pending/RESUME (not a Stop continue)",
    );
    lines.push(
      "WARN  Hermes plugins run before shell hooks (first continue wins) — disable conflicting plugins or expect routing care",
    );
    const hermesRead = readHermesConfigYaml(hermesYamlPath);
    if (!hermesRead.ok) {
      lines.push(
        `FAIL  Hermes config.yaml unreadable (${safeDisplayToken(hermesRead.error, "error")})`,
      );
      ok = false;
    } else {
      try {
        const file = parseHermesConfigYaml(hermesRead.value);
        const { missingEvents, duplicates } =
          summarizeHermesAutopilotHooks(file);
        const complete = hasCompleteHermesAutopilotHooks(file);
        const hasStamp = hermesHooksHavePlatformStamp(file);
        const hasPostMatcher = hermesAutopilotHasExpectedPostMatcher(file);
        const badTimeout = hermesAutopilotHasOmittedOrSmallTimeout(file);
        const nudge = readHermesMaxVerifyNudges(file);
        const nudgeFloor = hermesConfigHasVerifyNudgeFloor(file);
        // FAIL 缺指纹 (missing events). Duplicates alone stay WARN — same as
        // Factory/Gemini/Grok (hasComplete folds duplicates but must not FAIL).
        if (missingEvents.length > 0) {
          lines.push(
            `FAIL  Hermes config.yaml missing/incomplete Autopilot for: ${missingEvents.join(", ")} — run init --force`,
          );
          ok = false;
        } else if (!hasStamp || !hasPostMatcher) {
          // FAIL 残指纹 (stamp/matcher/leftover) — checklist; not a soft WARN.
          lines.push(
            "FAIL  Hermes config.yaml Autopilot fingerprint incomplete (stamp/matcher/leftover) — run init --force",
          );
          ok = false;
        }
        if (duplicates > 0) {
          lines.push(
            `WARN  Hermes config.yaml has ${duplicates} duplicate Autopilot entr(y/ies)`,
          );
        }
        if (badTimeout) {
          lines.push(
            `WARN  Autopilot Hermes hook timeout below ${HERMES_HOOK_TIMEOUT_SEC} (or omitted; host default 60s) — run upgrade`,
          );
        }
        if (!nudgeFloor) {
          if (nudge === 3) {
            lines.push(
              `WARN  agent.max_verify_nudges is still ${nudge} (stock default) — Autopilot init raises to ≥${HERMES_MAX_VERIFY_NUDGES}; run upgrade`,
            );
          } else if (nudge == null) {
            lines.push(
              `WARN  agent.max_verify_nudges missing — Autopilot init raises to ≥${HERMES_MAX_VERIFY_NUDGES}; run upgrade`,
            );
          } else {
            lines.push(
              `WARN  agent.max_verify_nudges is ${nudge} (<${HERMES_MAX_VERIFY_NUDGES}) — run upgrade`,
            );
          }
        }
        if (missingEvents.length === 0) {
          lines.push(
            "WARN  After Hermes install/upgrade: reload Hermes and run hermes hooks doctor",
          );
        }
        if (
          complete &&
          hasStamp &&
          !badTimeout &&
          nudgeFloor &&
          duplicates === 0
        ) {
          lines.push("OK    Hermes config.yaml Autopilot entries");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (hermesConfigYamlContainsAutopilot(hermesRead.value)) {
          lines.push(
            `FAIL  Hermes config.yaml has Autopilot fingerprint but invalid shape (${safeDisplayToken(msg, "invalid")}) — run init --force`,
          );
        } else {
          lines.push(
            `FAIL  Hermes config.yaml invalid (${safeDisplayToken(msg, "invalid")})`,
          );
        }
        ok = false;
      }
    }
  }

  const wantAntigravity = configWantsInstallableHost(
    cfg.platforms,
    "antigravity",
  );
  if (wantAntigravity) {
    const antigravityHooksPath = path.join(root, ".agents", "hooks.json");
    // Cap / IDE / CLI workspace / auto-attach tips always when this installable host is enabled.
    if (!ANTIGRAVITY_STOP_CAP_RAISE_FOUND) {
      lines.push(
        "WARN  Antigravity Stop-continue: no documented raise/hard-cap (research) — expect mid-chain cutoffs on long review",
      );
    }
    lines.push(
      "WARN  Antigravity IDE tip: hooks may stay silent until reload — prefer a firing surface (CLI) or reload IDE after install/upgrade",
    );
    lines.push(
      "WARN  Antigravity CLI tip: mount the instrumented project as a workspace (e.g. --add-dir / open the folder) or hooks may not load (loaded 0)",
    );
    lines.push(
      "WARN  Auto-attach ≠ Autopilot ON — still run /autopilot-on or a line-start trigger after skills appear",
    );
    try {
      const raw = readUntrustedUtf8File(
        antigravityHooksPath,
        MAX_CONFIG_BYTES,
        ANTIGRAVITY_HOOKS_REL_PATH,
      );
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lines.push(`FAIL  ${ANTIGRAVITY_HOOKS_REL_PATH} is not a JSON object`);
        ok = false;
      } else {
        const file = parsed as AntigravityHooksFile;
        const shapeError = validateAntigravityHooksShape(file);
        if (shapeError) {
          lines.push(
            `FAIL  ${ANTIGRAVITY_HOOKS_REL_PATH}: ${safeDisplayToken(shapeError, "invalid shape")}`,
          );
          ok = false;
        } else {
          const { missingEvents, duplicates } =
            summarizeAntigravityAutopilotHooks(file);
          const badTimeout = antigravityAutopilotHasOmittedOrSmallTimeout(file);
          const hasStamp = antigravityHooksHavePlatformStamp(file);
          const usesRelative = antigravityHooksUseRelativeCommand(file);
          const hasPostMatcher =
            antigravityAutopilotHasExpectedPostMatcher(file);
          let shimFileMissingOrBad = false;
          const blockRaw = file[ANTIGRAVITY_HOOK_BLOCK_NAME];
          const blockDisabled =
            blockRaw &&
            typeof blockRaw === "object" &&
            !Array.isArray(blockRaw) &&
            (blockRaw as { enabled?: unknown }).enabled === false;
          if (missingEvents.length > 0) {
            lines.push(
              `FAIL  ${ANTIGRAVITY_HOOKS_REL_PATH} missing Autopilot for: ${missingEvents.join(", ")} — run init --force`,
            );
            ok = false;
          } else if (!hasStamp || !hasPostMatcher) {
            // FAIL 残指纹 (stamp/matcher) — checklist; not a soft WARN.
            lines.push(
              `FAIL  ${ANTIGRAVITY_HOOKS_REL_PATH} Autopilot fingerprint incomplete (stamp/matcher) — run init --force`,
            );
            ok = false;
          }
          if (duplicates > 0) {
            lines.push(
              `WARN  ${ANTIGRAVITY_HOOKS_REL_PATH} has ${duplicates} duplicate Autopilot entr(y/ies)`,
            );
          }
          if (badTimeout) {
            lines.push(
              `WARN  Autopilot Antigravity hook timeout below ${ANTIGRAVITY_HOOK_TIMEOUT_SEC} (or omitted) — run upgrade`,
            );
          }
          if (missingEvents.length === 0 && !usesRelative) {
            lines.push(
              "WARN  Autopilot Antigravity hooks missing .agents/bin shim (or legacy .autopilot/bin) relative command — run upgrade",
            );
          }
          if (
            missingEvents.length === 0 &&
            antigravityHooksUseShimCommand(file)
          ) {
            const shimPath = path.join(
              root,
              ...ANTIGRAVITY_HOOK_SHIM_REL_PATH.split("/"),
            );
            try {
              assertNotSymlink(shimPath, ANTIGRAVITY_HOOK_SHIM_REL_PATH);
              const shimSt = fs.lstatSync(shimPath);
              if (!shimSt.isFile()) {
                shimFileMissingOrBad = true;
                lines.push(
                  `WARN  ${ANTIGRAVITY_HOOK_SHIM_REL_PATH} is not a regular file — run upgrade`,
                );
              }
            } catch (err) {
              shimFileMissingOrBad = true;
              const code = (err as NodeJS.ErrnoException)?.code;
              if (code === "ENOENT") {
                lines.push(
                  `WARN  ${ANTIGRAVITY_HOOK_SHIM_REL_PATH} missing — run upgrade`,
                );
              } else {
                const msg = err instanceof Error ? err.message : String(err);
                lines.push(
                  `WARN  ${ANTIGRAVITY_HOOK_SHIM_REL_PATH} unreadable (${safeDisplayToken(msg, "error")}) — run upgrade`,
                );
              }
            }
          }
          if (blockDisabled) {
            lines.push(
              `WARN  ${ANTIGRAVITY_HOOKS_REL_PATH} Autopilot block enabled===false — enable or run init --force`,
            );
          }
          // Reload tip only when Autopilot coverage + runnable fingerprint are present
          // (wrong stamp/matcher/disabled/non-relative/missing shim → init --force / enable / upgrade, not reload).
          if (
            missingEvents.length === 0 &&
            hasStamp &&
            hasPostMatcher &&
            !blockDisabled &&
            usesRelative &&
            !shimFileMissingOrBad
          ) {
            lines.push(
              "WARN  Reload Antigravity or open a new session after install or upgrade so Autopilot hooks reload",
            );
          }
          if (
            missingEvents.length === 0 &&
            duplicates === 0 &&
            !badTimeout &&
            hasStamp &&
            usesRelative &&
            hasPostMatcher &&
            !blockDisabled &&
            !shimFileMissingOrBad &&
            hasCompleteAntigravityAutopilotHooks(file)
          ) {
            lines.push(`OK    ${ANTIGRAVITY_HOOKS_REL_PATH} Autopilot entries`);
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push(`FAIL  ${ANTIGRAVITY_HOOKS_REL_PATH} missing`);
        ok = false;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  ${ANTIGRAVITY_HOOKS_REL_PATH} unreadable (${safeDisplayToken(msg, "error")})`,
        );
        ok = false;
      }
    }
  }

  // Dual Claude + Copilot Autopilot fingerprints (config and/or on-disk residue).
  if (wantClaude && wantCopilot) {
    lines.push(
      "WARN  Claude Code + Copilot CLI both enabled — dual Autopilot fingerprints; prefer one host or expect Stop routing care",
    );
  } else {
    let claudeFp = false;
    let copilotFp = false;
    if (!wantClaude) {
      try {
        const raw = readUntrustedUtf8File(
          path.join(root, ".claude", "settings.json"),
          MAX_CONFIG_BYTES,
          ".claude/settings.json",
        );
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          claudeFp = claudeSettingsContainAutopilot(
            parsed as ClaudeSettingsFile,
          );
        }
      } catch {
        /* missing/unreadable leftover — ignore for dual-fingerprint WARN */
      }
    }
    if (!wantCopilot) {
      try {
        const raw = readUntrustedUtf8File(
          path.join(root, ".github", "hooks", "autopilot-harness.json"),
          MAX_CONFIG_BYTES,
          COPILOT_HOOKS_REL_PATH,
        );
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          copilotFp = copilotHooksContainAutopilot(
            parsed as CopilotHooksFile,
          );
        }
      } catch {
        /* missing/unreadable leftover — ignore */
      }
    }
    // When one host is wanted, the other fingerprint is leftover residue.
    // When neither is wanted but both leftovers remain, still surface dual-FP.
    if (wantClaude && copilotFp) {
      lines.push(
        "WARN  Copilot Autopilot hooks present while Claude Code is enabled — dual fingerprints; uninstall Copilot or expect Stop routing care",
      );
    }
    if (wantCopilot && claudeFp) {
      lines.push(
        "WARN  Claude Autopilot hooks present while Copilot CLI is enabled — dual fingerprints; uninstall Claude hooks or expect Stop routing care",
      );
    }
    if (!wantClaude && !wantCopilot && claudeFp && copilotFp) {
      lines.push(
        "WARN  Claude + Copilot Autopilot fingerprints both present on disk — dual fingerprints; uninstall leftovers or expect Stop routing care",
      );
    }
  }

  // Dual Grok + Claude Autopilot fingerprints (config and/or on-disk residue).
  // Shared leftover read when Grok is not enabled (Claude/Cursor dual blocks).
  const grokLeftoverFp = wantGrok
    ? false
    : projectHasGrokAutopilotFingerprint(root);
  if (wantGrok && wantClaude) {
    lines.push(
      "WARN  Grok Build + Claude Code both enabled — dual Autopilot fingerprints; prefer one host or expect Stop routing care",
    );
  } else {
    let claudeFpVsGrok = false;
    if (!wantClaude) {
      try {
        const raw = readUntrustedUtf8File(
          path.join(root, ".claude", "settings.json"),
          MAX_CONFIG_BYTES,
          ".claude/settings.json",
        );
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          claudeFpVsGrok = claudeSettingsContainAutopilot(
            parsed as ClaudeSettingsFile,
          );
        }
      } catch {
        /* missing/unreadable leftover — ignore */
      }
    }
    if (wantGrok && claudeFpVsGrok) {
      lines.push(
        "WARN  Claude Autopilot hooks present while Grok Build is enabled — dual fingerprints; uninstall Claude hooks or expect Stop routing care",
      );
    }
    if (wantClaude && grokLeftoverFp) {
      lines.push(
        "WARN  Grok Autopilot hooks present while Claude Code is enabled — dual fingerprints; uninstall Grok or expect Stop routing care",
      );
    }
    if (!wantGrok && !wantClaude && grokLeftoverFp && claudeFpVsGrok) {
      lines.push(
        "WARN  Grok + Claude Autopilot fingerprints both present on disk — dual fingerprints; uninstall leftovers or expect Stop routing care",
      );
    }
  }

  // Dual Grok + Cursor Autopilot fingerprints (config and/or on-disk residue).
  if (wantGrok && wantCursor) {
    lines.push(
      "WARN  Grok Build + Cursor both enabled — dual Autopilot fingerprints; prefer one host or expect Stop routing care",
    );
  } else {
    let cursorFpVsGrok = false;
    if (!wantCursor) {
      try {
        const raw = readUntrustedUtf8File(
          path.join(root, ".cursor", "hooks.json"),
          MAX_CONFIG_BYTES,
          ".cursor/hooks.json",
        );
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          cursorFpVsGrok = cursorHooksContainAutopilot(parsed as HooksFile);
        }
      } catch {
        /* missing/unreadable leftover — ignore */
      }
    }
    if (wantGrok && cursorFpVsGrok) {
      lines.push(
        "WARN  Cursor Autopilot hooks present while Grok Build is enabled — dual fingerprints; uninstall Cursor hooks or expect Stop routing care",
      );
    }
    if (wantCursor && grokLeftoverFp) {
      lines.push(
        "WARN  Grok Autopilot hooks present while Cursor is enabled — dual fingerprints; uninstall Grok or expect Stop routing care",
      );
    }
    if (!wantGrok && !wantCursor && grokLeftoverFp && cursorFpVsGrok) {
      lines.push(
        "WARN  Grok + Cursor Autopilot fingerprints both present on disk — dual fingerprints; uninstall leftovers or expect Stop routing care",
      );
    }
  }

  // Dual Gemini + Claude Autopilot fingerprints (config and/or on-disk residue).
  const geminiLeftoverFp = wantGemini
    ? false
    : projectHasGeminiAutopilotFingerprint(root);
  if (wantGemini && wantClaude) {
    lines.push(
      "WARN  Gemini CLI + Claude Code both enabled — dual Autopilot fingerprints; prefer one host or expect Stop routing care",
    );
  } else {
    let claudeFpVsGemini = false;
    if (!wantClaude) {
      try {
        const raw = readUntrustedUtf8File(
          path.join(root, ".claude", "settings.json"),
          MAX_CONFIG_BYTES,
          ".claude/settings.json",
        );
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          claudeFpVsGemini = claudeSettingsContainAutopilot(
            parsed as ClaudeSettingsFile,
          );
        }
      } catch {
        /* missing/unreadable leftover — ignore */
      }
    }
    if (wantGemini && claudeFpVsGemini) {
      lines.push(
        "WARN  Claude Autopilot hooks present while Gemini CLI is enabled — dual fingerprints; uninstall Claude hooks or expect Stop routing care",
      );
    }
    if (wantClaude && geminiLeftoverFp) {
      lines.push(
        "WARN  Gemini Autopilot hooks present while Claude Code is enabled — dual fingerprints; uninstall Gemini or expect Stop routing care",
      );
    }
    if (!wantGemini && !wantClaude && geminiLeftoverFp && claudeFpVsGemini) {
      lines.push(
        "WARN  Gemini + Claude Autopilot fingerprints both present on disk — dual fingerprints; uninstall leftovers or expect Stop routing care",
      );
    }
  }

  // Dual Factory + Claude Autopilot fingerprints (config and/or on-disk residue).
  const factoryLeftoverFp = wantFactory
    ? false
    : projectHasFactoryAutopilotFingerprint(root);
  if (wantFactory && wantClaude) {
    lines.push(
      "WARN  Factory Droid + Claude Code both enabled — dual Autopilot fingerprints; prefer one host or expect Stop routing care",
    );
  } else {
    let claudeFpVsFactory = false;
    if (!wantClaude) {
      try {
        const raw = readUntrustedUtf8File(
          path.join(root, ".claude", "settings.json"),
          MAX_CONFIG_BYTES,
          ".claude/settings.json",
        );
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          claudeFpVsFactory = claudeSettingsContainAutopilot(
            parsed as ClaudeSettingsFile,
          );
        }
      } catch {
        /* missing/unreadable leftover — ignore */
      }
    }
    if (wantFactory && claudeFpVsFactory) {
      lines.push(
        "WARN  Claude Autopilot hooks present while Factory Droid is enabled — dual fingerprints; uninstall Claude hooks or expect Stop routing care",
      );
    }
    if (wantClaude && factoryLeftoverFp) {
      lines.push(
        "WARN  Factory Autopilot hooks present while Claude Code is enabled — dual fingerprints; uninstall Factory or expect Stop routing care",
      );
    }
    if (!wantFactory && !wantClaude && factoryLeftoverFp && claudeFpVsFactory) {
      lines.push(
        "WARN  Factory + Claude Autopilot fingerprints both present on disk — dual fingerprints; uninstall leftovers or expect Stop routing care",
      );
    }
  }

  // Dual Devin + Claude Autopilot fingerprints (config and/or on-disk residue).
  // Devin read_config_from.claude defaults true — both fingerprints can fire.
  // Uninstall strips hooks.v1.json only — never config.json Autopilot.
  const devinResidueWhenIdle = wantDevin
    ? { hooksStrippable: false, hooksBlocked: false, configJson: false }
    : projectDevinAutopilotResidue(root);
  const devinLeftoverFp =
    devinResidueWhenIdle.hooksStrippable ||
    devinResidueWhenIdle.hooksBlocked ||
    devinResidueWhenIdle.configJson;
  if (wantDevin && wantClaude) {
    lines.push(
      "WARN  Devin CLI + Claude Code both enabled — dual Autopilot fingerprints; prefer one host or expect Stop routing care",
    );
  } else {
    let claudeFpVsDevin = false;
    if (!wantClaude) {
      try {
        const raw = readUntrustedUtf8File(
          path.join(root, ".claude", "settings.json"),
          MAX_CONFIG_BYTES,
          ".claude/settings.json",
        );
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          claudeFpVsDevin = claudeSettingsContainAutopilot(
            parsed as ClaudeSettingsFile,
          );
        }
      } catch {
        /* missing/unreadable leftover — ignore */
      }
    }
    if (wantDevin && claudeFpVsDevin) {
      lines.push(
        "WARN  Claude Autopilot hooks present while Devin CLI is enabled — dual fingerprints; uninstall Claude hooks or expect Stop routing care",
      );
    }
    if (wantClaude && devinLeftoverFp) {
      const blocked = devinResidueWhenIdle.hooksBlocked;
      const strippable = devinResidueWhenIdle.hooksStrippable;
      const cfg = devinResidueWhenIdle.configJson;
      if (blocked && !strippable && !cfg) {
        lines.push(
          `WARN  ${DEVIN_HOOKS_REL_PATH} Autopilot is an invalid shape while Claude Code is enabled — dual fingerprints; uninstall will not strip it; fix the file manually or expect Stop routing care`,
        );
      } else if (cfg && !strippable && !blocked) {
        lines.push(
          `WARN  ${DEVIN_CONFIG_REL_PATH} Autopilot hooks present while Claude Code is enabled — dual fingerprints; remove config.json Autopilot manually (uninstall does not strip it) or expect Stop routing care`,
        );
      } else if (cfg && strippable) {
        lines.push(
          "WARN  Devin Autopilot residue (hooks.v1.json + config.json) while Claude Code is enabled — dual fingerprints; uninstall strips hooks.v1.json only; remove config.json Autopilot manually or expect Stop routing care",
        );
      } else if (cfg && blocked) {
        lines.push(
          "WARN  Devin Autopilot residue while Claude Code is enabled — dual fingerprints; invalid hooks.v1.json shape is not stripped by uninstall; remove config.json Autopilot manually or expect Stop routing care",
        );
      } else {
        lines.push(
          "WARN  Devin Autopilot hooks present while Claude Code is enabled — dual fingerprints; uninstall Devin or expect Stop routing care",
        );
      }
    }
    if (!wantDevin && !wantClaude && devinLeftoverFp && claudeFpVsDevin) {
      if (devinResidueWhenIdle.hooksBlocked && !devinResidueWhenIdle.hooksStrippable) {
        const configNote = devinResidueWhenIdle.configJson
          ? "remove config.json Autopilot manually; "
          : "";
        lines.push(
          `WARN  Devin + Claude Autopilot fingerprints both present on disk — dual fingerprints; invalid hooks.v1.json shape is not stripped by uninstall; ${configNote}expect Stop routing care`,
        );
      } else {
        const configNote = devinResidueWhenIdle.configJson
          ? "config.json Autopilot must be removed manually; "
          : "";
        lines.push(
          `WARN  Devin + Claude Autopilot fingerprints both present on disk — dual fingerprints; uninstall leftovers; ${configNote}expect Stop routing care`,
        );
      }
    }
  }

  // Dual Hermes + Claude Autopilot fingerprints (config and/or on-disk residue).
  const hermesInjectHome = opts.hermesHome;
  const hermesProbeHome =
    typeof hermesInjectHome === "string" &&
    hermesInjectHome &&
    path.isAbsolute(hermesInjectHome)
      ? hermesInjectHome
      : resolveHermesHome();
  const hermesLeftoverFp = wantHermes
    ? false
    : (() => {
        try {
          const read = readHermesConfigYaml(
            hermesConfigYamlPath(hermesProbeHome),
          );
          return read.ok && hermesConfigYamlContainsAutopilot(read.value);
        } catch {
          return false;
        }
      })();
  if (wantHermes && wantClaude) {
    lines.push(
      "WARN  Hermes Agent + Claude Code both enabled — dual Autopilot fingerprints; prefer one host or expect Stop routing care",
    );
  } else {
    let claudeFpVsHermes = false;
    if (!wantClaude) {
      try {
        const raw = readUntrustedUtf8File(
          path.join(root, ".claude", "settings.json"),
          MAX_CONFIG_BYTES,
          ".claude/settings.json",
        );
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          claudeFpVsHermes = claudeSettingsContainAutopilot(
            parsed as ClaudeSettingsFile,
          );
        }
      } catch {
        /* missing/unreadable leftover — ignore */
      }
    }
    if (wantHermes && claudeFpVsHermes) {
      lines.push(
        "WARN  Claude Autopilot hooks present while Hermes Agent is enabled — dual fingerprints; uninstall Claude hooks or expect Stop routing care",
      );
    }
    if (wantClaude && hermesLeftoverFp) {
      lines.push(
        "WARN  Hermes Autopilot hooks present while Claude Code is enabled — dual fingerprints; uninstall Hermes or expect Stop routing care",
      );
    }
    if (!wantHermes && !wantClaude && hermesLeftoverFp && claudeFpVsHermes) {
      lines.push(
        "WARN  Hermes + Claude Autopilot fingerprints both present on disk — dual fingerprints; uninstall leftovers or expect Stop routing care",
      );
    }
  }

  // Dual Antigravity + Claude Autopilot fingerprints.
  const antigravityLeftoverFp = wantAntigravity
    ? false
    : projectHasAntigravityAutopilotFingerprint(root);
  if (wantAntigravity && wantClaude) {
    lines.push(
      "WARN  Antigravity + Claude Code both enabled — dual Autopilot fingerprints; prefer one host or expect Stop routing care",
    );
  } else {
    let claudeFpVsAntigravity = false;
    if (!wantClaude) {
      try {
        const raw = readUntrustedUtf8File(
          path.join(root, ".claude", "settings.json"),
          MAX_CONFIG_BYTES,
          ".claude/settings.json",
        );
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          claudeFpVsAntigravity = claudeSettingsContainAutopilot(
            parsed as ClaudeSettingsFile,
          );
        }
      } catch {
        /* missing/unreadable leftover — ignore */
      }
    }
    if (wantAntigravity && claudeFpVsAntigravity) {
      lines.push(
        "WARN  Claude Autopilot hooks present while Antigravity is enabled — dual fingerprints; uninstall Claude hooks or expect Stop routing care",
      );
    }
    if (wantClaude && antigravityLeftoverFp) {
      lines.push(
        "WARN  Antigravity Autopilot hooks present while Claude Code is enabled — dual fingerprints; uninstall Antigravity or expect Stop routing care",
      );
    }
    if (
      !wantAntigravity &&
      !wantClaude &&
      antigravityLeftoverFp &&
      claudeFpVsAntigravity
    ) {
      lines.push(
        "WARN  Antigravity + Claude Autopilot fingerprints both present on disk — dual fingerprints; uninstall leftovers or expect Stop routing care",
      );
    }
  }

  // Dual Antigravity + Gemini Autopilot fingerprints (co-enabled is supported for
  // skills, but dual Stop routing still needs care).
  if (wantAntigravity && wantGemini) {
    lines.push(
      "WARN  Antigravity + Gemini CLI both enabled — dual Autopilot fingerprints; prefer one host or expect Stop routing care",
    );
  } else {
    let geminiFpVsAntigravity = false;
    if (!wantGemini) {
      geminiFpVsAntigravity = projectHasGeminiAutopilotFingerprint(root);
    }
    if (wantAntigravity && geminiFpVsAntigravity) {
      lines.push(
        "WARN  Gemini Autopilot hooks present while Antigravity is enabled — dual fingerprints; uninstall Gemini or expect Stop routing care",
      );
    }
    if (wantGemini && antigravityLeftoverFp) {
      lines.push(
        "WARN  Antigravity Autopilot hooks present while Gemini CLI is enabled — dual fingerprints; uninstall Antigravity or expect Stop routing care",
      );
    }
    if (
      !wantAntigravity &&
      !wantGemini &&
      antigravityLeftoverFp &&
      geminiFpVsAntigravity
    ) {
      lines.push(
        "WARN  Antigravity + Gemini Autopilot fingerprints both present on disk — dual fingerprints; uninstall leftovers or expect Stop routing care",
      );
    }
  }

  const wantRunner = configWantsInstallableHost(cfg.platforms, "runner");
  if (wantRunner && cfg.configOk) {
    try {
      const parsed = parseConfigObject(configYamlText);
      if (!parsed) {
        // configOk came from the same text — treat as unexpected parse drift.
        lines.push(
          "WARN  runner: config unreadable — fix .autopilot/config.yml",
        );
      } else {
        const runnerRaw = isPlainObject(parsed.runner) ? parsed.runner : {};
        const runnerCfg = normalizeRunnerConfig(runnerRaw as RunnerConfigInput);
        if (!hasRunnerCommand(runnerCfg)) {
          lines.push(
            "WARN  runner.command is empty — set a real agent CLI template before runner start (init does not write a fake default)",
          );
        }
        // Prefer the YAML-declared number for the too-small WARN so clamp/default
        // (normalize → 32) does not hide an explicit undersized max_iterations.
        const rawMax = runnerRaw.max_iterations ?? runnerRaw.maxIterations;
        let iterationsForWarn = runnerCfg.maxIterations;
        if (typeof rawMax === "number" && Number.isFinite(rawMax)) {
          iterationsForWarn = rawMax;
        } else if (typeof rawMax === "string" && rawMax.trim()) {
          const n = Number(rawMax.trim());
          if (Number.isFinite(n)) iterationsForWarn = n;
        }
        if (iterationsForWarn < RUNNER_MIN_RECOMMENDED_ITERATIONS) {
          lines.push(
            `WARN  runner.max_iterations is ${safeDisplayToken(String(iterationsForWarn))} (< ${RUNNER_MIN_RECOMMENDED_ITERATIONS}) — too small for fix + confirm×5 headroom`,
          );
        }
        const concurrency = isPlainObject(parsed.concurrency)
          ? parsed.concurrency
          : {};
        const mode =
          typeof concurrency.mode === "string" && concurrency.mode.trim()
            ? concurrency.mode.trim().toLowerCase()
            : "one_executor";
        if (mode === "one_executor" && hasInstallableHookHost(cfg.platforms)) {
          lines.push(
            "WARN  Runner + hook host under concurrency.mode: one_executor — dual track cannot both hold an armed executing session; prefer one track or expect busy on RUN",
          );
        }
      }
    } catch {
      lines.push("WARN  runner: config unreadable — fix .autopilot/config.yml");
    }
  }

  const wantPi = configWantsInstallableHost(cfg.platforms, "pi");
  if (wantPi) {
    lines.push(
      "WARN  Pi tip: project-local .pi/extensions load only after trust — run /trust then /reload after install/upgrade",
    );
    lines.push(
      "WARN  Pi tip (R10): Autopilot surface is interactive TUI only — pi -p / JSON / print modes are unsupported host surfaces",
    );
    const piVer = probePiCliVersion();
    if (!piVer) {
      lines.push(
        "WARN  pi CLI not found on PATH (or --version unreadable) — init does not require it (R4); soft min " +
          PI_SOFT_MIN_VERSION,
      );
    } else if (isPiVersionBelowSoftMin(piVer)) {
      lines.push(
        `WARN  pi ${safeDisplayToken(piVer)} is below soft min ${PI_SOFT_MIN_VERSION} — upgrade Pi when possible`,
      );
    } else {
      lines.push(`OK    pi ${safeDisplayToken(piVer)} (>= soft min ${PI_SOFT_MIN_VERSION})`);
    }
    const piPath = path.join(root, ".pi", "extensions", "autopilot.ts");
    const piRead = readPiExtensionFile(piPath);
    if (!piRead.ok) {
      lines.push(
        `FAIL  ${PI_EXTENSION_REL_PATH}: ${safeDisplayToken(piRead.error, "unreadable")} — run init --force`,
      );
      ok = false;
    } else if (piRead.value == null) {
      lines.push(
        `FAIL  ${PI_EXTENSION_REL_PATH} missing — run init --force (or --add-platform pi)`,
      );
      ok = false;
    } else if (!piExtensionContainsAutopilot(piRead.value)) {
      lines.push(
        `FAIL  ${PI_EXTENSION_REL_PATH} Autopilot fingerprint incomplete — run init --force`,
      );
      ok = false;
    } else {
      lines.push(`OK    ${PI_EXTENSION_REL_PATH} Autopilot fingerprint`);
    }
    if (wantAntigravity) {
      lines.push(
        "WARN  Pi + Antigravity both enabled — shared .agents/skills; Pi does not write .agents/hooks.json; expect dual-host care",
      );
    }
  } else {
    // Leftover Pi extension fingerprint when Pi is not configured.
    const piPath = path.join(root, ".pi", "extensions", "autopilot.ts");
    const piRead = readPiExtensionFile(piPath);
    if (
      piRead.ok &&
      piRead.value != null &&
      piExtensionContainsAutopilot(piRead.value)
    ) {
      lines.push(
        `WARN  leftover ${PI_EXTENSION_REL_PATH} Autopilot fingerprint (pi not in platforms) — uninstall or add-platform pi`,
      );
    }
  }

  const homeDir = opts.homeDir ?? os.homedir();
  if (wantCursor && hasGlobalSelfReviewHooks(homeDir)) {
    lines.push(
      "WARN  ~/.cursor global self-review hooks detected — may double-inject with Autopilot; disable run-global-self-review or rely on Autopilot alone",
    );
  }

  const nodeMajor = Number.parseInt(
    process.versions.node.split(".")[0] ?? "0",
    10,
  );
  if (nodeMajor < 22) {
    lines.push(
      `WARN  Node ${process.versions.node} — recommend >=22 (node:sqlite)`,
    );
  } else {
    lines.push(`OK    Node ${process.versions.node}`);
  }

  const plansRoot = path.join(root, cfg.plansDir);
  if (cfg.plansDirError) {
    lines.push(`FAIL  artifacts.plans_dir invalid: ${cfg.plansDirError}`);
    ok = false;
  } else {
    try {
      const st = fs.lstatSync(plansRoot);
      if (st.isSymbolicLink()) {
        lines.push(`FAIL  plans path is a symlink (${cfg.plansDir})`);
        ok = false;
      } else if (!st.isDirectory()) {
        lines.push(`FAIL  plans path is not a directory (${cfg.plansDir})`);
        ok = false;
      } else {
        assertRealpathInside(root, plansRoot, `plans (${cfg.plansDir})`);
        lines.push(`OK    plans (${cfg.plansDir}/)`);
        if (cfg.plansDir === "plans") {
          lines.push(
            "INFO  artifacts.plans_dir is plans/ (legacy root). New init defaults to docs/autopilot/plans; upgrade does not move existing plans.",
          );
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        lines.push(
          `WARN  plans dir missing (${cfg.plansDir}/) — run init or mkdir`,
        );
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(
          `FAIL  plans path unreadable (${cfg.plansDir}): ${safeDisplayToken(msg, "error")}`,
        );
        ok = false;
      }
    }
  }

  let missingSkills = 0;
  type SkillHostCheck = {
    label: string;
    /** Absolute SKILL.md path for one skill name. */
    pathFor: (name: string) => string;
    /** Realpath containment root (project or Hermes home). */
    containRoot: string;
  };
  const skillHosts: SkillHostCheck[] = [];
  if (wantCursor) {
    skillHosts.push({
      label: ".cursor/skills/",
      pathFor: (name) =>
        path.join(root, ".cursor", "skills", name, "SKILL.md"),
      containRoot: root,
    });
  }
  if (wantClaude) {
    skillHosts.push({
      label: ".claude/skills/",
      pathFor: (name) =>
        path.join(root, ".claude", "skills", name, "SKILL.md"),
      containRoot: root,
    });
  }
  if (configWantsAgentsSkills(cfg.platforms)) {
    skillHosts.push({
      label: ".agents/skills/",
      pathFor: (name) =>
        path.join(root, ".agents", "skills", name, "SKILL.md"),
      containRoot: root,
    });
  }
  if (wantCopilot) {
    skillHosts.push({
      label: ".github/skills/",
      pathFor: (name) =>
        path.join(root, ".github", "skills", name, "SKILL.md"),
      containRoot: root,
    });
  }
  if (wantGrok) {
    skillHosts.push({
      label: ".grok/skills/",
      pathFor: (name) =>
        path.join(root, ".grok", "skills", name, "SKILL.md"),
      containRoot: root,
    });
  }
  if (wantGemini) {
    skillHosts.push({
      label: ".gemini/skills/",
      pathFor: (name) =>
        path.join(root, ".gemini", "skills", name, "SKILL.md"),
      containRoot: root,
    });
  }
  if (wantFactory) {
    skillHosts.push({
      label: ".factory/skills/",
      pathFor: (name) =>
        path.join(root, ".factory", "skills", name, "SKILL.md"),
      containRoot: root,
    });
  }
  if (wantDevin) {
    skillHosts.push({
      label: ".devin/skills/",
      pathFor: (name) =>
        path.join(root, ".devin", "skills", name, "SKILL.md"),
      containRoot: root,
    });
  }
  if (wantHermes) {
    const injectHermesHome = opts.hermesHome;
    const hermesSkillsHome =
      typeof injectHermesHome === "string" &&
      injectHermesHome &&
      path.isAbsolute(injectHermesHome)
        ? injectHermesHome
        : resolveHermesHome();
    skillHosts.push({
      label: "$HERMES_HOME/skills/",
      pathFor: (name) =>
        path.join(hermesSkillsHome, "skills", name, "SKILL.md"),
      containRoot: hermesSkillsHome,
    });
  }
  for (const host of skillHosts) {
    for (const name of SKILL_NAMES) {
      const skillPath = host.pathFor(name);
      try {
        const st = fs.lstatSync(skillPath);
        // existsSync follows pointing symlinks / lies on dangling — require a real file.
        if (st.isSymbolicLink() || !st.isFile()) {
          missingSkills += 1;
          continue;
        }
        // Skill dir itself may be a symlink escape; realpath must stay in contain root.
        assertRealpathInside(
          host.containRoot,
          skillPath,
          `${host.label}${name}/SKILL.md`,
        );
      } catch {
        missingSkills += 1;
      }
    }
  }
  if (skillHosts.length === 0) {
    // No installable hosts declared — skip skills check.
  } else if (missingSkills > 0) {
    const where = skillHosts.map((h) => h.label).join(" / ");
    lines.push(
      `WARN  ${missingSkills} skill(s) missing under ${where} — run upgrade`,
    );
  } else {
    const n = skillHosts.length * SKILL_NAMES.length;
    lines.push(`OK    skills (${n})`);
  }

  const opened = openStateStore(root);
  if (!opened.ok) {
    if (opened.error === "missing") {
      lines.push("OK    state.db (not created yet)");
    } else {
      lines.push(`FAIL  state.db — ${opened.error}`);
      ok = false;
    }
  } else {
    const store = opened.store;
    try {
      const version = store.getSchemaVersion();
      const latest = getLatestSchemaVersion();
      const schemaOk = version === latest;
      if (!schemaOk) {
        lines.push(
          `FAIL  schema_version=${safeDisplayToken(String(version))} (package expects ${safeDisplayToken(String(latest))}) — run upgrade`,
        );
        ok = false;
      } else {
        lines.push(
          `OK    state.db schema_version=${safeDisplayToken(String(version))}`,
        );
      }

      const rows = store.listSessions();
      const orphans: string[] = [];
      for (const row of rows) {
        if (!VALID_PHASES.has(row.phase as Phase)) {
          orphans.push(
            `${shortSessionId(row.conversation_id)} unknown phase "${safeDisplayToken(String(row.phase), "?")}"`,
          );
        }
        if (
          row.paused_reason != null &&
          row.paused_reason !== "" &&
          !VALID_PAUSED_REASONS.has(row.paused_reason as PausedReason)
        ) {
          orphans.push(
            `${shortSessionId(row.conversation_id)} unknown paused_reason "${safeDisplayToken(String(row.paused_reason), "?")}"`,
          );
        }
      }
      if (orphans.length > 0) {
        ok = false;
        for (const msg of orphans.slice(0, 5)) {
          lines.push(`FAIL  orphan state: ${msg} — reset-review or purge`);
        }
        if (orphans.length > 5) {
          lines.push(`FAIL  …and ${orphans.length - 5} more orphan row(s)`);
        }
      }

      // Occupier visibility (occupier-status-doctor): same gate as one_executor.
      pushOccupierDisplayLines(lines, rows, "doctor");

      const stale = rows.filter((r) =>
        isStaleSession(r, cfg.staleAfterHours, nowMs),
      );
      // Broken config / unknown phase must not drive destructive prune.
      if (cfg.configOk && !cfg.staleHoursInvalid && stale.length > 0) {
        if (opts.pruneStale) {
          if (orphans.length > 0) {
            lines.push(
              `FAIL  refusing --prune-stale until orphan state is resolved (${stale.length} stale left)`,
            );
            ok = false;
          } else if (!schemaOk) {
            lines.push(
              `FAIL  refusing --prune-stale until schema is migrated (${stale.length} stale left)`,
            );
            ok = false;
          } else {
            const protectedRows = stale.filter(isProtectedFromPrune);
            const candidates = stale.filter((r) => !isProtectedFromPrune(r));
            if (protectedRows.length > 0) {
              lines.push(
                `WARN  skipped ${protectedRows.length} in-flight session(s) (armed/paused/pending_action)`,
              );
            }
            if (candidates.length === 0) {
              lines.push(
                `WARN  ${stale.length} stale session(s) protected — none pruned`,
              );
            } else {
              let count = 0;
              for (const row of candidates) {
                // Re-check stale/protection inside purge txn (list→delete TOCTOU).
                if (
                  store.purgeSession(row.conversation_id, (fresh) =>
                    !isProtectedFromPrune(fresh) &&
                    isStaleSession(fresh, cfg.staleAfterHours, nowMs),
                  )
                ) {
                  count += 1;
                }
              }
              if (count > 0) {
                pruned = count;
                lines.push(
                  `OK    pruned ${count} stale session(s) (>${cfg.staleAfterHours}h)`,
                );
              } else {
                lines.push(
                  `WARN  no eligible stale sessions pruned (in-flight, changed, or already gone)`,
                );
              }
            }
          }
        } else {
          lines.push(
            `WARN  ${stale.length} stale session(s) (>${cfg.staleAfterHours}h) — session purge <id> or doctor --prune-stale`,
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push(`FAIL  state.db — ${safeDisplayToken(msg, "error")}`);
      ok = false;
    } finally {
      store.close();
    }
  }

  return pruned === undefined ? { ok, lines } : { ok, lines, pruned };
}
