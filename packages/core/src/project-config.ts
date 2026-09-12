import fs from "node:fs";
import path from "node:path";
import {
  isRealpathInsideProject,
  normalizeInProjectPlansDir,
  normalizeProjectRoot,
} from "./project-path.js";
import {
  DEFAULT_TRIGGERS,
  type TriggerConfig,
} from "./trigger-parser.js";
import type { VerifyCommandConfig } from "./verify-report.js";

const MAX_CONFIG_BYTES = 1_000_000;

/** When the fix→confirm review chain may run on completed stops. */
export type ReviewScope = "executing_only" | "project";

export interface ProjectReviewConfig {
  confirmRounds: number;
  /** `executing_only` = after RUN; `project` = any product-code edit in this repo. */
  reviewScope: ReviewScope;
  verifyEnabled: boolean;
  verifyCommands: VerifyCommandConfig[];
  maxIdleStops: number;
  /**
   * Consecutive turn errors/aborts before `repeated_errors` pause.
   * `0` = never pause on errors (unlimited recoveries).
   */
  maxErrorsBeforePause: number;
  locale: string;
}

/** Submit/edit hook settings from config.yml (fail-open defaults). */
export type ProjectHookTriggers = Required<Omit<TriggerConfig, "match">> & {
  match: "line_start";
};

export interface ProjectHookConfig {
  triggers: ProjectHookTriggers;
  /** Relative in-project plans directory (normalized). */
  plansDir: string;
}

export const DEFAULT_PROJECT_REVIEW_CONFIG: ProjectReviewConfig = {
  confirmRounds: 5,
  reviewScope: "executing_only",
  verifyEnabled: false,
  // freeze: chặn mutate hằng số mặc định làm bẩn mọi clone sau này
  verifyCommands: Object.freeze([]) as unknown as VerifyCommandConfig[],
  maxIdleStops: 5,
  maxErrorsBeforePause: 0,
  locale: "en",
};

const TRIGGER_PHRASE_KEYS = [
  "on",
  "run",
  "off",
  "resume",
  "replan",
  "resume_review",
] as const satisfies ReadonlyArray<keyof Omit<ProjectHookTriggers, "match">>;

function cloneDefaultTriggers(): ProjectHookTriggers {
  return {
    match: "line_start",
    on: [...DEFAULT_TRIGGERS.on],
    run: [...DEFAULT_TRIGGERS.run],
    off: [...DEFAULT_TRIGGERS.off],
    resume: [...DEFAULT_TRIGGERS.resume],
    replan: [...DEFAULT_TRIGGERS.replan],
    resume_review: [...DEFAULT_TRIGGERS.resume_review],
  };
}

function cloneDefaultHookConfig(): ProjectHookConfig {
  return {
    triggers: cloneDefaultTriggers(),
    plansDir: "plans",
  };
}

/** Bản sao độc lập — tránh chia sẻ mảng verifyCommands giữa các lần gọi. */
function parseReviewScope(raw: unknown): ReviewScope {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "project" || s === "always" || s === "all") return "project";
  return "executing_only";
}

function cloneDefaultProjectReviewConfig(): ProjectReviewConfig {
  return {
    confirmRounds: DEFAULT_PROJECT_REVIEW_CONFIG.confirmRounds,
    reviewScope: DEFAULT_PROJECT_REVIEW_CONFIG.reviewScope,
    verifyEnabled: DEFAULT_PROJECT_REVIEW_CONFIG.verifyEnabled,
    verifyCommands: [],
    maxIdleStops: DEFAULT_PROJECT_REVIEW_CONFIG.maxIdleStops,
    maxErrorsBeforePause: DEFAULT_PROJECT_REVIEW_CONFIG.maxErrorsBeforePause,
    locale: DEFAULT_PROJECT_REVIEW_CONFIG.locale,
  };
}

function coerceIntInRange(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null || !raw.trim()) return fallback;
  const n = Number(raw.trim());
  // Non-integer / below min → default. Above max → clamp (e.g. max_before_pause
  // 1001 must not fail-open to 0/unlimited and disable the pause gate).
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) return fallback;
  if (n > max) return max;
  return n;
}

function unquote(value: string): string {
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

/** Keys that must never be written from YAML (match config-merge policy). */
function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

/**
 * Coerce a YAML scalar. Init writes trigger lists as JSON arrays on one line
 * (`on: ["Autopilot ON", …]`); parse those into string[] when valid.
 */
function coerceScalar(
  value: string,
): string | boolean | null | string[] {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.every((x) => typeof x === "string")
      ) {
        return parsed as string[];
      }
    } catch {
      /* not JSON — fall through to plain string */
    }
  }
  return unquote(value);
}

function lineIndent(line: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 2;
    else break;
  }
  return n;
}

/**
 * Minimal indentation-aware YAML subset reader for Autopilot config.
 * Avoids bundling the full `yaml` package into the Cursor hook vendor ESM.
 */
function parseSimpleYaml(raw: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  type Frame = {
    /** Indent of this mapping's own key line (siblings at <= indent pop it). */
    indent: number;
    obj: Record<string, unknown>;
    openKey?: string;
    openKeyIndent?: number;
  };
  const stack: Frame[] = [{ indent: -1, obj: root }];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = lineIndent(line);
    const trimmed = line.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }
    const frame = stack[stack.length - 1]!;

    if (trimmed.startsWith("- ")) {
      const itemRaw = trimmed.slice(2).trim();
      if (!frame.openKey) continue;
      let list = frame.obj[frame.openKey];
      if (!Array.isArray(list)) {
        list = [];
        frame.obj[frame.openKey] = list;
      }
      if (itemRaw.includes(":") && !itemRaw.startsWith("{")) {
        const item: Record<string, unknown> = {};
        (list as unknown[]).push(item);
        const m = itemRaw.match(/^([^:#]+):\s*(.*)$/);
        if (m) {
          const k = m[1]!.trim();
          const v = m[2]!.trim();
          if (!isUnsafeKey(k)) {
            item[k] = v === "" ? null : coerceScalar(v);
          }
          stack.push({ indent, obj: item });
        }
      } else {
        (list as unknown[]).push(coerceScalar(itemRaw));
      }
      continue;
    }

    const kv = trimmed.match(/^([^:#]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!.trim();
    const value = kv[2]!.trim();
    if (isUnsafeKey(key)) continue;

    // Nested content under an openKey → materialize mapping and descend.
    if (
      frame.openKey &&
      frame.openKeyIndent != null &&
      indent > frame.openKeyIndent
    ) {
      let child = frame.obj[frame.openKey];
      if (!isPlainObject(child) || Array.isArray(child)) {
        child = {};
        frame.obj[frame.openKey] = child;
      }
      const childObj = child as Record<string, unknown>;
      const childIndent = frame.openKeyIndent;
      frame.openKey = undefined;
      frame.openKeyIndent = undefined;
      stack.push({ indent: childIndent, obj: childObj });
      const childFrame = stack[stack.length - 1]!;
      if (value === "" || value === "|" || value === ">") {
        childFrame.openKey = key;
        childFrame.openKeyIndent = indent;
      } else {
        childObj[key] = coerceScalar(value);
      }
      continue;
    }

    if (value === "" || value === "|" || value === ">") {
      frame.openKey = key;
      frame.openKeyIndent = indent;
      continue;
    }

    frame.openKey = undefined;
    frame.openKeyIndent = undefined;
    frame.obj[key] = coerceScalar(value);
  }

  return root;
}

function coerceBool(raw: unknown): boolean | undefined {
  if (raw === true || raw === "true") return true;
  if (raw === false || raw === "false") return false;
  return undefined;
}

function parseVerifyCommands(raw: unknown): VerifyCommandConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: VerifyCommandConfig[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.id !== "string" || !entry.id.trim()) continue;
    const cmd: VerifyCommandConfig = { id: entry.id.trim() };
    if (typeof entry.run === "string") cmd.run = entry.run;
    const required = coerceBool(entry.required);
    if (required !== undefined) cmd.required = required;
    out.push(cmd);
  }
  return out;
}

/**
 * Read + parse `.autopilot/config.yml` (fail-open → null).
 * Shared by review + hook loaders.
 */
function readProjectConfigYaml(
  projectRoot: string,
): { root: string; parsed: Record<string, unknown> } | null {
  const root = normalizeProjectRoot(projectRoot);
  if (!root) return null;
  const configPath = path.join(root, ".autopilot", "config.yml");
  try {
    const nofollow =
      typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;

    if (nofollow === 0) {
      if (!fs.existsSync(configPath)) return null;
      if (fs.lstatSync(configPath).isSymbolicLink()) return null;
    }

    let fd: number;
    try {
      fd = fs.openSync(configPath, fs.constants.O_RDONLY | nofollow);
    } catch {
      return null;
    }
    let raw: string;
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > MAX_CONFIG_BYTES) return null;
      const lst = fs.lstatSync(configPath);
      if (lst.isSymbolicLink() || !lst.isFile()) return null;
      if (lst.ino !== st.ino || lst.dev !== st.dev) return null;
      if (!isRealpathInsideProject(root, configPath)) return null;
      const buf = Buffer.alloc(st.size);
      const n = fs.readSync(fd, buf, 0, st.size, 0);
      raw = buf.subarray(0, n).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) return null;

    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = parseSimpleYaml(text);
    if (!isPlainObject(parsed)) return null;
    return { root, parsed };
  } catch {
    return null;
  }
}

/** Non-empty string phrases only; empty / invalid → null (caller uses DEFAULT). */
function nonEmptyPhraseList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (t) out.push(t);
  }
  return out.length > 0 ? out : null;
}

function triggersFromParsed(parsed: Record<string, unknown>): ProjectHookTriggers {
  const base = cloneDefaultTriggers();
  const triggers = isPlainObject(parsed.triggers) ? parsed.triggers : {};
  for (const key of TRIGGER_PHRASE_KEYS) {
    const phrases = nonEmptyPhraseList(triggers[key]);
    if (phrases) base[key] = phrases;
  }
  return base;
}

function plansDirFromParsed(
  root: string,
  parsed: Record<string, unknown>,
): string {
  const artifacts = isPlainObject(parsed.artifacts) ? parsed.artifacts : {};
  const raw = artifacts.plans_dir;
  const candidate = typeof raw === "string" ? raw : "plans";
  return normalizeInProjectPlansDir(root, candidate) ?? "plans";
}

/**
 * Lightweight id/surface normalize for config.yml — mirrors CLI
 * `sanitizePlatformId` / `sanitizeSurfaceId` (controls, junk strip, lower, cap).
 */
function softPlatformToken(raw: string, maxLen = 64): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/[^A-Za-z0-9._+-]/g, "")
    .toLowerCase()
    .slice(0, maxLen);
}

/** Same defaults as CLI `defaultSurfaceFor` (kimi/claude/codex → cli). */
function defaultSurfaceForId(id: string): string {
  if (id === "kimi-code" || id === "claude-code" || id === "codex") return "cli";
  if (id === "runner") return "runner";
  return "ide";
}

/**
 * Resolve surface like CLI `normalizeBinding`: omitted/blank → default;
 * explicit junk that sanitizes to empty → invalid (null).
 */
function resolveBindingSurface(
  id: string,
  surfaceRaw: unknown,
): string | null {
  if (typeof surfaceRaw === "string" && surfaceRaw.trim() !== "") {
    const surface = softPlatformToken(surfaceRaw, 32);
    return surface || null;
  }
  return defaultSurfaceForId(id);
}

function legacyScalarsWantInstallableKimi(
  parsed: Record<string, unknown>,
): boolean {
  const legacyId =
    typeof parsed.platform === "string"
      ? softPlatformToken(parsed.platform)
      : "";
  if (legacyId !== "kimi-code") return false;
  const surface = resolveBindingSurface(legacyId, parsed.surface);
  return surface === "cli";
}

/** Match CLI `MAX_PLATFORM_BINDINGS` — ignore hosts past the unique cap. */
const MAX_PLATFORM_BINDINGS = 32;

/**
 * True when config enables installable Kimi Code (`kimi-code` + `cli`).
 * Aligns with CLI `parsePlatformBindingsFromConfig` + installable binding:
 * platforms list (objects / bare strings), omitted surface → default `cli`,
 * unique cap 32, and legacy top-level `platform`/`surface` when no usable
 * `platforms` entries. That host hard-caps Stop-continue at ≤1/turn —
 * confirm×N>1 stalls mid-chain.
 */
export function configHasInstallableKimiCode(
  parsed: unknown,
): boolean {
  if (!isPlainObject(parsed)) return false;
  const platforms = parsed.platforms;
  if (Array.isArray(platforms) && platforms.length > 0) {
    let sawUsableBinding = false;
    let uniqueCount = 0;
    const seen = new Set<string>();
    for (const entry of platforms) {
      let id = "";
      let surface: string | null = null;
      if (typeof entry === "string") {
        id = softPlatformToken(entry);
        if (!id) continue;
        surface = defaultSurfaceForId(id);
      } else if (isPlainObject(entry)) {
        const idRaw =
          typeof entry.id === "string"
            ? entry.id
            : typeof entry.platform === "string"
              ? entry.platform
              : "";
        id = softPlatformToken(idRaw);
        if (!id) continue;
        surface = resolveBindingSurface(id, entry.surface);
        if (!surface) continue; // explicit junk surface → drop (CLI null)
      } else {
        continue;
      }
      const key = `${id}:${surface}`;
      if (seen.has(key)) continue;
      if (uniqueCount >= MAX_PLATFORM_BINDINGS) break;
      seen.add(key);
      uniqueCount += 1;
      sawUsableBinding = true;
      if (id === "kimi-code" && surface === "cli") return true;
    }
    if (sawUsableBinding) return false;
  }

  return legacyScalarsWantInstallableKimi(parsed);
}

/**
 * Load review runtime settings from `.autopilot/config.yml`.
 * Missing / unreadable / corrupt → safe defaults (hook fail-open).
 * When installable `kimi-code` is enabled, `confirmRounds` is clamped to **1**.
 */
export function loadProjectReviewConfig(
  projectRoot: string,
): ProjectReviewConfig {
  const loaded = readProjectConfigYaml(projectRoot);
  if (!loaded) return cloneDefaultProjectReviewConfig();

  const { parsed } = loaded;
  const review = isPlainObject(parsed.review) ? parsed.review : {};
  const verify = isPlainObject(review.verify) ? review.verify : {};
  const stuck = isPlainObject(review.stuck) ? review.stuck : {};
  const errors = isPlainObject(review.errors) ? review.errors : {};

  const cfg = normalizeProjectReviewConfig({
    confirmRounds: review.confirm_rounds,
    reviewScope: review.scope,
    verifyEnabled: verify.enabled,
    verifyCommands: verify.commands,
    maxIdleStops: stuck.max_idle_stops,
    maxErrorsBeforePause: errors.max_before_pause,
    locale: parsed.locale,
  });
  if (configHasInstallableKimiCode(parsed) && cfg.confirmRounds > 1) {
    return { ...cfg, confirmRounds: 1 };
  }
  return cfg;
}

/**
 * Load submit/edit hook settings (`triggers.*`, `artifacts.plans_dir`).
 * Missing / unreadable / corrupt / empty phrase lists → DEFAULT_TRIGGERS + `plans/`.
 */
export function loadProjectHookConfig(projectRoot: string): ProjectHookConfig {
  const loaded = readProjectConfigYaml(projectRoot);
  if (!loaded) return cloneDefaultHookConfig();
  return {
    triggers: triggersFromParsed(loaded.parsed),
    plansDir: plansDirFromParsed(loaded.root, loaded.parsed),
  };
}

/**
 * Kẹp biên + làm sạch — mọi preloaded/config đều phải qua đây
 * (không cho bypass confirm_rounds / idle / commands).
 */
export function normalizeProjectReviewConfig(raw: unknown): ProjectReviewConfig {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return cloneDefaultProjectReviewConfig();
  }
  const o = raw as Record<string, unknown>;
  return {
    confirmRounds: coerceIntInRange(
      o.confirmRounds != null ? String(o.confirmRounds) : undefined,
      1,
      5,
      DEFAULT_PROJECT_REVIEW_CONFIG.confirmRounds,
    ),
    reviewScope: parseReviewScope(o.reviewScope),
    verifyEnabled: coerceBool(o.verifyEnabled) === true,
    verifyCommands: parseVerifyCommands(o.verifyCommands),
    maxIdleStops: coerceIntInRange(
      o.maxIdleStops != null ? String(o.maxIdleStops) : undefined,
      1,
      100,
      DEFAULT_PROJECT_REVIEW_CONFIG.maxIdleStops,
    ),
    // 0 = unlimited; clamp 0..1000 (invalid → default unlimited)
    maxErrorsBeforePause: coerceIntInRange(
      o.maxErrorsBeforePause != null
        ? String(o.maxErrorsBeforePause)
        : undefined,
      0,
      1000,
      DEFAULT_PROJECT_REVIEW_CONFIG.maxErrorsBeforePause,
    ),
    locale:
      typeof o.locale === "string" && o.locale.trim()
        ? o.locale.trim()
        : DEFAULT_PROJECT_REVIEW_CONFIG.locale,
  };
}
