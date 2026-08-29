import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getLatestSchemaVersion,
  sanitizeSessionDisplayText,
  StateStore,
  type Phase,
  type PausedReason,
  type SessionRow,
} from "@autopilot-harness/core";
import { parseDocument } from "yaml";
import {
  summarizeAutopilotHooks,
  validateHooksShape,
} from "./init/hooks-merge.js";
import { PACKAGE_VERSION, type HooksFile } from "./init/types.js";
import { assertNotSymlink, assertRealpathInside, normalizePlansDir } from "./init/wizard-helpers.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
} from "./read-untrusted-file.js";
import { formatSessionDisplayName, shortSessionId } from "./session.js";

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
const SKILL_NAMES = [
  "autopilot-on",
  "autopilot-run",
  "autopilot-off",
  "autopilot-resume",
  "autopilot-replan",
] as const;

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

export type DoctorOptions = {
  pruneStale?: boolean;
  /** Injectable clock for stale checks (tests). */
  nowMs?: number;
  /** Injectable package version (defaults to PACKAGE_VERSION). */
  packageVersion?: string;
  /** Injectable home directory for global hooks dual-inject check (tests). */
  homeDir?: string;
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

function readStatusConfig(configYaml: string): {
  configOk: boolean;
  platform: string;
  locale: string;
  preferredName: string;
  plansDir: string;
  /** Set when artifacts.plans_dir failed normalizePlansDir. */
  plansDirError: string | null;
  staleAfterHours: number;
  /** True when session.stale_after_hours was present but unusable. */
  staleHoursInvalid: boolean;
} {
  const parsed = parseConfigObject(configYaml);
  if (!parsed) {
    return {
      configOk: false,
      platform: "?",
      locale: "?",
      preferredName: "Autopilot",
      plansDir: "plans",
      plansDirError: null,
      staleAfterHours: DEFAULT_STALE_HOURS,
      staleHoursInvalid: false,
    };
  }
  const cli = isPlainObject(parsed.cli) ? parsed.cli : {};
  const artifacts = isPlainObject(parsed.artifacts) ? parsed.artifacts : {};
  const session = isPlainObject(parsed.session) ? parsed.session : {};
  let plansRaw = "plans";
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
    }
  }
  const plansNorm = normalizePlansDir(plansRaw);
  const staleParsed = parseStaleAfterHours(session.stale_after_hours);
  const preferredRaw =
    typeof cli.preferred_name === "string" && cli.preferred_name.trim()
      ? sanitizeSessionDisplayText(cli.preferred_name)
      : "Autopilot";
  return {
    configOk: true,
    platform:
      typeof parsed.platform === "string"
        ? safeDisplayToken(parsed.platform)
        : "?",
    locale:
      typeof parsed.locale === "string"
        ? safeDisplayToken(parsed.locale)
        : "?",
    preferredName: preferredRaw || "Autopilot",
    plansDir: plansNorm.ok ? plansNorm.value : "plans",
    plansDirError: plansDirTypeError
      ? plansDirTypeError
      : plansNorm.ok
        ? null
        : plansNorm.error,
    staleAfterHours: staleParsed.hours,
    staleHoursInvalid: staleParsed.invalid,
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
    const cfg = readStatusConfig(readProjectConfigYaml(configPath));
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
    cfg = readStatusConfig(readProjectConfigYaml(configPath));
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
    `  platform: ${cfg.platform}`,
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
  try {
    cfg = readStatusConfig(readProjectConfigYaml(configPath));
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
        if (missingEvents.length === 0 && duplicates === 0) {
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

  const homeDir = opts.homeDir ?? os.homedir();
  if (hasGlobalSelfReviewHooks(homeDir)) {
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
  for (const name of SKILL_NAMES) {
    const skillPath = path.join(root, ".cursor", "skills", name, "SKILL.md");
    try {
      const st = fs.lstatSync(skillPath);
      // existsSync follows pointing symlinks / lies on dangling — require a real file.
      if (st.isSymbolicLink() || !st.isFile()) {
        missingSkills += 1;
        continue;
      }
      // Skill dir itself may be a symlink escape; realpath must stay in-project.
      assertRealpathInside(root, skillPath, `.cursor/skills/${name}/SKILL.md`);
    } catch {
      missingSkills += 1;
    }
  }
  if (missingSkills > 0) {
    lines.push(
      `WARN  ${missingSkills} skill(s) missing under .cursor/skills/ — run upgrade`,
    );
  } else {
    lines.push("OK    skills (5)");
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
