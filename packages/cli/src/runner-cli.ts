import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  StateStore,
  applyRun,
  normalizeInProjectPlansDir,
  normalizeProjectRoot,
  sanitizeSessionDisplayText,
  type FollowupLocaleBundle,
  type PhaseActionConfig,
} from "@autopilot-harness/core";
import { isLocaleCode, loadLocale } from "@autopilot-harness/i18n";
import {
  RUNNER_PLATFORM,
  canResumeRunnerSession,
  normalizeRunnerConfig,
  resolveRunnerCwd,
  runRunnerLoop,
  stableRunnerConversationId,
  type AgentDriver,
  type RunnerConfig,
  type RunnerConfigInput,
  type RunnerLoopResult,
  type RunnerPromptMode,
} from "@autopilot-harness/port-runner";
import { assertNotSymlink } from "./project-fs.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
} from "./read-untrusted-file.js";

/** Cap YAML aliases (doctor parity) to bound expand cost on hostile config. */
const YAML_TO_JS_OPTS = { maxAliasCount: 64 } as const;

export interface RunnerCliFlagOverrides {
  command?: string;
  maxIterations?: number;
  cwd?: string;
  promptMode?: string;
  env?: Record<string, string>;
}

export interface LoadedProjectRunner {
  fromYaml: RunnerConfigInput;
  plansDir: string;
  locale: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    Boolean(v) &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.prototype.toString.call(v) === "[object Object]"
  );
}

function isUnsafeObjectKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

/** Copy env map without prototype-pollution keys (config-merge parity). */
function sanitizeEnvMap(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(raw)) return undefined;
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== "string" || !k.trim() || isUnsafeObjectKey(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Mirror StateStore conversation-id gate without opening a DB
 * (blank / untrimmed / C0 controls → reject).
 */
function isRunnerConversationIdOk(conversationId: string): boolean {
  return (
    conversationId.trim() !== "" &&
    conversationId === conversationId.trim() &&
    !/[\u0000-\u001f\u007f]/.test(conversationId)
  );
}

function invalidConversationError(conversationId: string): string {
  return `Invalid --conversation id: "${sanitizeSessionDisplayText(conversationId).slice(0, 64)}"`;
}

/**
 * O_NOFOLLOW + size-capped config read (parity with locale-set / doctor).
 * Missing file → null (caller uses defaults). Symlink / oversize → throw.
 */
function readConfigYamlText(projectRoot: string): string | null {
  const configPath = path.join(projectRoot, ".autopilot", "config.yml");
  try {
    return readUntrustedUtf8File(
      configPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      ".autopilot/config.yml",
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Refuse symlink `.autopilot/` (parity with session / locale-set).
 * Missing dir is OK — start may create it via StateStore.
 */
function assertAutopilotDirSafe(projectRoot: string): void {
  const dir = path.join(projectRoot, ".autopilot");
  try {
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink()) {
      throw new Error(".autopilot/ is a symlink; refusing to open");
    }
    if (!st.isDirectory()) {
      throw new Error(".autopilot/ is not a directory");
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    throw err;
  }
}

/**
 * Open StateStore for runner start (may create state.db).
 * Refuses symlink `.autopilot/` / `state.db` (session parity).
 */
function openRunnerStoreForStart(projectRoot: string): StateStore {
  assertAutopilotDirSafe(projectRoot);
  assertNotSymlink(
    path.join(projectRoot, ".autopilot", "state.db"),
    ".autopilot/state.db",
  );
  return new StateStore(projectRoot);
}

/**
 * Open StateStore for status, or `null` when no state.db yet.
 * Must not create `.autopilot/` / `state.db` (status is read-only).
 */
function openRunnerStoreForStatus(
  projectRoot: string,
): StateStore | null {
  assertAutopilotDirSafe(projectRoot);
  const dbPath = path.join(projectRoot, ".autopilot", "state.db");
  try {
    const st = fs.lstatSync(dbPath);
    if (st.isSymbolicLink()) {
      throw new Error(
        ".autopilot/state.db is a symlink; refusing to open",
      );
    }
    if (!st.isFile()) {
      throw new Error(".autopilot/state.db is not a regular file");
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
  assertNotSymlink(dbPath, ".autopilot/state.db");
  return new StateStore(projectRoot);
}

/** Read `runner:` + plans/locale from `.autopilot/config.yml` (missing → defaults). */
export function loadProjectRunnerSettings(
  projectRoot: string,
): LoadedProjectRunner {
  const root = normalizeProjectRoot(projectRoot);
  const empty: LoadedProjectRunner = {
    fromYaml: {},
    plansDir: "plans",
    locale: "en",
  };
  if (!root) return empty;

  const raw = readConfigYamlText(root);
  if (raw === null) return empty;

  // File present: fail closed on corrupt / non-mapping YAML (locale-set / doctor parity).
  let parsed: unknown;
  try {
    const doc = parseDocument(raw);
    if (doc.errors.length > 0) {
      const first = doc.errors[0]!;
      throw new Error(`config.yml YAML error: ${first.message}`);
    }
    parsed = doc.toJS(YAML_TO_JS_OPTS);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("config.yml")) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`config.yml is not valid YAML: ${msg}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error("config.yml root must be a mapping");
  }

  const runner = isPlainObject(parsed.runner) ? parsed.runner : {};
  const promptModeRaw =
    typeof runner.prompt_mode === "string"
      ? runner.prompt_mode.trim()
      : typeof runner.promptMode === "string"
        ? runner.promptMode.trim()
        : "";
  if (
    promptModeRaw &&
    promptModeRaw !== "argv" &&
    promptModeRaw !== "file" &&
    promptModeRaw !== "auto"
  ) {
    throw new Error(
      `Invalid runner.prompt_mode "${sanitizeSessionDisplayText(promptModeRaw).slice(0, 32)}" (expected argv | file | auto).`,
    );
  }
  const fromYaml: RunnerConfigInput = {
    command: typeof runner.command === "string" ? runner.command : undefined,
    max_iterations: parseYamlMaxIterations(
      runner.max_iterations ?? runner.maxIterations,
    ),
    cwd: typeof runner.cwd === "string" ? runner.cwd : undefined,
    env: sanitizeEnvMap(runner.env),
    prompt_mode: promptModeRaw || undefined,
  };

  const artifacts = isPlainObject(parsed.artifacts) ? parsed.artifacts : {};
  const plansRaw =
    typeof artifacts.plans_dir === "string" ? artifacts.plans_dir : "plans";
  const plansNorm = normalizeInProjectPlansDir(root, plansRaw);
  if (
    typeof artifacts.plans_dir === "string" &&
    artifacts.plans_dir.trim() !== "" &&
    !plansNorm
  ) {
    throw new Error(
      `Invalid artifacts.plans_dir "${sanitizeSessionDisplayText(artifacts.plans_dir).slice(0, 64)}" (must be a relative in-project path).`,
    );
  }

  const localeRaw =
    typeof parsed.locale === "string" ? parsed.locale.trim() : "";
  if (localeRaw && !isLocaleCode(localeRaw)) {
    throw new Error(
      `Unsupported locale "${sanitizeSessionDisplayText(localeRaw).slice(0, 32)}" (en | zh-CN).`,
    );
  }
  const locale = localeRaw || "en";

  return {
    fromYaml,
    plansDir: plansNorm ?? "plans",
    locale,
  };
}

function parsePromptModeFlag(raw: string | undefined): RunnerPromptMode | undefined {
  if (raw === "argv" || raw === "file" || raw === "auto") return raw;
  return undefined;
}

/**
 * Fail closed on explicit invalid max_iterations (CLI flag parity).
 * Omitted / blank → leave undefined for normalize defaults.
 */
function parseYamlMaxIterations(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string" && !raw.trim()) return undefined;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(
      `Invalid runner.max_iterations "${sanitizeSessionDisplayText(String(raw)).slice(0, 32)}" (expected an integer >= 1).`,
    );
  }
  return n;
}

/** YAML runner block + CLI flag overrides → normalized RunnerConfig. */
export function resolveRunnerConfigForStart(
  projectRoot: string,
  flags: RunnerCliFlagOverrides = {},
): { config: RunnerConfig; plansDir: string; locale: string } {
  const loaded = loadProjectRunnerSettings(projectRoot);
  const merged: RunnerConfigInput = {
    ...loaded.fromYaml,
  };
  if (typeof flags.command === "string") merged.command = flags.command;
  if (typeof flags.maxIterations === "number") {
    if (!Number.isInteger(flags.maxIterations) || flags.maxIterations < 1) {
      throw new Error(
        `Invalid --max-iterations "${flags.maxIterations}" (expected an integer >= 1).`,
      );
    }
    merged.max_iterations = flags.maxIterations;
  }
  if (typeof flags.cwd === "string") merged.cwd = flags.cwd;
  if (flags.env) {
    const base = sanitizeEnvMap(merged.env) ?? Object.create(null);
    const overlay = sanitizeEnvMap(flags.env) ?? Object.create(null);
    merged.env = { ...base, ...overlay };
  }
  if (typeof flags.promptMode === "string" && flags.promptMode.trim()) {
    const mode = parsePromptModeFlag(flags.promptMode.trim());
    if (!mode) {
      throw new Error(
        `Invalid --prompt-mode "${flags.promptMode.trim()}" (expected argv | file | auto).`,
      );
    }
    merged.prompt_mode = mode;
  }

  return {
    config: normalizeRunnerConfig(merged),
    plansDir: loaded.plansDir,
    locale: loaded.locale,
  };
}

export type RunnerStartOk = {
  ok: true;
  result: RunnerLoopResult;
  conversationId: string;
  /** CLI process exit: 0 only for clean completed (done/idle). */
  exitCode: number;
};

export type RunnerStartFail = {
  ok: false;
  exitCode: number;
  error: string;
};

export type RunnerStartOutcome = RunnerStartOk | RunnerStartFail;

function exitCodeForLoopResult(result: RunnerLoopResult): number {
  // Plan: done/idle → exit 0; budget exhaust / mid-stop leave work → non-zero.
  return result.outcome === "completed" ? 0 : 1;
}

/**
 * `runner start` — `--run` binds/rebinds; omit `--run` to resume pending/executing.
 */
export async function startRunner(opts: {
  projectRoot: string;
  /** undefined = resume; "" = bare --run; non-empty = --run <slug> */
  runSlug?: string;
  conversationId?: string;
  flags?: RunnerCliFlagOverrides;
  /** Test seam — default CliDriver when command set. */
  driver?: AgentDriver;
}): Promise<RunnerStartOutcome> {
  const root = normalizeProjectRoot(opts.projectRoot);
  if (!root) {
    return { ok: false, exitCode: 1, error: "Invalid project root." };
  }

  let config: RunnerConfig;
  let plansDir: string;
  let locale: string;
  try {
    ({ config, plansDir, locale } = resolveRunnerConfigForStart(
      root,
      opts.flags ?? {},
    ));
  } catch (err) {
    return {
      ok: false,
      exitCode: 1,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!opts.driver && !config.command.trim()) {
    return {
      ok: false,
      exitCode: 1,
      error:
        "runner.command is required (set it in .autopilot/config.yml or --command). " +
        "Init does not write a fake default command.",
    };
  }

  // Validate cwd before applyRun / resume so a bad path cannot leave a bound session.
  try {
    resolveRunnerCwd(root, config.cwd);
  } catch (err) {
    return {
      ok: false,
      exitCode: 1,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const conversationId =
    typeof opts.conversationId === "string" && opts.conversationId.trim()
      ? opts.conversationId.trim()
      : stableRunnerConversationId(root);

  if (!isRunnerConversationIdOk(conversationId)) {
    return {
      ok: false,
      exitCode: 1,
      error: invalidConversationError(conversationId),
    };
  }

  const wantRun = opts.runSlug !== undefined;

  let store: StateStore;
  try {
    if (wantRun) {
      store = openRunnerStoreForStart(root);
    } else {
      // Resume must not create state.db as a failed-start side effect.
      const existing = openRunnerStoreForStatus(root);
      if (!existing) {
        return {
          ok: false,
          exitCode: 1,
          error:
            "No runner session. Start with: npx @autopilot-harness/cli runner start --run <slug>",
        };
      }
      store = existing;
    }
  } catch (err) {
    return {
      ok: false,
      exitCode: 1,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    // Defense in depth (store rules may tighten later).
    if (!store.isConversationIdOk(conversationId)) {
      return {
        ok: false,
        exitCode: 1,
        error: invalidConversationError(conversationId),
      };
    }

    const phaseActions: PhaseActionConfig = { plansDir };

    if (wantRun) {
      // Bind here so needPick → exit 2 (research §8); then loop resumes session.
      const runResult = applyRun(store, conversationId, root, {
        slug: opts.runSlug === "" ? undefined : opts.runSlug,
        config: phaseActions,
        platform: RUNNER_PLATFORM,
      });
      if (!runResult.ok) {
        return {
          ok: false,
          exitCode: runResult.needPick === true ? 2 : 1,
          error: runResult.userMessage,
        };
      }
    } else {
      const resume = canResumeRunnerSession(store, conversationId, root);
      if (!resume.ok) {
        return {
          ok: false,
          exitCode: 1,
          error: resume.message,
        };
      }
    }

    let localeBundle: FollowupLocaleBundle | undefined;
    try {
      localeBundle = loadLocale(locale) as FollowupLocaleBundle;
    } catch {
      // loadLocale falls back to en for unknown codes; keep undefined only on throw.
      localeBundle = undefined;
    }

    const result = await runRunnerLoop({
      store,
      projectRoot: root,
      conversationId,
      config,
      // Already applied above when wantRun — avoid double applyRun.
      phaseActions,
      localeBundle,
      driver: opts.driver,
    });

    if (result.outcome === "error") {
      return {
        ok: false,
        exitCode: 1,
        error: result.errorMessage ?? "Runner failed.",
      };
    }

    return {
      ok: true,
      result,
      conversationId,
      exitCode: exitCodeForLoopResult(result),
    };
  } finally {
    try {
      store.close();
    } catch {
      /* ignore */
    }
  }
}

export type RunnerStatusOk = {
  ok: true;
  lines: string[];
};

export type RunnerStatusFail = {
  ok: false;
  error: string;
};

function statusLinesWithoutSession(
  conversationId: string,
  cfg: RunnerConfig,
  plansDir: string,
): string[] {
  return [
    `Runner conversation: ${sanitizeSessionDisplayText(conversationId)}`,
    `platform: ${RUNNER_PLATFORM}`,
    `runner.command: ${cfg.command.trim() ? "(set)" : "(empty — start will FAIL)"}`,
    `runner.max_iterations: ${cfg.maxIterations}`,
    `plans_dir: ${plansDir}`,
    "session: (none)",
    "hint: npx @autopilot-harness/cli runner start --run <slug>",
  ];
}

/** Human-readable runner session status for this project. */
export function formatRunnerStatus(opts: {
  projectRoot: string;
  conversationId?: string;
}): RunnerStatusOk | RunnerStatusFail {
  const root = normalizeProjectRoot(opts.projectRoot);
  if (!root) {
    return { ok: false, error: "Invalid project root." };
  }

  const conversationId =
    typeof opts.conversationId === "string" && opts.conversationId.trim()
      ? opts.conversationId.trim()
      : stableRunnerConversationId(root);

  if (!isRunnerConversationIdOk(conversationId)) {
    return { ok: false, error: invalidConversationError(conversationId) };
  }

  let loaded: LoadedProjectRunner;
  try {
    loaded = loadProjectRunnerSettings(root);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const cfg = normalizeRunnerConfig(loaded.fromYaml);

  let store: StateStore | null;
  try {
    store = openRunnerStoreForStatus(root);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!store) {
    return {
      ok: true,
      lines: statusLinesWithoutSession(
        conversationId,
        cfg,
        loaded.plansDir,
      ),
    };
  }

  try {
    if (!store.isConversationIdOk(conversationId)) {
      return {
        ok: false,
        error: invalidConversationError(conversationId),
      };
    }

    const session = store.getSession(conversationId);
    const chain = store.getReviewChain(conversationId);
    const pending = chain?.pending_followup?.trim() ?? "";
    const resume = canResumeRunnerSession(store, conversationId, root);

    const lines: string[] = [
      `Runner conversation: ${sanitizeSessionDisplayText(conversationId)}`,
      `platform: ${RUNNER_PLATFORM}`,
      `runner.command: ${cfg.command.trim() ? "(set)" : "(empty — start will FAIL)"}`,
      `runner.max_iterations: ${cfg.maxIterations}`,
      `plans_dir: ${loaded.plansDir}`,
    ];

    if (!session) {
      lines.push("session: (none)");
      lines.push(
        "hint: npx @autopilot-harness/cli runner start --run <slug>",
      );
      return { ok: true, lines };
    }

    lines.push(`phase: ${session.phase}`);
    lines.push(`armed: ${session.armed}`);
    lines.push(`paused: ${session.paused}`);
    lines.push(
      `track: ${sanitizeSessionDisplayText(session.track_id?.trim() || "") || "(none)"}`,
    );
    lines.push(
      `checklist: ${sanitizeSessionDisplayText(session.checklist_path?.trim() || "") || "(none)"}`,
    );
    const pendingDisplay = pending
      ? sanitizeSessionDisplayText(pending)
      : "";
    lines.push(
      pendingDisplay
        ? `pending_followup: yes (${pendingDisplay.slice(0, 80)}${pendingDisplay.length > 80 ? "…" : ""})`
        : "pending_followup: (none)",
    );
    lines.push(
      resume.ok
        ? `can_resume: yes (${resume.reason})`
        : `can_resume: no (${resume.reason})`,
    );
    if (!resume.ok) {
      lines.push(`hint: ${resume.message}`);
    } else {
      lines.push("hint: npx @autopilot-harness/cli runner start");
    }
    return { ok: true, lines };
  } finally {
    try {
      store.close();
    } catch {
      /* ignore */
    }
  }
}

/** Format a successful loop result for stdout. */
export function formatRunnerStartSuccess(result: RunnerLoopResult): string[] {
  const last = result.lastMessage
    ? sanitizeSessionDisplayText(result.lastMessage)
    : "";
  return [
    `outcome: ${result.outcome}`,
    `iterations: ${result.iterations}`,
    `conversation: ${sanitizeSessionDisplayText(result.conversationId)}`,
    ...(last
      ? [
          `last_message: ${last.slice(0, 120)}${
            last.length > 120 ? "…" : ""
          }`,
        ]
      : []),
  ];
}
