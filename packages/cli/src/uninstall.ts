import fs from "node:fs";
import path from "node:path";
import {
  stripAutopilotHooks,
  validateHooksShape,
  isAutopilotCommand,
} from "./init/hooks-merge.js";
import {
  stripAutopilotClaudeSettings,
  claudeSettingsContainAutopilot,
  validateClaudeSettingsShape,
  type ClaudeSettingsFile,
} from "./init/claude-settings-merge.js";
import {
  stripAutopilotCodexHooks,
  codexHooksContainAutopilot,
  validateCodexHooksShape,
  type CodexHooksFile,
} from "./init/codex-hooks-merge.js";
import {
  stripAutopilotCopilotHooks,
  copilotHooksContainAutopilot,
  validateCopilotHooksShape,
  type CopilotHooksFile,
} from "./init/copilot-hooks-merge.js";
import {
  stripAutopilotGrokHooks,
  grokHooksContainAutopilot,
  grokHooksFileIsVacant,
  validateGrokHooksShape,
  type GrokHooksFile,
} from "./init/grok-hooks-merge.js";
import {
  stripAutopilotGeminiSettings,
  geminiSettingsContainAutopilot,
  geminiSettingsFileIsVacant,
  validateGeminiSettingsShape,
  type GeminiSettingsFile,
  GEMINI_SETTINGS_REL_PATH,
} from "./init/gemini-settings-merge.js";
import {
  stripAutopilotFactoryHooks,
  factoryHooksContainAutopilot,
  factoryHooksFileIsVacant,
  validateFactoryHooksShape,
  type FactoryHooksFile,
  FACTORY_HOOKS_REL_PATH,
} from "./init/factory-hooks-merge.js";
import {
  stripAutopilotAntigravityHooks,
  antigravityHooksContainAutopilot,
  antigravityHooksFileIsVacant,
  validateAntigravityHooksShape,
  type AntigravityHooksFile,
  ANTIGRAVITY_HOOKS_REL_PATH,
} from "./init/antigravity-hooks-merge.js";
import {
  kimiConfigTomlPath,
  kimiTomlHasAutopilotHookTables,
  readKimiConfigToml,
  removeAutopilotKimiHooks,
  resolveKimiCodeHome,
} from "./init/kimi-hooks-merge.js";
import {
  hermesConfigYamlContainsAutopilot,
  hermesConfigYamlPath,
  readHermesConfigYaml,
  resolveHermesHome,
  stripAutopilotHermesConfigYaml,
} from "./init/hermes-hooks-merge.js";
import { readConfigInstallHints } from "./init/config-merge.js";
import { configWantsInstallableHost } from "./init/platforms.js";
import {
  AUTOPILOT_SKILL_NAMES,
  AUTOPILOT_WORKFLOW_FILES,
} from "./init/install.js";
import type { HooksFile } from "./init/types.js";
import {
  assertNotSymlink,
  assertParentDirInProject,
  assertRealpathInside,
  assertWrittenInsideProject,
  isRealDirectory,
  isRealRegularFile,
  resolveProjectRootOrThrow,
} from "./project-fs.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
  writeFileReplaceSync,
} from "./read-untrusted-file.js";

export interface UninstallOptions {
  projectRoot: string;
  dryRun?: boolean;
  /**
   * Remove the entire `.autopilot/` directory (config + state + bin + pin).
   * Never touches `plans/`.
   */
  purgeAll?: boolean;
}

export interface UninstallOk {
  ok: true;
  dryRun: boolean;
  actions: string[];
  removed: string[];
  kept: string[];
}

export interface UninstallFail {
  ok: false;
  error: string;
}

export type UninstallResult = UninstallOk | UninstallFail;

function writeJsonAtomic(
  filePath: string,
  contents: string,
  projectRoot: string,
  label: string,
): void {
  assertParentDirInProject(projectRoot, filePath, label);
  writeFileReplaceSync(filePath, contents);
  assertWrittenInsideProject(projectRoot, filePath, label);
}

function readHooksFile(
  hooksPath: string,
): { ok: true; value: HooksFile } | { ok: false; error: string } {
  try {
    assertNotSymlink(hooksPath, ".cursor/hooks.json");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  try {
    const st = fs.lstatSync(hooksPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        error: ".cursor/hooks.json is a symlink; refusing to open",
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error:
          ".cursor/hooks.json exists and is not a regular file; refusing to uninstall",
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: { version: 1, hooks: {} } };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot access hooks.json: ${msg}` };
  }
  try {
    const raw = readUntrustedUtf8File(
      hooksPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      ".cursor/hooks.json",
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error:
          ".cursor/hooks.json is not a JSON object; fix or remove it before uninstall.",
      };
    }
    const hooks = parsed as HooksFile;
    // Match init: missing/null hooks → treat as empty (still allow skill/bin cleanup).
    if (hooks.hooks != null && typeof hooks.hooks !== "object") {
      return {
        ok: false,
        error:
          '.cursor/hooks.json has invalid "hooks" field; fix or remove it before uninstall.',
      };
    }
    if (!hooks.hooks) {
      return { ok: true, value: { version: hooks.version ?? 1, hooks: {} } };
    }
    if (Array.isArray(hooks.hooks)) {
      return {
        ok: false,
        error:
          '.cursor/hooks.json "hooks" must be an object, not an array; fix or remove it before uninstall.',
      };
    }
    const shape = validateHooksShape(hooks);
    if (shape) return { ok: false, error: shape };
    return { ok: true, value: hooks };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read hooks.json: ${msg}` };
  }
}

function hooksContainAutopilot(hooks: HooksFile): boolean {
  for (const value of Object.values(hooks.hooks ?? {})) {
    if (!Array.isArray(value)) continue;
    if (value.some((h) => isAutopilotCommand(h?.command))) {
      return true;
    }
  }
  return false;
}

function readClaudeSettingsFile(
  settingsPath: string,
):
  | { ok: true; value: ClaudeSettingsFile | null }
  | { ok: false; error: string } {
  try {
    assertNotSymlink(settingsPath, ".claude/settings.json");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  try {
    const st = fs.lstatSync(settingsPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        error: ".claude/settings.json is a symlink; refusing to open",
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error:
          ".claude/settings.json exists and is not a regular file; refusing to uninstall",
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot access settings.json: ${msg}` };
  }
  try {
    const raw = readUntrustedUtf8File(
      settingsPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      ".claude/settings.json",
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error:
          ".claude/settings.json is not a JSON object; fix or remove it before uninstall.",
      };
    }
    const settings = parsed as ClaudeSettingsFile;
    const shape = validateClaudeSettingsShape(settings);
    if (shape) return { ok: false, error: shape };
    return { ok: true, value: settings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read settings.json: ${msg}` };
  }
}

function readCodexHooksFile(
  hooksPath: string,
):
  | { ok: true; value: CodexHooksFile | null }
  | { ok: false; error: string } {
  try {
    assertNotSymlink(hooksPath, ".codex/hooks.json");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  try {
    const st = fs.lstatSync(hooksPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        error: ".codex/hooks.json is a symlink; refusing to open",
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error:
          ".codex/hooks.json exists and is not a regular file; refusing to uninstall",
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot access .codex/hooks.json: ${msg}` };
  }
  try {
    const raw = readUntrustedUtf8File(
      hooksPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      ".codex/hooks.json",
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error:
          ".codex/hooks.json is not a JSON object; fix or remove it before uninstall.",
      };
    }
    const file = parsed as CodexHooksFile;
    const shape = validateCodexHooksShape(file);
    if (shape) return { ok: false, error: `.codex/hooks.json: ${shape}` };
    return { ok: true, value: file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read .codex/hooks.json: ${msg}` };
  }
}

function readCopilotHooksFile(
  hooksPath: string,
):
  | { ok: true; value: CopilotHooksFile | null }
  | { ok: false; error: string } {
  const label = ".github/hooks/autopilot-harness.json";
  try {
    assertNotSymlink(hooksPath, label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  try {
    const st = fs.lstatSync(hooksPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        error: `${label} is a symlink; refusing to open`,
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error: `${label} exists and is not a regular file; refusing to uninstall`,
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot access ${label}: ${msg}` };
  }
  try {
    const raw = readUntrustedUtf8File(
      hooksPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      label,
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `${label} is not a JSON object; fix or remove it before uninstall.`,
      };
    }
    const file = parsed as CopilotHooksFile;
    const shape = validateCopilotHooksShape(file);
    if (shape) return { ok: false, error: `${label}: ${shape}` };
    return { ok: true, value: file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read ${label}: ${msg}` };
  }
}

function readGrokHooksFile(
  hooksPath: string,
):
  | { ok: true; value: GrokHooksFile | null }
  | { ok: false; error: string } {
  const label = ".grok/hooks/autopilot-harness.json";
  try {
    assertNotSymlink(hooksPath, label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  try {
    const st = fs.lstatSync(hooksPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        error: `${label} is a symlink; refusing to open`,
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error: `${label} exists and is not a regular file; refusing to uninstall`,
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot access ${label}: ${msg}` };
  }
  try {
    const raw = readUntrustedUtf8File(
      hooksPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      label,
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `${label} is not a JSON object; fix or remove it before uninstall.`,
      };
    }
    const file = parsed as GrokHooksFile;
    const shape = validateGrokHooksShape(file);
    if (shape) return { ok: false, error: `${label}: ${shape}` };
    return { ok: true, value: file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read ${label}: ${msg}` };
  }
}

function readGeminiSettingsFile(
  settingsPath: string,
):
  | { ok: true; value: GeminiSettingsFile | null }
  | { ok: false; error: string } {
  const label = GEMINI_SETTINGS_REL_PATH;
  try {
    assertNotSymlink(settingsPath, label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  try {
    const st = fs.lstatSync(settingsPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        error: `${label} is a symlink; refusing to open`,
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error: `${label} exists and is not a regular file; refusing to uninstall`,
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot access ${label}: ${msg}` };
  }
  try {
    const raw = readUntrustedUtf8File(
      settingsPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      label,
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `${label} is not a JSON object; fix or remove it before uninstall.`,
      };
    }
    const file = parsed as GeminiSettingsFile;
    const shape = validateGeminiSettingsShape(file);
    if (shape) return { ok: false, error: `${label}: ${shape}` };
    return { ok: true, value: file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read ${label}: ${msg}` };
  }
}

function readFactoryHooksFile(
  hooksPath: string,
):
  | { ok: true; value: FactoryHooksFile | null }
  | { ok: false; error: string } {
  const label = FACTORY_HOOKS_REL_PATH;
  try {
    assertNotSymlink(hooksPath, label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  try {
    const st = fs.lstatSync(hooksPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        error: `${label} is a symlink; refusing to open`,
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error: `${label} exists and is not a regular file; refusing to uninstall`,
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot access ${label}: ${msg}` };
  }
  try {
    const raw = readUntrustedUtf8File(
      hooksPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      label,
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `${label} is not a JSON object; fix or remove it before uninstall.`,
      };
    }
    const file = parsed as FactoryHooksFile;
    const shape = validateFactoryHooksShape(file);
    if (shape) return { ok: false, error: `${label}: ${shape}` };
    return { ok: true, value: file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read ${label}: ${msg}` };
  }
}

function readAntigravityHooksFile(
  hooksPath: string,
):
  | { ok: true; value: AntigravityHooksFile | null }
  | { ok: false; error: string } {
  const label = ANTIGRAVITY_HOOKS_REL_PATH;
  try {
    assertNotSymlink(hooksPath, label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  try {
    const st = fs.lstatSync(hooksPath);
    if (st.isSymbolicLink()) {
      return {
        ok: false,
        error: `${label} is a symlink; refusing to open`,
      };
    }
    if (!st.isFile()) {
      return {
        ok: false,
        error: `${label} exists and is not a regular file; refusing to uninstall`,
      };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: true, value: null };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot access ${label}: ${msg}` };
  }
  try {
    const raw = readUntrustedUtf8File(
      hooksPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      label,
    );
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `${label} is not a JSON object; fix or remove it before uninstall.`,
      };
    }
    const file = parsed as AntigravityHooksFile;
    const shape = validateAntigravityHooksShape(file);
    if (shape) return { ok: false, error: `${label}: ${shape}` };
    return { ok: true, value: file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Cannot read ${label}: ${msg}` };
  }
}

function safeRemovePath(
  projectRoot: string,
  targetPath: string,
  label: string,
  removed: string[],
  dryRun: boolean,
  actions: string[],
): void {
  try {
    assertNotSymlink(targetPath, label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/symlink/i.test(msg)) {
      actions.push(`skip ${label} (symlink)`);
      return;
    }
    throw err;
  }
  let st: fs.Stats;
  try {
    st = fs.lstatSync(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    actions.push(`skip ${label} (symlink)`);
    return;
  }
  if (st.isDirectory()) {
    assertRealpathInside(projectRoot, targetPath, label);
    actions.push(`remove ${label}/`);
    if (!dryRun) {
      fs.rmSync(targetPath, { recursive: true, force: false });
      removed.push(path.relative(projectRoot, targetPath) + "/");
    }
    return;
  }
  if (st.isFile()) {
    assertRealpathInside(projectRoot, targetPath, label);
    actions.push(`remove ${label}`);
    if (!dryRun) {
      fs.unlinkSync(targetPath);
      removed.push(path.relative(projectRoot, targetPath));
    }
    return;
  }
  // FIFO/socket/device etc.: do not report success while leaving Autopilot-named paths.
  throw new Error(
    `${label} exists and is not a regular file or directory; refusing to uninstall`,
  );
}

/**
 * Remove Autopilot skill trees under `$HERMES_HOME` (outside project).
 * Containment is vs Hermes home, not projectRoot.
 */
function safeRemoveHermesSkillPath(
  hermesHome: string,
  targetPath: string,
  label: string,
  removed: string[],
  dryRun: boolean,
  actions: string[],
): void {
  try {
    assertNotSymlink(targetPath, label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/symlink/i.test(msg)) {
      actions.push(`skip ${label} (symlink)`);
      return;
    }
    throw err;
  }
  let st: fs.Stats;
  try {
    st = fs.lstatSync(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    actions.push(`skip ${label} (symlink)`);
    return;
  }
  if (st.isDirectory()) {
    assertRealpathInside(hermesHome, targetPath, label);
    actions.push(`remove ${label}/`);
    if (!dryRun) {
      fs.rmSync(targetPath, { recursive: true, force: false });
      removed.push(`${label}/`);
    }
    return;
  }
  if (st.isFile()) {
    assertRealpathInside(hermesHome, targetPath, label);
    actions.push(`remove ${label}`);
    if (!dryRun) {
      fs.unlinkSync(targetPath);
      removed.push(label);
    }
    return;
  }
  throw new Error(
    `${label} exists and is not a regular file or directory; refusing to uninstall`,
  );
}

function pathExistsViaLstat(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Collapse controls / whitespace before reflecting FS errors into action lines. */
function formatUninstallSkipDetail(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** Best-effort: which installable hosts config declares (missing/unreadable → none). */
function projectWantsInstallableHosts(configPath: string): {
  claude: boolean;
  codex: boolean;
  kimi: boolean;
  copilot: boolean;
  grok: boolean;
  gemini: boolean;
  factory: boolean;
  hermes: boolean;
  antigravity: boolean;
} {
  try {
    const yaml = readUntrustedUtf8File(
      configPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      ".autopilot/config.yml",
    );
    const platforms = readConfigInstallHints(yaml).platforms;
    return {
      claude: configWantsInstallableHost(platforms, "claude-code"),
      codex: configWantsInstallableHost(platforms, "codex"),
      kimi: configWantsInstallableHost(platforms, "kimi-code"),
      copilot: configWantsInstallableHost(platforms, "copilot-cli"),
      grok: configWantsInstallableHost(platforms, "grok-build"),
      gemini: configWantsInstallableHost(platforms, "gemini-cli"),
      factory: configWantsInstallableHost(platforms, "factory-droid"),
      hermes: configWantsInstallableHost(platforms, "hermes-agent"),
      antigravity: configWantsInstallableHost(platforms, "antigravity"),
    };
  } catch {
    return {
      claude: false,
      codex: false,
      kimi: false,
      copilot: false,
      grok: false,
      gemini: false,
      factory: false,
      hermes: false,
      antigravity: false,
    };
  }
}

/**
 * Before mutating hooks.json: ensure any non-symlink removal target realpaths
 * inside the project (bind mounts / junctions under skills etc.).
 * Leaf symlinks are deferred to safeRemovePath (skip, do not follow).
 */
function assertRemovalTargetSafe(
  projectRoot: string,
  targetPath: string,
  label: string,
): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    throw err;
  }
  if (st.isSymbolicLink()) return;
  assertRealpathInside(projectRoot, targetPath, label);
}

/**
 * Uninstall Autopilot project wiring.
 *
 * Default: strip Autopilot hooks, remove skills/workflows/bin/pin;
 * keep `.autopilot/config.yml`, `state.db`, and `plans/`.
 * `--purge-all`: also remove the entire `.autopilot/` directory.
 * Never deletes `plans/`. Does not edit shell rc or `.gitignore`.
 */
export function uninstallProject(opts: UninstallOptions): UninstallResult {
  if (typeof opts.projectRoot !== "string" || opts.projectRoot.trim() === "") {
    return { ok: false, error: "projectRoot must be a non-empty string" };
  }

  let projectRoot: string;
  try {
    projectRoot = resolveProjectRootOrThrow(opts.projectRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  const dryRun = Boolean(opts.dryRun);
  const purgeAll = Boolean(opts.purgeAll);
  const actions: string[] = [];
  const removed: string[] = [];
  const kept: string[] = [];
  let hooksStripped = false;

  try {
    const autopilotDir = path.join(projectRoot, ".autopilot");
    const configPath = path.join(autopilotDir, "config.yml");
    const pinPath = path.join(autopilotDir, "pin.json");
    const binDir = path.join(autopilotDir, "bin");
    const cursorDir = path.join(projectRoot, ".cursor");
    const hooksPath = path.join(cursorDir, "hooks.json");
    const skillsRoot = path.join(cursorDir, "skills");
    const claudeDir = path.join(projectRoot, ".claude");
    const claudeSettingsPath = path.join(claudeDir, "settings.json");
    const claudeSkillsRoot = path.join(claudeDir, "skills");
    const codexDir = path.join(projectRoot, ".codex");
    const codexHooksPath = path.join(codexDir, "hooks.json");
    const githubDir = path.join(projectRoot, ".github");
    const githubHooksDir = path.join(githubDir, "hooks");
    const copilotHooksPath = path.join(
      githubHooksDir,
      "autopilot-harness.json",
    );
    const grokDir = path.join(projectRoot, ".grok");
    const grokHooksDir = path.join(grokDir, "hooks");
    const grokHooksPath = path.join(grokHooksDir, "autopilot-harness.json");
    const geminiDir = path.join(projectRoot, ".gemini");
    const geminiSettingsPath = path.join(geminiDir, "settings.json");
    const geminiSkillsRoot = path.join(geminiDir, "skills");
    const factoryDir = path.join(projectRoot, ".factory");
    const factoryHooksPath = path.join(factoryDir, "hooks.json");
    const factorySkillsRoot = path.join(factoryDir, "skills");
    const agentsDir = path.join(projectRoot, ".agents");
    const antigravityHooksPath = path.join(agentsDir, "hooks.json");
    const agentsSkillsRoot = path.join(agentsDir, "skills");
    const docsAutopilotDir = path.join(projectRoot, "docs", "autopilot");
    const workflowsDir = path.join(docsAutopilotDir, "workflows");
    const quickstartPath = path.join(docsAutopilotDir, "quickstart.md");

    const {
      claude: wantClaude,
      codex: wantCodex,
      kimi: wantKimi,
      copilot: wantCopilot,
      grok: wantGrok,
      gemini: wantGemini,
      factory: wantFactory,
      hermes: wantHermes,
      antigravity: wantAntigravity,
    } = projectWantsInstallableHosts(configPath);
    // Only fail-closed on .claude/.codex/.github/.grok/.gemini/.factory/.agents trees when config declares
    // that host. Leftover Cursor-only host dirs must not block uninstall —
    // soft-skip below. Kimi/Hermes use user-home config (outside project) —
    // strip separately.

    // Refuse symlink-swapped host dirs before any mutate/rm (escape + partial-strip).
    // isRealDirectory is false for symlinks — probe with lstat so links are caught.
    // Include skills/workflows so a planted link fails closed *before* hooks.json write.
    try {
      const dirs: Array<readonly [string, string]> = [
        [cursorDir, ".cursor/"],
        [skillsRoot, ".cursor/skills/"],
        [autopilotDir, ".autopilot/"],
        [binDir, ".autopilot/bin/"],
        [docsAutopilotDir, "docs/autopilot/"],
        [workflowsDir, "docs/autopilot/workflows/"],
      ];
      if (wantClaude) {
        dirs.push([claudeDir, ".claude/"], [claudeSkillsRoot, ".claude/skills/"]);
      }
      if (wantCodex) {
        dirs.push([codexDir, ".codex/"]);
      }
      if (wantCopilot) {
        dirs.push(
          [githubDir, ".github/"],
          [githubHooksDir, ".github/hooks/"],
        );
      }
      if (wantGrok) {
        dirs.push([grokDir, ".grok/"], [grokHooksDir, ".grok/hooks/"]);
      }
      if (wantGemini) {
        dirs.push(
          [geminiDir, ".gemini/"],
          [geminiSkillsRoot, ".gemini/skills/"],
        );
      }
      if (wantFactory) {
        dirs.push(
          [factoryDir, ".factory/"],
          [factorySkillsRoot, ".factory/skills/"],
        );
      }
      if (wantAntigravity) {
        dirs.push(
          [agentsDir, ".agents/"],
          [agentsSkillsRoot, ".agents/skills/"],
        );
      }
      for (const [dir, label] of dirs) {
        if (!pathExistsViaLstat(dir)) continue;
        assertNotSymlink(dir, label);
        assertRealpathInside(projectRoot, dir, label);
        // Skills roots must be real directories (Hermes parity). A planted file
        // named `skills` must fail closed before hooks strip / leaf rm.
        if (label.endsWith("skills/") && !isRealDirectory(dir)) {
          throw new Error(`${label} exists and is not a directory`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }

    // Leaf targets: catch bind-mount / junction escape before hooks.json write.
    try {
      for (const name of AUTOPILOT_SKILL_NAMES) {
        assertRemovalTargetSafe(
          projectRoot,
          path.join(skillsRoot, name),
          `.cursor/skills/${name}`,
        );
        if (wantClaude) {
          assertRemovalTargetSafe(
            projectRoot,
            path.join(claudeSkillsRoot, name),
            `.claude/skills/${name}`,
          );
        }
        if (wantGemini) {
          assertRemovalTargetSafe(
            projectRoot,
            path.join(geminiSkillsRoot, name),
            `.gemini/skills/${name}`,
          );
        }
        if (wantFactory) {
          assertRemovalTargetSafe(
            projectRoot,
            path.join(factorySkillsRoot, name),
            `.factory/skills/${name}`,
          );
        }
        if (wantAntigravity) {
          assertRemovalTargetSafe(
            projectRoot,
            path.join(agentsSkillsRoot, name),
            `.agents/skills/${name}`,
          );
        }
      }
      if (wantHermes) {
        const hermesHome = resolveHermesHome();
        assertNotSymlink(hermesHome, "Hermes home/");
        if (pathExistsViaLstat(hermesHome) && !isRealDirectory(hermesHome)) {
          throw new Error("Hermes home/ exists and is not a directory");
        }
        const hermesSkillsRoot = path.join(hermesHome, "skills");
        // Skills root symlink: fail closed (escape). Leaf skill symlinks:
        // soft-skip later like Cursor — do not block hooks strip.
        if (pathExistsViaLstat(hermesSkillsRoot)) {
          assertNotSymlink(hermesSkillsRoot, "$HERMES_HOME/skills/");
          if (!isRealDirectory(hermesSkillsRoot)) {
            throw new Error(
              "$HERMES_HOME/skills/ exists and is not a directory",
            );
          }
          assertRealpathInside(
            hermesHome,
            hermesSkillsRoot,
            "$HERMES_HOME/skills/",
          );
        }
        for (const name of AUTOPILOT_SKILL_NAMES) {
          const skillDir = path.join(hermesSkillsRoot, name);
          let st: fs.Stats;
          try {
            st = fs.lstatSync(skillDir);
          } catch (err) {
            const code = (err as NodeJS.ErrnoException)?.code;
            if (code === "ENOENT") continue;
            throw err;
          }
          if (st.isSymbolicLink()) continue;
          assertRealpathInside(
            hermesHome,
            skillDir,
            `$HERMES_HOME/skills/${name}`,
          );
        }
      }
      for (const name of AUTOPILOT_WORKFLOW_FILES) {
        assertRemovalTargetSafe(
          projectRoot,
          path.join(workflowsDir, name),
          `docs/autopilot/workflows/${name}`,
        );
      }
      assertRemovalTargetSafe(
        projectRoot,
        quickstartPath,
        "docs/autopilot/quickstart.md",
      );
      assertRemovalTargetSafe(
        projectRoot,
        pinPath,
        ".autopilot/pin.json",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }

    let found = false;

    // --- Cursor hooks ---
    const hooksPre = readHooksFile(hooksPath);
    if (!hooksPre.ok) {
      return { ok: false, error: hooksPre.error };
    }
    if (hooksContainAutopilot(hooksPre.value)) {
      found = true;
      actions.push("strip Autopilot entries from .cursor/hooks.json");
      if (!dryRun) {
        // Re-read immediately before write (same TOCTOU shrink as init).
        const hooksFresh = readHooksFile(hooksPath);
        if (!hooksFresh.ok) {
          return { ok: false, error: hooksFresh.error };
        }
        if (!hooksContainAutopilot(hooksFresh.value)) {
          actions.push(
            "hooks.json no longer has Autopilot entries (skipped write)",
          );
        } else {
          // Re-assert immediately before write (init parity; shrink symlink race).
          assertNotSymlink(cursorDir, ".cursor/");
          assertNotSymlink(hooksPath, ".cursor/hooks.json");
          const stripped = stripAutopilotHooks(hooksFresh.value);
          writeJsonAtomic(
            hooksPath,
            JSON.stringify(stripped, null, 2) + "\n",
            projectRoot,
            ".cursor/hooks.json",
          );
          hooksStripped = true;
          removed.push(
            path.relative(projectRoot, hooksPath) + " (Autopilot entries)",
          );
        }
      }
    }

    // --- Claude settings ---
    // Cursor-only (etc.): ignore unreadable leftover settings (init/upgrade parity).
    // Claude-enabled configs still fail closed so Autopilot markers are not left behind.
    // When !wantClaude, never abort uninstall after Cursor work — soft-skip Claude strip
    // failures (corrupt/symlink parent/TOCTOU) instead of failing the whole command.
    const claudePre = readClaudeSettingsFile(claudeSettingsPath);
    if (!claudePre.ok) {
      if (wantClaude) {
        return { ok: false, error: claudePre.error };
      }
      actions.push(
        `skip .claude/settings.json (${formatUninstallSkipDetail(claudePre.error)})`,
      );
    } else if (claudeSettingsContainAutopilot(claudePre.value)) {
      const stripClaudeSettings = (): void => {
        assertNotSymlink(claudeDir, ".claude/");
        assertNotSymlink(claudeSettingsPath, ".claude/settings.json");
        if (dryRun) {
          found = true;
          actions.push("strip Autopilot entries from .claude/settings.json");
          return;
        }
        const claudeFresh = readClaudeSettingsFile(claudeSettingsPath);
        if (!claudeFresh.ok) {
          throw new Error(claudeFresh.error);
        }
        const freshSettings = claudeFresh.value;
        if (
          freshSettings == null ||
          !claudeSettingsContainAutopilot(freshSettings)
        ) {
          found = true;
          actions.push("strip Autopilot entries from .claude/settings.json");
          actions.push(
            "settings.json no longer has Autopilot entries (skipped write)",
          );
          return;
        }
        const stripped = stripAutopilotClaudeSettings(freshSettings);
        writeJsonAtomic(
          claudeSettingsPath,
          JSON.stringify(stripped, null, 2) + "\n",
          projectRoot,
          ".claude/settings.json",
        );
        found = true;
        hooksStripped = true;
        actions.push("strip Autopilot entries from .claude/settings.json");
        removed.push(
          path.relative(projectRoot, claudeSettingsPath) +
            " (Autopilot entries)",
        );
      };

      try {
        stripClaudeSettings();
      } catch (err) {
        if (wantClaude) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip .claude/settings.json (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Codex hooks ---
    // Cursor-only (etc.): soft-skip unreadable leftover .codex/hooks.json.
    // Codex-enabled configs fail closed so Autopilot markers are not left behind.
    const codexPre = readCodexHooksFile(codexHooksPath);
    if (!codexPre.ok) {
      if (wantCodex) {
        return { ok: false, error: codexPre.error };
      }
      actions.push(
        `skip .codex/hooks.json (${formatUninstallSkipDetail(codexPre.error)})`,
      );
    } else if (codexHooksContainAutopilot(codexPre.value)) {
      const stripCodexHooks = (): void => {
        assertNotSymlink(codexDir, ".codex/");
        assertNotSymlink(codexHooksPath, ".codex/hooks.json");
        if (dryRun) {
          found = true;
          actions.push("strip Autopilot entries from .codex/hooks.json");
          return;
        }
        const codexFresh = readCodexHooksFile(codexHooksPath);
        if (!codexFresh.ok) {
          throw new Error(codexFresh.error);
        }
        const freshFile = codexFresh.value;
        if (freshFile == null || !codexHooksContainAutopilot(freshFile)) {
          found = true;
          actions.push("strip Autopilot entries from .codex/hooks.json");
          actions.push(
            ".codex/hooks.json no longer has Autopilot entries (skipped write)",
          );
          return;
        }
        const stripped = stripAutopilotCodexHooks(freshFile);
        writeJsonAtomic(
          codexHooksPath,
          JSON.stringify(stripped, null, 2) + "\n",
          projectRoot,
          ".codex/hooks.json",
        );
        found = true;
        hooksStripped = true;
        actions.push("strip Autopilot entries from .codex/hooks.json");
        removed.push(
          path.relative(projectRoot, codexHooksPath) + " (Autopilot entries)",
        );
      };

      try {
        stripCodexHooks();
      } catch (err) {
        if (wantCodex) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip .codex/hooks.json (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Copilot CLI hooks (.github/hooks/autopilot-harness.json) ---
    // Fingerprint strip only; do not delete the whole .github/ tree.
    const copilotLabel = ".github/hooks/autopilot-harness.json";
    const copilotPre = readCopilotHooksFile(copilotHooksPath);
    if (!copilotPre.ok) {
      if (wantCopilot) {
        return { ok: false, error: copilotPre.error };
      }
      actions.push(
        `skip ${copilotLabel} (${formatUninstallSkipDetail(copilotPre.error)})`,
      );
    } else if (copilotHooksContainAutopilot(copilotPre.value)) {
      const stripCopilotHooks = (): void => {
        assertNotSymlink(githubDir, ".github/");
        assertNotSymlink(githubHooksDir, ".github/hooks/");
        assertNotSymlink(copilotHooksPath, copilotLabel);
        if (dryRun) {
          found = true;
          actions.push(`strip Autopilot entries from ${copilotLabel}`);
          return;
        }
        const copilotFresh = readCopilotHooksFile(copilotHooksPath);
        if (!copilotFresh.ok) {
          throw new Error(copilotFresh.error);
        }
        const freshFile = copilotFresh.value;
        if (freshFile == null || !copilotHooksContainAutopilot(freshFile)) {
          found = true;
          actions.push(`strip Autopilot entries from ${copilotLabel}`);
          actions.push(
            `${copilotLabel} no longer has Autopilot entries (skipped write)`,
          );
          return;
        }
        const stripped = stripAutopilotCopilotHooks(freshFile);
        writeJsonAtomic(
          copilotHooksPath,
          JSON.stringify(stripped, null, 2) + "\n",
          projectRoot,
          copilotLabel,
        );
        found = true;
        hooksStripped = true;
        actions.push(`strip Autopilot entries from ${copilotLabel}`);
        removed.push(
          path.relative(projectRoot, copilotHooksPath) + " (Autopilot entries)",
        );
      };

      try {
        stripCopilotHooks();
      } catch (err) {
        if (wantCopilot) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip ${copilotLabel} (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Grok Build hooks (.grok/hooks/autopilot-harness.json) ---
    // Fingerprint strip only; empty-after-strip → unlink file; leave siblings.
    const grokLabel = ".grok/hooks/autopilot-harness.json";
    const grokPre = readGrokHooksFile(grokHooksPath);
    if (!grokPre.ok) {
      if (wantGrok) {
        return { ok: false, error: grokPre.error };
      }
      actions.push(
        `skip ${grokLabel} (${formatUninstallSkipDetail(grokPre.error)})`,
      );
    } else if (grokHooksContainAutopilot(grokPre.value)) {
      const stripGrokHooks = (): void => {
        assertNotSymlink(grokDir, ".grok/");
        assertNotSymlink(grokHooksDir, ".grok/hooks/");
        assertNotSymlink(grokHooksPath, grokLabel);
        if (dryRun) {
          found = true;
          const preview =
            grokPre.value != null
              ? stripAutopilotGrokHooks(grokPre.value)
              : null;
          if (grokHooksFileIsVacant(preview)) {
            actions.push(`unlink empty ${grokLabel}`);
          } else {
            actions.push(`strip Autopilot entries from ${grokLabel}`);
          }
          return;
        }
        const grokFresh = readGrokHooksFile(grokHooksPath);
        if (!grokFresh.ok) {
          throw new Error(grokFresh.error);
        }
        const freshFile = grokFresh.value;
        if (freshFile == null || !grokHooksContainAutopilot(freshFile)) {
          found = true;
          actions.push(`strip Autopilot entries from ${grokLabel}`);
          actions.push(
            `${grokLabel} no longer has Autopilot entries (skipped write)`,
          );
          return;
        }
        const stripped = stripAutopilotGrokHooks(freshFile);
        if (grokHooksFileIsVacant(stripped)) {
          assertRealpathInside(projectRoot, grokHooksPath, grokLabel);
          fs.unlinkSync(grokHooksPath);
          found = true;
          hooksStripped = true;
          actions.push(`unlink empty ${grokLabel}`);
          removed.push(path.relative(projectRoot, grokHooksPath));
          return;
        }
        writeJsonAtomic(
          grokHooksPath,
          JSON.stringify(stripped, null, 2) + "\n",
          projectRoot,
          grokLabel,
        );
        found = true;
        hooksStripped = true;
        actions.push(`strip Autopilot entries from ${grokLabel}`);
        removed.push(
          path.relative(projectRoot, grokHooksPath) + " (Autopilot entries)",
        );
      };

      try {
        stripGrokHooks();
      } catch (err) {
        if (wantGrok) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip ${grokLabel} (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Gemini CLI settings (.gemini/settings.json) ---
    // Fingerprint strip only; keep file when foreign keys remain (hooksConfig /
    // general / MCP / foreign hooks). Vacant after strip → unlink.
    const geminiLabel = GEMINI_SETTINGS_REL_PATH;
    const geminiPre = readGeminiSettingsFile(geminiSettingsPath);
    if (!geminiPre.ok) {
      if (wantGemini) {
        return { ok: false, error: geminiPre.error };
      }
      actions.push(
        `skip ${geminiLabel} (${formatUninstallSkipDetail(geminiPre.error)})`,
      );
    } else if (geminiSettingsContainAutopilot(geminiPre.value)) {
      const stripGeminiSettings = (): void => {
        assertNotSymlink(geminiDir, ".gemini/");
        assertNotSymlink(geminiSettingsPath, geminiLabel);
        if (dryRun) {
          found = true;
          const preview =
            geminiPre.value != null
              ? stripAutopilotGeminiSettings(geminiPre.value)
              : null;
          if (geminiSettingsFileIsVacant(preview)) {
            actions.push(`unlink empty ${geminiLabel}`);
          } else {
            actions.push(`strip Autopilot entries from ${geminiLabel}`);
          }
          return;
        }
        const geminiFresh = readGeminiSettingsFile(geminiSettingsPath);
        if (!geminiFresh.ok) {
          throw new Error(geminiFresh.error);
        }
        const freshSettings = geminiFresh.value;
        if (
          freshSettings == null ||
          !geminiSettingsContainAutopilot(freshSettings)
        ) {
          found = true;
          actions.push(`strip Autopilot entries from ${geminiLabel}`);
          actions.push(
            `${geminiLabel} no longer has Autopilot entries (skipped write)`,
          );
          return;
        }
        const stripped = stripAutopilotGeminiSettings(freshSettings);
        if (geminiSettingsFileIsVacant(stripped)) {
          assertRealpathInside(projectRoot, geminiSettingsPath, geminiLabel);
          fs.unlinkSync(geminiSettingsPath);
          found = true;
          hooksStripped = true;
          actions.push(`unlink empty ${geminiLabel}`);
          removed.push(path.relative(projectRoot, geminiSettingsPath));
          return;
        }
        writeJsonAtomic(
          geminiSettingsPath,
          JSON.stringify(stripped, null, 2) + "\n",
          projectRoot,
          geminiLabel,
        );
        found = true;
        hooksStripped = true;
        actions.push(`strip Autopilot entries from ${geminiLabel}`);
        removed.push(
          path.relative(projectRoot, geminiSettingsPath) +
            " (Autopilot entries)",
        );
      };

      try {
        stripGeminiSettings();
      } catch (err) {
        if (wantGemini) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip ${geminiLabel} (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Factory Droid hooks (.factory/hooks.json) ---
    // Top-level events; fingerprint strip only; keep siblings under .factory/.
    // Vacant after strip → unlink hooks.json only.
    const factoryLabel = FACTORY_HOOKS_REL_PATH;
    const factoryPre = readFactoryHooksFile(factoryHooksPath);
    if (!factoryPre.ok) {
      if (wantFactory) {
        return { ok: false, error: factoryPre.error };
      }
      actions.push(
        `skip ${factoryLabel} (${formatUninstallSkipDetail(factoryPre.error)})`,
      );
    } else if (factoryHooksContainAutopilot(factoryPre.value)) {
      const stripFactoryHooks = (): void => {
        assertNotSymlink(factoryDir, ".factory/");
        assertNotSymlink(factoryHooksPath, factoryLabel);
        if (dryRun) {
          found = true;
          const preview =
            factoryPre.value != null
              ? stripAutopilotFactoryHooks(factoryPre.value)
              : null;
          if (factoryHooksFileIsVacant(preview)) {
            actions.push(`unlink empty ${factoryLabel}`);
          } else {
            actions.push(`strip Autopilot entries from ${factoryLabel}`);
          }
          return;
        }
        const factoryFresh = readFactoryHooksFile(factoryHooksPath);
        if (!factoryFresh.ok) {
          throw new Error(factoryFresh.error);
        }
        const freshFile = factoryFresh.value;
        if (
          freshFile == null ||
          !factoryHooksContainAutopilot(freshFile)
        ) {
          found = true;
          actions.push(`strip Autopilot entries from ${factoryLabel}`);
          actions.push(
            `${factoryLabel} no longer has Autopilot entries (skipped write)`,
          );
          return;
        }
        const stripped = stripAutopilotFactoryHooks(freshFile);
        if (factoryHooksFileIsVacant(stripped)) {
          assertRealpathInside(projectRoot, factoryHooksPath, factoryLabel);
          fs.unlinkSync(factoryHooksPath);
          found = true;
          hooksStripped = true;
          actions.push(`unlink empty ${factoryLabel}`);
          removed.push(path.relative(projectRoot, factoryHooksPath));
          return;
        }
        writeJsonAtomic(
          factoryHooksPath,
          JSON.stringify(stripped, null, 2) + "\n",
          projectRoot,
          factoryLabel,
        );
        found = true;
        hooksStripped = true;
        actions.push(`strip Autopilot entries from ${factoryLabel}`);
        removed.push(
          path.relative(projectRoot, factoryHooksPath) + " (Autopilot entries)",
        );
      };

      try {
        stripFactoryHooks();
      } catch (err) {
        if (wantFactory) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip ${factoryLabel} (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Antigravity hooks (.agents/hooks.json) ---
    // Named autopilot-harness block; keep foreign named blocks / siblings.
    // Vacant after strip → unlink hooks.json only. Never touch .agent/.
    const antigravityLabel = ANTIGRAVITY_HOOKS_REL_PATH;
    const antigravityPre = readAntigravityHooksFile(antigravityHooksPath);
    if (!antigravityPre.ok) {
      if (wantAntigravity) {
        return { ok: false, error: antigravityPre.error };
      }
      actions.push(
        `skip ${antigravityLabel} (${formatUninstallSkipDetail(antigravityPre.error)})`,
      );
    } else if (antigravityHooksContainAutopilot(antigravityPre.value)) {
      const stripAntigravityHooks = (): void => {
        assertNotSymlink(agentsDir, ".agents/");
        assertNotSymlink(antigravityHooksPath, antigravityLabel);
        if (dryRun) {
          found = true;
          const preview =
            antigravityPre.value != null
              ? stripAutopilotAntigravityHooks(antigravityPre.value)
              : null;
          if (antigravityHooksFileIsVacant(preview)) {
            actions.push(`unlink empty ${antigravityLabel}`);
          } else {
            actions.push(`strip Autopilot entries from ${antigravityLabel}`);
          }
          return;
        }
        const antigravityFresh = readAntigravityHooksFile(antigravityHooksPath);
        if (!antigravityFresh.ok) {
          throw new Error(antigravityFresh.error);
        }
        const freshFile = antigravityFresh.value;
        if (
          freshFile == null ||
          !antigravityHooksContainAutopilot(freshFile)
        ) {
          found = true;
          actions.push(`strip Autopilot entries from ${antigravityLabel}`);
          actions.push(
            `${antigravityLabel} no longer has Autopilot entries (skipped write)`,
          );
          return;
        }
        const stripped = stripAutopilotAntigravityHooks(freshFile);
        if (antigravityHooksFileIsVacant(stripped)) {
          assertRealpathInside(projectRoot, antigravityHooksPath, antigravityLabel);
          fs.unlinkSync(antigravityHooksPath);
          found = true;
          hooksStripped = true;
          actions.push(`unlink empty ${antigravityLabel}`);
          removed.push(path.relative(projectRoot, antigravityHooksPath));
          return;
        }
        writeJsonAtomic(
          antigravityHooksPath,
          JSON.stringify(stripped, null, 2) + "\n",
          projectRoot,
          antigravityLabel,
        );
        found = true;
        hooksStripped = true;
        actions.push(`strip Autopilot entries from ${antigravityLabel}`);
        removed.push(
          path.relative(projectRoot, antigravityHooksPath) +
            " (Autopilot entries)",
        );
      };

      try {
        stripAntigravityHooks();
      } catch (err) {
        if (wantAntigravity) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip ${antigravityLabel} (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Kimi Code user-home config.toml (fingerprint only; never local.toml) ---
    const kimiHome = resolveKimiCodeHome();
    const kimiTomlPath = kimiConfigTomlPath(kimiHome);
    const kimiPre = readKimiConfigToml(kimiTomlPath);
    if (!kimiPre.ok) {
      if (wantKimi) {
        return { ok: false, error: kimiPre.error };
      }
      actions.push(
        `skip Kimi Code config.toml (${formatUninstallSkipDetail(kimiPre.error)})`,
      );
    } else if (kimiTomlHasAutopilotHookTables(kimiPre.value)) {
      const stripKimiHooks = (): void => {
        assertNotSymlink(kimiHome, "Kimi Code home/");
        if (!isRealDirectory(kimiHome)) {
          throw new Error("Kimi Code home/ is not a real directory");
        }
        assertNotSymlink(kimiTomlPath, "config.toml");
        if (dryRun) {
          found = true;
          actions.push(
            "strip Autopilot entries from $KIMI_CODE_HOME/config.toml",
          );
          return;
        }
        const kimiFresh = readKimiConfigToml(kimiTomlPath);
        if (!kimiFresh.ok) {
          throw new Error(kimiFresh.error);
        }
        if (!kimiTomlHasAutopilotHookTables(kimiFresh.value)) {
          found = true;
          actions.push(
            "strip Autopilot entries from $KIMI_CODE_HOME/config.toml",
          );
          actions.push(
            "Kimi Code config.toml no longer has Autopilot entries (skipped write)",
          );
          return;
        }
        const stripped = removeAutopilotKimiHooks(kimiFresh.value);
        if (kimiTomlHasAutopilotHookTables(stripped)) {
          throw new Error(
            "Kimi Code config.toml still has Autopilot hook tables after strip",
          );
        }
        // Re-check immediately before write (init parity; shrink TOCTOU).
        assertNotSymlink(kimiHome, "Kimi Code home/");
        if (!isRealDirectory(kimiHome)) {
          throw new Error("Kimi Code home/ is not a real directory");
        }
        assertNotSymlink(kimiTomlPath, "config.toml");
        writeFileReplaceSync(kimiTomlPath, stripped);
        found = true;
        hooksStripped = true;
        actions.push(
          "strip Autopilot entries from $KIMI_CODE_HOME/config.toml",
        );
        removed.push("Kimi Code config.toml (Autopilot entries)");
      };

      try {
        stripKimiHooks();
      } catch (err) {
        if (wantKimi) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip Kimi Code config.toml (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Hermes Agent user-home config.yaml (fingerprint only; never cli-config.yaml) ---
    const hermesHome = resolveHermesHome();
    const hermesYamlPath = hermesConfigYamlPath(hermesHome);
    const hermesPre = readHermesConfigYaml(hermesYamlPath);
    if (!hermesPre.ok) {
      if (wantHermes) {
        return { ok: false, error: hermesPre.error };
      }
      actions.push(
        `skip Hermes config.yaml (${formatUninstallSkipDetail(hermesPre.error)})`,
      );
    } else if (hermesConfigYamlContainsAutopilot(hermesPre.value)) {
      const stripHermesHooks = (): void => {
        assertNotSymlink(hermesHome, "Hermes home/");
        if (!isRealDirectory(hermesHome)) {
          throw new Error("Hermes home/ is not a real directory");
        }
        assertNotSymlink(hermesYamlPath, "config.yaml");
        // Prove strip-shaped before dry-run claims work: regex fingerprint can
        // match unparseable YAML, but stripAutopilotHermesConfigYaml needs parse.
        const preview = stripAutopilotHermesConfigYaml(hermesPre.value);
        if (hermesConfigYamlContainsAutopilot(preview)) {
          throw new Error(
            "Hermes config.yaml still has Autopilot fingerprint after strip",
          );
        }
        if (dryRun) {
          found = true;
          actions.push("strip Autopilot entries from $HERMES_HOME/config.yaml");
          return;
        }
        const hermesFresh = readHermesConfigYaml(hermesYamlPath);
        if (!hermesFresh.ok) {
          throw new Error(hermesFresh.error);
        }
        if (!hermesConfigYamlContainsAutopilot(hermesFresh.value)) {
          found = true;
          actions.push("strip Autopilot entries from $HERMES_HOME/config.yaml");
          actions.push(
            "Hermes config.yaml no longer has Autopilot entries (skipped write)",
          );
          return;
        }
        const stripped = stripAutopilotHermesConfigYaml(hermesFresh.value);
        if (hermesConfigYamlContainsAutopilot(stripped)) {
          throw new Error(
            "Hermes config.yaml still has Autopilot fingerprint after strip",
          );
        }
        assertNotSymlink(hermesHome, "Hermes home/");
        if (!isRealDirectory(hermesHome)) {
          throw new Error("Hermes home/ is not a real directory");
        }
        assertNotSymlink(hermesYamlPath, "config.yaml");
        writeFileReplaceSync(hermesYamlPath, stripped);
        found = true;
        hooksStripped = true;
        actions.push("strip Autopilot entries from $HERMES_HOME/config.yaml");
        removed.push("Hermes config.yaml (Autopilot entries)");
      };

      try {
        stripHermesHooks();
      } catch (err) {
        if (wantHermes) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip Hermes config.yaml (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Cursor skills (lstat so symlink skills are not silently ignored) ---
    for (const name of AUTOPILOT_SKILL_NAMES) {
      const skillDir = path.join(skillsRoot, name);
      if (!pathExistsViaLstat(skillDir)) continue;
      found = true;
      safeRemovePath(
        projectRoot,
        skillDir,
        `.cursor/skills/${name}`,
        removed,
        dryRun,
        actions,
      );
    }

    // --- Claude skills ---
    for (const name of AUTOPILOT_SKILL_NAMES) {
      const skillDir = path.join(claudeSkillsRoot, name);
      if (!pathExistsViaLstat(skillDir)) continue;
      try {
        // Probe escape before marking found (Cursor-only soft-skip must not claim work).
        if (!wantClaude) {
          assertRemovalTargetSafe(
            projectRoot,
            skillDir,
            `.claude/skills/${name}`,
          );
        }
        found = true;
        safeRemovePath(
          projectRoot,
          skillDir,
          `.claude/skills/${name}`,
          removed,
          dryRun,
          actions,
        );
      } catch (err) {
        if (wantClaude) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip .claude/skills/${name} (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Antigravity skills (.agents/skills) ---
    for (const name of AUTOPILOT_SKILL_NAMES) {
      const skillDir = path.join(agentsSkillsRoot, name);
      if (!pathExistsViaLstat(skillDir)) continue;
      try {
        if (!wantAntigravity) {
          assertRemovalTargetSafe(
            projectRoot,
            skillDir,
            `.agents/skills/${name}`,
          );
        }
        found = true;
        safeRemovePath(
          projectRoot,
          skillDir,
          `.agents/skills/${name}`,
          removed,
          dryRun,
          actions,
        );
      } catch (err) {
        if (wantAntigravity) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip .agents/skills/${name} (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Gemini skills (.gemini/skills) ---
    for (const name of AUTOPILOT_SKILL_NAMES) {
      const skillDir = path.join(geminiSkillsRoot, name);
      if (!pathExistsViaLstat(skillDir)) continue;
      try {
        if (!wantGemini) {
          assertRemovalTargetSafe(
            projectRoot,
            skillDir,
            `.gemini/skills/${name}`,
          );
        }
        found = true;
        safeRemovePath(
          projectRoot,
          skillDir,
          `.gemini/skills/${name}`,
          removed,
          dryRun,
          actions,
        );
      } catch (err) {
        if (wantGemini) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip .gemini/skills/${name} (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Factory skills (.factory/skills) ---
    for (const name of AUTOPILOT_SKILL_NAMES) {
      const skillDir = path.join(factorySkillsRoot, name);
      if (!pathExistsViaLstat(skillDir)) continue;
      try {
        if (!wantFactory) {
          assertRemovalTargetSafe(
            projectRoot,
            skillDir,
            `.factory/skills/${name}`,
          );
        }
        found = true;
        safeRemovePath(
          projectRoot,
          skillDir,
          `.factory/skills/${name}`,
          removed,
          dryRun,
          actions,
        );
      } catch (err) {
        if (wantFactory) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        actions.push(
          `skip .factory/skills/${name} (${formatUninstallSkipDetail(msg)})`,
        );
      }
    }

    // --- Hermes skills ($HERMES_HOME/skills) ---
    // Shared home: only strip when this project declares hermes-agent.
    // Cursor-only (etc.) uninstall must not wipe another repo's Hermes skills.
    if (wantHermes) {
      const hermesHome = resolveHermesHome();
      assertNotSymlink(hermesHome, "Hermes home/");
      if (pathExistsViaLstat(hermesHome) && !isRealDirectory(hermesHome)) {
        throw new Error("Hermes home/ is not a real directory");
      }
      const hermesSkillsRoot = path.join(hermesHome, "skills");
      // Re-check root before leaf ops (shrink TOCTOU after hooks strip).
      if (pathExistsViaLstat(hermesSkillsRoot)) {
        assertNotSymlink(hermesSkillsRoot, "$HERMES_HOME/skills/");
        if (!isRealDirectory(hermesSkillsRoot)) {
          throw new Error(
            "$HERMES_HOME/skills/ exists and is not a directory",
          );
        }
        assertRealpathInside(
          hermesHome,
          hermesSkillsRoot,
          "$HERMES_HOME/skills/",
        );
      }
      for (const name of AUTOPILOT_SKILL_NAMES) {
        const skillDir = path.join(hermesSkillsRoot, name);
        if (!pathExistsViaLstat(skillDir)) continue;
        found = true;
        safeRemoveHermesSkillPath(
          hermesHome,
          skillDir,
          `$HERMES_HOME/skills/${name}`,
          removed,
          dryRun,
          actions,
        );
      }
    }

    // --- workflows ---
    for (const name of AUTOPILOT_WORKFLOW_FILES) {
      const wf = path.join(workflowsDir, name);
      if (!pathExistsViaLstat(wf)) continue;
      found = true;
      safeRemovePath(
        projectRoot,
        wf,
        `docs/autopilot/workflows/${name}`,
        removed,
        dryRun,
        actions,
      );
    }

    // --- quickstart (install artifact; remove on uninstall) ---
    if (pathExistsViaLstat(quickstartPath)) {
      found = true;
      safeRemovePath(
        projectRoot,
        quickstartPath,
        "docs/autopilot/quickstart.md",
        removed,
        dryRun,
        actions,
      );
    }

    if (purgeAll) {
      if (pathExistsViaLstat(autopilotDir)) {
        found = true;
        safeRemovePath(
          projectRoot,
          autopilotDir,
          ".autopilot",
          removed,
          dryRun,
          actions,
        );
      }
    } else {
      if (pathExistsViaLstat(binDir)) {
        found = true;
        safeRemovePath(
          projectRoot,
          binDir,
          ".autopilot/bin",
          removed,
          dryRun,
          actions,
        );
      }
      if (pathExistsViaLstat(pinPath)) {
        found = true;
        safeRemovePath(
          projectRoot,
          pinPath,
          ".autopilot/pin.json",
          removed,
          dryRun,
          actions,
        );
      }
      if (isRealRegularFile(configPath)) {
        kept.push(".autopilot/config.yml (use --purge-all to remove)");
      }
      const stateDb = path.join(autopilotDir, "state.db");
      if (isRealRegularFile(stateDb)) {
        kept.push(".autopilot/state.db (use --purge-all to remove)");
      }
    }

    kept.push("plans/ (never removed by uninstall)");
    kept.push("shell rc alias / .gitignore (not modified)");

    if (!found) {
      actions.push("nothing to uninstall");
    }

    return {
      ok: true,
      dryRun,
      actions,
      removed: dryRun ? [] : removed,
      kept,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const note = hooksStripped
      ? " (Autopilot host settings were already stripped; fix the error and re-run uninstall)"
      : "";
    return { ok: false, error: `${msg}${note}` };
  }
}
