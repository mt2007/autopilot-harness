import fs from "node:fs";
import path from "node:path";
import { isRealpathInsideProject, normalizeProjectRoot } from "./project-path.js";
import type { VerifyCommandConfig } from "./verify-report.js";

const MAX_CONFIG_BYTES = 1_000_000;

export interface ProjectReviewConfig {
  confirmRounds: number;
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

export const DEFAULT_PROJECT_REVIEW_CONFIG: ProjectReviewConfig = {
  confirmRounds: 5,
  verifyEnabled: false,
  // freeze: chặn mutate hằng số mặc định làm bẩn mọi clone sau này
  verifyCommands: Object.freeze([]) as unknown as VerifyCommandConfig[],
  maxIdleStops: 5,
  maxErrorsBeforePause: 0,
  locale: "en",
};

/** Bản sao độc lập — tránh chia sẻ mảng verifyCommands giữa các lần gọi. */
function cloneDefaultProjectReviewConfig(): ProjectReviewConfig {
  return {
    confirmRounds: DEFAULT_PROJECT_REVIEW_CONFIG.confirmRounds,
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

function coerceScalar(value: string): string | boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
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
 * Load review runtime settings from `.autopilot/config.yml`.
 * Missing / unreadable / corrupt → safe defaults (hook fail-open).
 */
export function loadProjectReviewConfig(
  projectRoot: string,
): ProjectReviewConfig {
  // Fail closed on unusable roots before any open (empty/blank/NUL → cwd-relative join).
  const root = normalizeProjectRoot(projectRoot);
  if (!root) {
    return cloneDefaultProjectReviewConfig();
  }
  const configPath = path.join(root, ".autopilot", "config.yml");
  try {
    const nofollow =
      typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;

    // Without O_NOFOLLOW: lstat before open — refuse leaf symlink follow.
    if (nofollow === 0) {
      if (!fs.existsSync(configPath)) return cloneDefaultProjectReviewConfig();
      if (fs.lstatSync(configPath).isSymbolicLink()) {
        return cloneDefaultProjectReviewConfig();
      }
    }

    let fd: number;
    try {
      // O_NOFOLLOW + fstat: block leaf-symlink TOCTOU and oversized reads after stat.
      fd = fs.openSync(configPath, fs.constants.O_RDONLY | nofollow);
    } catch {
      return cloneDefaultProjectReviewConfig();
    }
    let raw: string;
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.size > MAX_CONFIG_BYTES) {
        return cloneDefaultProjectReviewConfig();
      }
      // Bind fd to path identity always (intermediate-dir swap-back TOCTOU).
      const lst = fs.lstatSync(configPath);
      if (lst.isSymbolicLink() || !lst.isFile()) {
        return cloneDefaultProjectReviewConfig();
      }
      if (lst.ino !== st.ino || lst.dev !== st.dev) {
        return cloneDefaultProjectReviewConfig();
      }
      if (!isRealpathInsideProject(root, configPath)) {
        return cloneDefaultProjectReviewConfig();
      }
      // Read exactly the fstat size — avoid OOM if the file grows after fstat.
      const buf = Buffer.alloc(st.size);
      const n = fs.readSync(fd, buf, 0, st.size, 0);
      raw = buf.subarray(0, n).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) {
      return cloneDefaultProjectReviewConfig();
    }

    // Strip UTF-8 BOM so the first key is not shadowed as "\uFEFFlocale".
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    const parsed = parseSimpleYaml(text);
    if (!isPlainObject(parsed)) return cloneDefaultProjectReviewConfig();

    const review = isPlainObject(parsed.review) ? parsed.review : {};
    const verify = isPlainObject(review.verify) ? review.verify : {};
    const stuck = isPlainObject(review.stuck) ? review.stuck : {};
    const errors = isPlainObject(review.errors) ? review.errors : {};

    // Một đường normalize — tránh load vs normalize lệch kẹp biên / bool.
    return normalizeProjectReviewConfig({
      confirmRounds: review.confirm_rounds,
      verifyEnabled: verify.enabled,
      verifyCommands: verify.commands,
      maxIdleStops: stuck.max_idle_stops,
      maxErrorsBeforePause: errors.max_before_pause,
      locale: parsed.locale,
    });
  } catch {
    return cloneDefaultProjectReviewConfig();
  }
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
