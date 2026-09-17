import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { CLI_NAME, NPM_PACKAGE_NAME } from "../names.js";
import type { InitLocale, InitYesOptions, PlansGitPolicy } from "./types.js";
import {
  formatBindingOptionLabel,
  INSTALLABLE_BINDINGS,
  MAX_PLATFORM_BINDINGS,
  mergePlatformBindings,
  mergedIncludesAllRequested,
  primaryBinding,
  sanitizePlatformId,
  type PlatformBinding,
} from "./platforms.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
  writeFileReplaceSync,
} from "../read-untrusted-file.js";
import {
  assertNotSymlink,
  assertParentDirInProject,
  assertRealpathInside,
  assertWrittenInsideProject,
  mkdirRealDirSync,
  resolveProjectRootOrThrow,
} from "../project-fs.js";

export {
  assertNotSymlink,
  assertParentDirInProject,
  assertRealpathInside,
  assertRegularFileInsideProject,
  assertWrittenInsideProject,
  assertPairInsideOrUnlinkAll,
  assertPresentRealFile,
  mkdirRealDirSync,
  resolveProjectRootOrThrow,
  isRealRegularFile,
  isRealDirectory,
  resolveNofollowFlag,
} from "../project-fs.js";

/** Cap for .gitignore / shell rc text when appending Autopilot lines. */
const MAX_APPEND_TEXT_BYTES = MAX_UNTRUSTED_TEXT_BYTES;

/**
 * Write text via tmp+rename so a raced symlink is replaced, not followed
 * (writeFileSync would create/write through the link target).
 */
function writeTextFileReplace(
  filePath: string,
  contents: string,
  projectRoot?: string,
): void {
  const dir = path.dirname(filePath);
  // Match mkdirRealDirSync: if projectRoot is passed (incl. ""), validate —
  // never treat blank as "no root" and skip bounds checks.
  let root: string | undefined;
  if (projectRoot !== undefined) {
    root = resolveProjectRootOrThrow(projectRoot);
    mkdirRealDirSync(dir, path.basename(dir) || dir, root);
    // Re-check immediately before write (mkdir→write TOCTOU on parent symlink).
    assertParentDirInProject(root, filePath, path.basename(dir) || dir);
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
  writeFileReplaceSync(filePath, contents);
  if (root !== undefined) {
    assertWrittenInsideProject(
      root,
      filePath,
      path.basename(filePath) || filePath,
    );
  }
}

export type { PlansGitPolicy };
export type ShellAliasTarget = "skip" | "zshrc" | "bashrc";

/** Answers collected by interactive init (or tests). */
export interface InitWizardAnswers {
  projectRoot: string;
  locale: InitLocale;
  platforms: PlatformBinding[];
  /** @deprecated Prefer platforms[0]; kept for call sites during transition. */
  platform: "cursor" | string;
  /** @deprecated Prefer platforms[0].surface */
  surface: "ide" | string;
  plansDir: string;
  plansGit: PlansGitPolicy;
  verifyEnabled: boolean;
  /** project = any product-code edit (init default); executing_only = after RUN. */
  reviewScope: "executing_only" | "project";
  /** 0 = unlimited. */
  maxErrorsBeforePause: number;
  shellAlias: ShellAliasTarget;
  force: boolean;
  /** When true, merge platforms into existing config.yml. */
  mergePlatforms?: boolean;
  packageVersion?: string;
}

export interface ProjectProbe {
  projectRoot: string;
  hasGit: boolean;
  branch: string | null;
  alreadyInitialized: boolean;
}

const PLANS_DIR_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * Normalize + validate plans directory (relative, no traversal, YAML-safe).
 */
export function normalizePlansDir(
  raw: string | undefined | null,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = (raw ?? "plans").trim().replace(/\/+$/, "");
  const value = trimmed || "plans";
  if (path.isAbsolute(value) || value.startsWith("~")) {
    return { ok: false, error: "plansDir must be a relative path" };
  }
  if (
    value.includes("\0") ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes("\\")
  ) {
    return {
      ok: false,
      error: "plansDir contains invalid characters",
    };
  }
  const parts = value.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    return {
      ok: false,
      error: "plansDir must not contain . or .. segments",
    };
  }
  if (!PLANS_DIR_RE.test(value)) {
    return {
      ok: false,
      error:
        "plansDir may only contain letters, digits, ._- and / separators",
    };
  }
  return { ok: true, value };
}

/** Parse CLI `--scope` for fresh init (`project` default when omitted/blank). */
export function parseInitReviewScope(
  raw: string | undefined | null,
):
  | { ok: true; value: "executing_only" | "project" }
  | { ok: false; error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { ok: true, value: "project" };
  }
  // Match runtime parseReviewScope: case-insensitive; always|all → project.
  const value = String(raw).trim().toLowerCase();
  if (value === "executing_only") {
    return { ok: true, value: "executing_only" };
  }
  if (value === "project" || value === "always" || value === "all") {
    return { ok: true, value: "project" };
  }
  return {
    ok: false,
    error: `invalid --scope (want executing_only|project)`,
  };
}

export function probeProject(projectRoot: string): ProjectProbe {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    return {
      projectRoot: "",
      hasGit: false,
      branch: null,
      alreadyInitialized: false,
    };
  }
  const root = path.resolve(projectRoot.trim());
  let hasGit = false;
  let branch: string | null = null;
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    hasGit = true;
  } catch {
    hasGit = false;
  }
  if (hasGit) {
    try {
      branch =
        execSync("git branch --show-current", {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5_000,
        }).trim() || null;
    } catch {
      // Detached / old git / empty repo: still a git work tree.
      branch = null;
    }
  }
  let alreadyInitialized = false;
  try {
    const cfg = path.join(root, ".autopilot", "config.yml");
    const st = fs.lstatSync(cfg);
    // Dangling/pointing symlinks are not a real init.
    alreadyInitialized = st.isFile() && !st.isSymbolicLink();
  } catch {
    alreadyInitialized = false;
  }
  return {
    projectRoot: root,
    hasGit,
    branch,
    alreadyInitialized,
  };
}

function appendGitignoreLines(
  projectRoot: string,
  comment: string,
  lines: string[],
): string | null {
  const root = resolveProjectRootOrThrow(projectRoot);
  const gi = path.join(root, ".gitignore");
  let body = "";
  try {
    // O_NOFOLLOW read — existsSync/lstat+readFileSync can race or miss dangling.
    body = readUntrustedUtf8File(gi, MAX_APPEND_TEXT_BYTES, ".gitignore");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      body = "";
    } else {
      throw err;
    }
  }
  const existing = new Set(
    body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const toAdd = lines.filter((l) => !existing.has(l) && !existing.has(`/${l}`));
  if (toAdd.length === 0) return null;
  if (body.length > 0 && !body.endsWith("\n")) body += "\n";
  const commentLine = `# ${comment}`;
  // Prefer extending an existing section instead of duplicating the header
  // (e.g. upgrade adds `.autopilot/state.db.bak*` to a prior runtime block).
  if (existing.has(commentLine)) {
    const rows = body.split(/\r?\n/);
    let commentIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]!.trim() === commentLine) commentIdx = i;
    }
    let insertAt = rows.length;
    if (commentIdx >= 0) {
      insertAt = commentIdx + 1;
      while (insertAt < rows.length) {
        const t = rows[insertAt]!.trim();
        // End of section: blank line or next comment.
        if (t === "" || t.startsWith("#")) break;
        insertAt++;
      }
    }
    rows.splice(insertAt, 0, ...toAdd);
    body = rows.join("\n");
    if (!body.endsWith("\n")) body += "\n";
  } else {
    body += `\n${commentLine}\n${toAdd.map((l) => `${l}\n`).join("")}`;
  }
  assertNotSymlink(gi, ".gitignore");
  writeTextFileReplace(gi, body, root);
  return path.relative(root, gi);
}

/** Append plans dir to .gitignore once (dedupe). */
export function applyPlansGitignore(
  projectRoot: string,
  plansDir = "plans",
): string | null {
  const normalized = normalizePlansDir(plansDir);
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }
  const entry = `${normalized.value}/`;
  return appendGitignoreLines(projectRoot, "Autopilot plans (local only)", [
    entry,
  ]);
}

/** Always ignore runtime Autopilot artifacts (not config/hooks). */
export function applyAutopilotRuntimeGitignore(
  projectRoot: string,
): string | null {
  return appendGitignoreLines(projectRoot, "Autopilot runtime", [
    ".autopilot/state.db",
    ".autopilot/state.db-*",
    ".autopilot/state.db.bak*",
    ".autopilot/worktrees/",
    ".autopilot/verify-last.json",
    ".autopilot/logs/",
  ]);
}

/** Map wizard answers → installInitYes options (+ post-install alias). */
export function answersToInstallOptions(
  answers: InitWizardAnswers,
): InitYesOptions {
  const raw =
    answers.platforms && answers.platforms.length > 0
      ? answers.platforms
      : [
          {
            id: answers.platform || "cursor",
            surface: answers.surface || "ide",
          },
        ];
  const platforms = mergePlatformBindings([], raw);
  // Do not pre-truncate then hand a capped list to install (that would bypass
  // installInitYes platformsExceedCap). Fail closed here instead.
  if (!mergedIncludesAllRequested(platforms, raw)) {
    throw new Error(
      `platforms list exceeds cap of ${MAX_PLATFORM_BINDINGS} unique entries; trim the list and retry`,
    );
  }
  const primary = primaryBinding(platforms);
  return {
    projectRoot: answers.projectRoot,
    platform: primary.id,
    surface: primary.surface,
    platforms,
    mergePlatforms: Boolean(answers.mergePlatforms),
    locale: answers.locale,
    force: answers.force,
    packageVersion: answers.packageVersion,
    plansDir: answers.plansDir,
    plansGit: answers.plansGit,
    verifyEnabled: answers.verifyEnabled,
    maxErrorsBeforePause: answers.maxErrorsBeforePause,
    reviewScope: answers.reviewScope,
    writeQuickstart: true,
  };
}

/** POSIX single-quote a string for safe embedding in shell. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/** Refuse path chars that break shell rc / single-line docs embedding. */
const SHELL_UNSAFE_PATH_CHARS = /[\0\n\r\u2028\u2029]/;

/**
 * Absolute path of the running CLI entry (e.g. …/dist/bin.js), or null.
 * Used so local checkouts write a working alias before the package is on npm.
 */
export function tryResolveRunningCliScript(): string | null {
  const argv1 = process.argv[1];
  if (typeof argv1 !== "string" || argv1.trim() === "") return null;
  try {
    const abs = fs.realpathSync(path.resolve(argv1));
    if (!fs.statSync(abs).isFile()) return null;
    if (SHELL_UNSAFE_PATH_CHARS.test(abs)) return null;
    if (!isTrustedCliEntrypoint(abs)) return null;
    return abs;
  } catch {
    return null;
  }
}

/**
 * argv[1] is often some other .js under test runners / wrappers.
 * Only accept known Autopilot CLI entry names (and bin.js under our package paths).
 *
 * Deliberately small allowlist: monorepo `packages/cli/.../bin.js` (no
 * `node_modules/` in the path), npm `node_modules/<pkg>/.../bin.js`, and
 * project `node_modules/.bin` shims. Global / version-manager shims fall
 * through to `npx ${NPM_PACKAGE_NAME}`.
 */
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Matched against lowercased paths (see isTrustedCliEntrypoint).
const TRUSTED_MONOREPO_CLI_BIN = /(^|\/)packages\/cli\/(dist|src)\/bin\.js$/;
const TRUSTED_NPM_SCOPED_CLI_BIN = new RegExp(
  `(^|/)node_modules/${escRe(NPM_PACKAGE_NAME.toLowerCase())}/(dist|src)/bin\\.js$`,
);
const TRUSTED_NPM_LEGACY_CLI_BIN = new RegExp(
  `(^|/)node_modules/${escRe(CLI_NAME.toLowerCase())}/(dist|src)/bin\\.js$`,
);

export function isTrustedCliEntrypoint(absPath: string): boolean {
  if (typeof absPath !== "string" || !absPath.trim()) return false;
  // Same refuse set as tryResolveRunningCliScript (shell rc / docs).
  if (SHELL_UNSAFE_PATH_CHARS.test(absPath)) return false;
  // Normalize before basename — on POSIX, path.basename ignores `\`, so a
  // Windows-style path would otherwise never look like `bin.js`.
  const norm = absPath.split(/[/\\]+/).filter(Boolean).join("/");
  // Match path segments case-insensitively (Windows / macOS default volumes).
  const normLower = norm.toLowerCase();
  const base = path.posix.basename(normLower);
  if (
    base === CLI_NAME ||
    base === `${CLI_NAME}.js` ||
    base === `${CLI_NAME}.mjs`
  ) {
    // pnpm/npm project shims only (not arbitrary …/bin/<name>).
    return /(^|\/)node_modules\/\.bin\/[^/]+$/.test(normLower);
  }
  if (base !== "bin.js") return false;
  // Local monorepo checkout, or npm layout under node_modules/ (scoped / legacy).
  // Package-name paths require a node_modules/<pkg>/ segment. Monorepo paths
  // must not contain node_modules/ at all (blocks …/node_modules/**/packages/cli
  // decoys that only share the packages/cli/.../bin.js suffix).
  return (
    (TRUSTED_MONOREPO_CLI_BIN.test(normLower) &&
      !/(^|\/)node_modules\//.test(normLower)) ||
    TRUSTED_NPM_SCOPED_CLI_BIN.test(normLower) ||
    TRUSTED_NPM_LEGACY_CLI_BIN.test(normLower)
  );
}

/**
 * Runnable CLI command for docs / cheat sheets.
 * Prefers `node <this-bin>`; falls back to `npx` + {@link NPM_PACKAGE_NAME}.
 */
export function resolveCliCommand(): string {
  const script = tryResolveRunningCliScript();
  if (script) return `node ${shellSingleQuote(script)}`;
  return `npx ${NPM_PACKAGE_NAME}`;
}

/**
 * Shell rc snippet that defines `autopilot` as a function (not `alias=`).
 * Alias RHS quoting breaks on paths containing `'`; a function body can embed
 * the path via {@link shellSingleQuote} without source-time `$()` expansion.
 */
export function autopilotShellAliasLine(): string {
  const script = tryResolveRunningCliScript();
  if (script) {
    return `autopilot() { command node ${shellSingleQuote(script)} "$@"; }`;
  }
  return `autopilot() { command npx ${NPM_PACKAGE_NAME} "$@"; }`;
}

function shellRcDefinesAutopilot(body: string): boolean {
  // Line-anchored only — avoid false positives from comments / prose that
  // mention `alias autopilot=` mid-line.
  return (
    /(?:^|\n)\s*alias\s+autopilot=/.test(body) ||
    /(?:^|\n)\s*autopilot\s*\(\)/.test(body) ||
    /(?:^|\n)\s*function\s+autopilot\b/.test(body)
  );
}

/** Append shell shortcut with dedupe. Returns path + whether a line was added. */
export function appendShellAlias(
  target: Exclude<ShellAliasTarget, "skip">,
): { path: string; added: boolean } {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    throw new Error("HOME is not set; cannot write shell shortcut");
  }
  const file =
    target === "zshrc"
      ? path.join(home, ".zshrc")
      : path.join(home, ".bashrc");
  let body = "";
  try {
    body = readUntrustedUtf8File(file, MAX_APPEND_TEXT_BYTES, path.basename(file));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      body = "";
    } else {
      throw err;
    }
  }
  if (shellRcDefinesAutopilot(body)) {
    return { path: file, added: false };
  }
  if (body.length > 0 && !body.endsWith("\n")) body += "\n";
  body += `\n# Autopilot Harness\n${autopilotShellAliasLine()}\n`;
  assertNotSymlink(file, path.basename(file));
  writeTextFileReplace(file, body);
  return { path: file, added: true };
}

/**
 * Strip C0 controls / DEL and cap length so a hostile config.yml `platform`
 * cannot inject control chars or megabyte strings into terminal tips.
 * Allowlist first, then lowercase + length cap, so junk prefixes do not
 * truncate away a real id (e.g. "***…***cursor" → "cursor").
 */
// sanitizePlatformId lives in ./platforms.js (shared with config parsing).

/** Deduped, sanitized host ids for init/upgrade copy (empty if none usable). */
function uniquePlatformIds(
  platformOrPlatforms: string | readonly string[],
): string[] {
  return [
    ...new Set(
      (
        typeof platformOrPlatforms === "string"
          ? [platformOrPlatforms]
          : [...platformOrPlatforms]
      )
        .map(sanitizePlatformId)
        .filter(Boolean),
    ),
  ];
}

/**
 * Human label for an agent host id (init/upgrade tips).
 * Init CLI copy is English; extend as new platforms ship.
 */
export function formatHostDisplayName(platform: string): string {
  const id = sanitizePlatformId(platform);
  switch (id) {
    case "cursor":
      return "Cursor";
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "kimi-code":
      return "Kimi Code";
    case "copilot-cli":
      return "GitHub Copilot CLI";
    case "grok-build":
      return "Grok Build";
    case "gemini-cli":
      return "Gemini CLI";
    case "factory-droid":
      return "Factory Droid";
    case "hermes-agent":
      return "Hermes Agent";
    case "antigravity":
      return "Antigravity";
    case "runner":
      return "Runner";
    default: {
      const parts = id.split(/[-_]/).filter(Boolean);
      if (parts.length === 0) return "your agent host";
      return parts
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
    }
  }
}

/** Init/upgrade outro — always English (init UX language). */
export function formatPostInstallOutro(
  platformOrPlatforms: string | readonly string[],
): string {
  const ids = uniquePlatformIds(platformOrPlatforms);
  if (ids.length === 0) {
    return "You're all set — try /autopilot-on in your agent host.";
  }
  if (ids.length === 1) {
    const id = ids[0]!;
    const name = formatHostDisplayName(id);
    if (id === "codex") {
      return `You're all set — in ${name}, use line-start triggers.on / triggers.run (e.g. Autopilot ON / Autopilot RUN; typed /autopilot-* still parses). Trust hooks via /hooks.`;
    }
    if (id === "kimi-code") {
      return `You're all set — in ${name}, use line-start triggers.on / triggers.run (P0). Hooks live in $KIMI_CODE_HOME/config.toml (default ~/.kimi-code). Prefer confirm_rounds: 1 — Stop-continue is hard-capped at 1/turn.`;
    }
    if (id === "copilot-cli") {
      return `You're all set — in ${name}, use line-start triggers.on / triggers.run (P0). Hooks live in .github/hooks/autopilot-harness.json (timeout ≥120s). Restart Copilot CLI after install or upgrade.`;
    }
    if (id === "grok-build") {
      return `You're all set — in ${name}, use line-start triggers.on / triggers.run (P0). Hooks live in .grok/hooks/autopilot-harness.json (timeout 120s). Trust via /hooks-trust or --trust after install or upgrade.`;
    }
    if (id === "gemini-cli") {
      return `You're all set — in ${name}, try /autopilot-on (skills under .gemini/skills) or line-start triggers.on / triggers.run. Hooks live in .gemini/settings.json (timeout 120000ms). After install/upgrade: re-trust hooks, check /hooks panel, ensure folder trust, and /skills reload.`;
    }
    if (id === "factory-droid") {
      return `You're all set — in ${name}, try /autopilot-on (skills under .factory/skills) or line-start triggers.on / triggers.run. Hooks live in .factory/hooks.json (timeout 120; commands use $FACTORY_PROJECT_DIR). After install/upgrade: check /hooks, then reload or start a new session so the hooks snapshot refreshes.`;
    }
    if (id === "hermes-agent") {
      return `You're all set — in ${name}, try /autopilot-on (skills under $HERMES_HOME/skills) or line-start triggers.on / triggers.run. Hooks live in $HERMES_HOME/config.yaml (default ~/.hermes; timeout 120; relative command; agent.max_verify_nudges ≥32). pre_verify is edit-only (no product edit → pending/RESUME). Consent/non-TTY: approve hooks or use --accept-hooks / HERMES_ACCEPT_HOOKS (Autopilot does not set hooks_auto_accept). After install: reload Hermes and run hermes hooks doctor.`;
    }
    if (id === "antigravity") {
      return `You're all set — in ${name}, try /autopilot-on (skills under .agents/skills) or line-start triggers.on / triggers.run. Hooks live in .agents/hooks.json (named autopilot-harness block; timeout 120; .agents/bin shim). After install/upgrade: reload Antigravity / start a new session (IDE tip: hooks may be silent until reload). CLI: mount the project workspace (e.g. --add-dir / open the folder) or hooks may not load (loaded 0). Auto-attach ≠ Autopilot ON — still run /autopilot-on or a line-start trigger.`;
    }
    if (id === "runner") {
      return `You're all set — set runner.command in .autopilot/config.yml (no fake default), then: autopilot-harness runner start --run <slug>. Status: autopilot-harness runner status. Under concurrency.mode: one_executor, Runner and a hook host cannot both hold an armed executing session.`;
    }
    return `You're all set — try /autopilot-on in ${name}.`;
  }
  const names = ids.map((id) => formatHostDisplayName(id)).join(", ");
  if (ids.includes("runner")) {
    const hookNames = ids
      .filter((id) => id !== "runner")
      .map((id) => formatHostDisplayName(id))
      .join(", ");
    if (hookNames) {
      return `You're all set — try /autopilot-on in ${hookNames}; for Runner set runner.command then autopilot-harness runner start --run. Note: one_executor blocks dual armed executing across Runner + hook hosts.`;
    }
  }
  if (
    ids.includes("codex") ||
    ids.includes("kimi-code") ||
    ids.includes("copilot-cli") ||
    ids.includes("grok-build") ||
    ids.includes("gemini-cli") ||
    ids.includes("factory-droid") ||
    ids.includes("hermes-agent") ||
    ids.includes("antigravity")
  ) {
    return `You're all set — try /autopilot-on in ${names} (Codex/Kimi/Copilot/Grok: line-start triggers.on / triggers.run; Gemini/Factory/Hermes/Antigravity: slash skills + line-start; Kimi: confirm_rounds: 1 + Stop≤1/turn).`;
  }
  return `You're all set — try /autopilot-on in ${names}.`;
}

/**
 * Host-specific activation tips after hooks/skills install.
 * Always English (init UX language). Install what you chose → tip for that host.
 */
export function formatHostActivationTips(
  platformOrPlatforms: string | readonly string[],
): string[] {
  const ids = uniquePlatformIds(platformOrPlatforms);
  const tips: string[] = [];
  for (const id of ids) {
    const host = formatHostDisplayName(id);
    if (id === "cursor") {
      tips.push(
        `If /autopilot-* skills or Autopilot hooks do not appear in ${host}: run Developer: Reload Window, or start a new Agent chat.`,
      );
    } else if (id === "claude-code") {
      tips.push(
        `${host} hooks are shared across terminal and IDE. If skills/hooks do not appear: restart ${host} and open a new session. Project env (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP) may require trusting this folder.`,
      );
    } else if (id === "codex") {
      tips.push(
        `${host}: Autopilot wires .codex/hooks.json only (does not edit config.toml hooks). Trust project hooks via /hooks after install or upgrade. P0 activation is line-start triggers.on / triggers.run (no Autopilot skills; typed /autopilot-* still parses).`,
      );
    } else if (id === "kimi-code") {
      tips.push(
        `${host}: Autopilot merges [[hooks]] into $KIMI_CODE_HOME/config.toml (default ~/.kimi-code; does not write local.toml). Timeout ≥120s. P0 activation is line-start triggers.on / triggers.run (no Autopilot skills/AGENTS.md). Prefer confirm_rounds: 1 — host Stop-continue hard-capped at 1/turn.`,
      );
    } else if (id === "copilot-cli") {
      tips.push(
        `${host}: Autopilot writes .github/hooks/autopilot-harness.json (bash+powershell; timeoutSec ≥120; UPS+Transform+postToolUse+agentStop). P0 activation is line-start triggers.on / triggers.run (no Autopilot skills/AGENTS.md). Restart Copilot CLI after install or upgrade.`,
      );
    } else if (id === "grok-build") {
      tips.push(
        `${host}: Autopilot writes .grok/hooks/autopilot-harness.json only (Codex-shaped; timeout 120; UPS+PostToolUse+Stop). Trust via /hooks-trust or --trust after install or upgrade. P0 activation is line-start triggers.on / triggers.run (no Autopilot skills/AGENTS.md).`,
      );
    } else if (id === "gemini-cli") {
      tips.push(
        `${host}: Autopilot writes .gemini/settings.json (nested matcher groups; timeout 120000ms; BeforeAgent+AfterTool+AfterAgent) and .gemini/skills/autopilot-* (not skipped when Antigravity is also enabled; does not rewrite hooksConfig). After install/upgrade: re-trust hooks, open /hooks panel, ensure folder trust, and /skills reload. Activation: /autopilot-on or line-start triggers.on / triggers.run.`,
      );
    } else if (id === "factory-droid") {
      tips.push(
        `${host}: Autopilot writes .factory/hooks.json (top-level events; timeout 120; UPS+PostToolUse+Stop; commands use $FACTORY_PROJECT_DIR) and .factory/skills/autopilot-* (disable-model-invocation: true; user-invocable default). After install/upgrade: check /hooks, then reload or start a new session so the hooks snapshot refreshes. Activation: /autopilot-on or line-start triggers.on / triggers.run.`,
      );
    } else if (id === "hermes-agent") {
      tips.push(
        `${host}: Autopilot merges hooks: into $HERMES_HOME/config.yaml (default ~/.hermes; never cli-config.yaml) and installs $HERMES_HOME/skills/autopilot-*. Timeout 120; post_tool_call matcher write_file|patch; relative node .autopilot/bin/… --platform hermes-agent; raises agent.max_verify_nudges to ≥32 (does not lower higher values; does not set hooks_auto_accept or rewrite verify_guidance). pre_verify is edit-only — no product edit that turn → pending/RESUME. Consent/non-TTY: approve at TTY or --accept-hooks / HERMES_ACCEPT_HOOKS. After install: reload Hermes and run hermes hooks doctor. Activation: /autopilot-on or line-start triggers.on / triggers.run.`,
      );
    } else if (id === "antigravity") {
      tips.push(
        `${host}: Autopilot writes .agents/hooks.json (named autopilot-harness block; PreInvocation+PostToolUse+Stop; timeout 120; node .agents/bin/autopilot-harness-hook.mjs shim → ../../.autopilot/bin/… via import.meta.url — not bare ../.autopilot; --platform antigravity) and .agents/skills/autopilot-* (does not write .agent/). After install/upgrade: reload Antigravity or start a new session (IDE hooks may stay silent until reload). CLI: mount the project workspace (e.g. --add-dir / open the folder) or hooks may not load (loaded 0). Auto-attach ≠ Autopilot ON — still /autopilot-on or line-start triggers.on / triggers.run.`,
      );
    } else if (id === "runner") {
      tips.push(
        `${host}: set runner.command in .autopilot/config.yml (no fake default), then autopilot-harness runner start --run <slug>. Status via runner status. Under concurrency.mode: one_executor, Runner and a hook host cannot both hold an armed executing session.`,
      );
    } else {
      tips.push(
        `If Autopilot skills or hooks do not appear in ${host}: reload or restart ${host}, then open a new agent session.`,
      );
    }
  }
  return tips;
}

/** Non-interactive init / upgrade footer lines (English). */
export function formatPostInstallFooter(
  platformOrPlatforms: string | readonly string[],
): string[] {
  return [
    formatPostInstallOutro(platformOrPlatforms),
    ...formatHostActivationTips(platformOrPlatforms),
  ];
}

/** Installable host options for interactive multiselect (English). */
export function installableHostOptions(): {
  value: string;
  label: string;
  binding: PlatformBinding;
}[] {
  return INSTALLABLE_BINDINGS.map((b) => ({
    value: `${b.id}:${b.surface}`,
    label: formatBindingOptionLabel(b),
    binding: { id: b.id, surface: b.surface },
  }));
}

/** Plain (no markdown) host tips — cheat sheet / footer. */
function hostActivationPlainLines(
  locale: InitLocale,
  platformOrPlatforms: string | readonly string[],
): string[] {
  const ids = uniquePlatformIds(platformOrPlatforms);
  const lines: string[] = [];
  for (const id of ids.length > 0 ? ids : ["cursor"]) {
    const host = formatHostDisplayName(id);
    if (locale === "zh-CN") {
      if (id === "cursor") {
        lines.push(
          `在 ${host} 中试用 /autopilot-on。`,
          `若 skills / hooks 未出现：执行 Developer: Reload Window，或新开一条 Agent 对话。`,
        );
      } else if (id === "claude-code") {
        lines.push(
          `在 ${host} 中试用 /autopilot-on（hooks 跨终端与 IDE 共用）。`,
          `若 skills / hooks 未出现：重启 ${host} 并开新会话；项目 env（BLOCK_CAP）可能需先信任本目录。`,
        );
      } else if (id === "codex") {
        lines.push(
          `在 ${host} 中优先用 triggers.on / triggers.run 行首短语（无 Autopilot skills；手打 slash 仍可解析）。`,
          `hooks 仅写 .codex/hooks.json；安装/升级后请用 /hooks 信任；不改 config.toml hooks。`,
        );
      } else if (id === "kimi-code") {
        lines.push(
          `在 ${host} 中优先用 triggers.on / triggers.run 行首短语（无 Autopilot skills/AGENTS.md；手打 slash 仍可解析）。`,
          `hooks 合并进 $KIMI_CODE_HOME/config.toml（默认 ~/.kimi-code；不写 local.toml）。推荐 confirm_rounds: 1（Stop-continue 硬顶 1/turn）。`,
        );
      } else if (id === "copilot-cli") {
        lines.push(
          `在 ${host} 中优先用 triggers.on / triggers.run 行首短语（无 Autopilot skills/AGENTS.md；手打 slash 仍可解析）。`,
          `hooks 写入 .github/hooks/autopilot-harness.json（bash+powershell；timeoutSec ≥120）。安装/升级后请重启 Copilot CLI。`,
        );
      } else if (id === "grok-build") {
        lines.push(
          `在 ${host} 中优先用 triggers.on / triggers.run 行首短语（无 Autopilot skills/AGENTS.md；手打 slash 仍可解析）。`,
          `hooks 仅写 .grok/hooks/autopilot-harness.json（timeout 120）。安装/升级后请用 /hooks-trust 或 --trust 信任。`,
        );
      } else if (id === "gemini-cli") {
        lines.push(
          `在 ${host} 中试用 /autopilot-on（skills 在 .gemini/skills）或行首 triggers.on / triggers.run。`,
          `hooks 写 .gemini/settings.json（nested；timeout 120000ms）；skills 始终写 .gemini/skills（即使同时启用 Antigravity 也不跳过）。安装/升级后请重新信任 hooks、查看 /hooks panel、确认 folder trust，并 /skills reload。`,
        );
      } else if (id === "factory-droid") {
        lines.push(
          `在 ${host} 中试用 /autopilot-on（skills 在 .factory/skills）或行首 triggers.on / triggers.run。`,
          `hooks 写 .factory/hooks.json（顶层 event；timeout 120；命令用 $FACTORY_PROJECT_DIR）；skills 含 disable-model-invocation: true。安装/升级后请查看 /hooks，并 reload 或新开会话以刷新 hooks 快照。`,
        );
      } else if (id === "hermes-agent") {
        lines.push(
          `在 ${host} 中试用 /autopilot-on（skills 在 $HERMES_HOME/skills）或行首 triggers.on / triggers.run。`,
          `hooks 合并进 $HERMES_HOME/config.yaml（默认 ~/.hermes；永不写 cli-config.yaml；timeout 120；相对 command；agent.max_verify_nudges ≥32；不写 hooks_auto_accept / verify_guidance）。pre_verify 仅在有产品编辑时触发（无编辑 → pending/RESUME）。安装后请 reload Hermes，并运行 hermes hooks doctor；consent/non-TTY 需批准或 --accept-hooks / HERMES_ACCEPT_HOOKS。`,
        );
      } else if (id === "antigravity") {
        lines.push(
          `在 ${host} 中试用 /autopilot-on（skills 在 .agents/skills）或行首 triggers.on / triggers.run。`,
          `hooks 写 .agents/hooks.json（具名 autopilot-harness；timeout 120；.agents/bin shim；不写 .agent/）。安装/升级后请 reload 或新开会话（IDE tip：未 reload 时 hooks 可能不响）。CLI 须挂项目 workspace（如 --add-dir / 打开文件夹），否则 hooks 可能不加载（loaded 0）。auto-attach ≠ Autopilot ON — 仍需 /autopilot-on 或行首触发。`,
        );
      } else if (id === "runner") {
        lines.push(
          `在 .autopilot/config.yml 设置 runner.command（无假默认），然后：autopilot-harness runner start --run <slug>。`,
          `查看状态：autopilot-harness runner status。concurrency.mode: one_executor 下，Runner 与 hook 宿主不能同时持有武装 executing 会话。`,
        );
      } else {
        lines.push(
          `在 ${host} 中试用 /autopilot-on。`,
          `若 skills / hooks 未出现：重载或重启 ${host}，再开新会话。`,
        );
      }
    } else if (id === "cursor") {
      lines.push(
        `Try /autopilot-on in ${host}.`,
        `If skills or hooks are missing: Developer: Reload Window, or start a new Agent chat.`,
      );
    } else if (id === "claude-code") {
      lines.push(
        `Try /autopilot-on in ${host} (hooks shared: terminal + IDE).`,
        `If skills or hooks are missing: restart ${host} and open a new session; project env (BLOCK_CAP) may require trusting this folder.`,
      );
    } else if (id === "codex") {
      lines.push(
        `In ${host}, prefer line-start triggers.on / triggers.run (no Autopilot skills path; typed slash still parses).`,
        `Hooks are written to .codex/hooks.json only; trust via /hooks after install/upgrade; config.toml hooks are left untouched.`,
      );
    } else if (id === "kimi-code") {
      lines.push(
        `In ${host}, prefer line-start triggers.on / triggers.run (no Autopilot skills/AGENTS.md; typed slash still parses).`,
        `Hooks merge into $KIMI_CODE_HOME/config.toml (default ~/.kimi-code; does not write local.toml). Prefer confirm_rounds: 1 — Stop-continue hard-capped at 1/turn.`,
      );
    } else if (id === "copilot-cli") {
      lines.push(
        `In ${host}, prefer line-start triggers.on / triggers.run (no Autopilot skills/AGENTS.md; typed slash still parses).`,
        `Hooks are written to .github/hooks/autopilot-harness.json (bash+powershell; timeoutSec ≥120). Restart Copilot CLI after install or upgrade.`,
      );
    } else if (id === "grok-build") {
      lines.push(
        `In ${host}, prefer line-start triggers.on / triggers.run (no Autopilot skills/AGENTS.md; typed slash still parses).`,
        `Hooks are written to .grok/hooks/autopilot-harness.json only (timeout 120). Trust via /hooks-trust or --trust after install or upgrade.`,
      );
    } else if (id === "gemini-cli") {
      lines.push(
        `In ${host}, try /autopilot-on (skills under .gemini/skills) or line-start triggers.on / triggers.run.`,
        `Hooks are written to .gemini/settings.json (nested; timeout 120000ms); skills always under .gemini/skills (not skipped when Antigravity is also enabled). After install/upgrade: re-trust hooks, check /hooks panel, ensure folder trust, and /skills reload.`,
      );
    } else if (id === "factory-droid") {
      lines.push(
        `In ${host}, try /autopilot-on (skills under .factory/skills) or line-start triggers.on / triggers.run.`,
        `Hooks are written to .factory/hooks.json (top-level events; timeout 120; commands use $FACTORY_PROJECT_DIR); skills include disable-model-invocation: true. After install/upgrade: check /hooks, then reload or start a new session so the hooks snapshot refreshes.`,
      );
    } else if (id === "hermes-agent") {
      lines.push(
        `In ${host}, try /autopilot-on (skills under $HERMES_HOME/skills) or line-start triggers.on / triggers.run.`,
        `Hooks merge into $HERMES_HOME/config.yaml (default ~/.hermes; never cli-config.yaml; timeout 120; relative command; agent.max_verify_nudges ≥32; does not set hooks_auto_accept or rewrite verify_guidance). pre_verify is edit-only (no product edit → pending/RESUME). After install: reload Hermes and run hermes hooks doctor; consent/non-TTY needs approval or --accept-hooks / HERMES_ACCEPT_HOOKS.`,
      );
    } else if (id === "antigravity") {
      lines.push(
        `In ${host}, try /autopilot-on (skills under .agents/skills) or line-start triggers.on / triggers.run.`,
        `Hooks are written to .agents/hooks.json (named autopilot-harness block; timeout 120; .agents/bin shim; does not write .agent/). After install/upgrade: reload or start a new session (IDE tip: hooks may stay silent until reload). CLI: mount the project workspace (e.g. --add-dir / open the folder) or hooks may not load (loaded 0). Auto-attach ≠ Autopilot ON — still run /autopilot-on or a line-start trigger.`,
      );
    } else if (id === "runner") {
      lines.push(
        `Set runner.command in .autopilot/config.yml (no fake default), then: autopilot-harness runner start --run <slug>.`,
        `Status: autopilot-harness runner status. Under concurrency.mode: one_executor, Runner and a hook host cannot both hold an armed executing session.`,
      );
    } else {
      lines.push(
        `Try /autopilot-on in ${host}.`,
        `If skills or hooks are missing: reload or restart ${host}, then open a new agent session.`,
      );
    }
  }
  return lines;
}

/** Markdown bullets for docs/autopilot/quickstart.md. */
function hostActivationDocLines(
  locale: InitLocale,
  platform: string,
): string[] {
  return hostActivationPlainLines(locale, platform).map((l) =>
    l
      .replaceAll("/autopilot-on", "`/autopilot-on`")
      .replaceAll("/autopilot-*", "`/autopilot-*`")
      .replaceAll("Developer: Reload Window", "`Developer: Reload Window`")
      .replaceAll("triggers.on", "`triggers.on`")
      .replaceAll("triggers.run", "`triggers.run`")
      .replaceAll("$KIMI_CODE_HOME", "`$KIMI_CODE_HOME`")
      .replaceAll("~/.kimi-code", "`~/.kimi-code`")
      .replaceAll("local.toml", "`local.toml`")
      .replaceAll("confirm_rounds", "`confirm_rounds`")
      .replaceAll("config.toml", "`config.toml`")
      // Wrap long Copilot path before generic `/hooks` (avoids splitting it).
      .replaceAll(
        ".github/hooks/autopilot-harness.json",
        "`.github/hooks/autopilot-harness.json`",
      )
      .replaceAll(
        ".grok/hooks/autopilot-harness.json",
        "`.grok/hooks/autopilot-harness.json`",
      )
      .replaceAll(".gemini/settings.json", "`.gemini/settings.json`")
      .replaceAll(
        ".gemini/skills/autopilot-*",
        "`.gemini/skills/autopilot-*`",
      )
      .replaceAll(".gemini/skills", "`.gemini/skills`")
      .replaceAll(".factory/hooks.json", "`.factory/hooks.json`")
      .replaceAll(
        ".factory/skills/autopilot-*",
        "`.factory/skills/autopilot-*`",
      )
      .replaceAll(".factory/skills", "`.factory/skills`")
      .replaceAll(".agents/hooks.json", "`.agents/hooks.json`")
      // Longer skills path before the directory prefix (avoid `` `.agents/skills`/autopilot-* ``).
      .replaceAll(
        ".agents/skills/autopilot-*",
        "`.agents/skills/autopilot-*`",
      )
      .replaceAll(".agents/skills", "`.agents/skills`")
      .replaceAll(".agent/", "`.agent/`")
      .replaceAll("$FACTORY_PROJECT_DIR", "`$FACTORY_PROJECT_DIR`")
      // Hermes: wrap longest tokens first — never bare `config.yaml` / `$HERMES_HOME`
      // after wrapping (would split `cli-config.yaml` or `$HERMES_HOME/config.yaml`).
      .replaceAll(
        "$HERMES_HOME/skills/autopilot-*",
        "`$HERMES_HOME/skills/autopilot-*`",
      )
      .replaceAll("$HERMES_HOME/skills", "`$HERMES_HOME/skills`")
      .replaceAll(
        "$HERMES_HOME/config.yaml",
        "`$HERMES_HOME/config.yaml`",
      )
      .replaceAll("cli-config.yaml", "`cli-config.yaml`")
      .replaceAll("~/.hermes", "`~/.hermes`")
      .replaceAll("hermes hooks doctor", "`hermes hooks doctor`")
      .replaceAll("hooks_auto_accept", "`hooks_auto_accept`")
      .replaceAll("verify_guidance", "`verify_guidance`")
      .replaceAll("agent.max_verify_nudges", "`agent.max_verify_nudges`")
      .replaceAll("HERMES_ACCEPT_HOOKS", "`HERMES_ACCEPT_HOOKS`")
      .replaceAll("--accept-hooks", "`--accept-hooks`")
      // Longer /hooks* tips before generic `/hooks` wrap.
      .replaceAll("/hooks panel", "`/hooks panel`")
      .replaceAll("/skills reload", "`/skills reload`")
      .replaceAll("/hooks-trust", "`/hooks-trust`")
      // Trust tip `/hooks` only — do not split `.github/hooks/...`,
      // `.codex/hooks.json`, `.factory/hooks.json`, or already-wrapped `/hooks panel`.
      .replace(/\/hooks(?!-trust)(?!\.json)(?!\/)(?! panel)/g, "`/hooks`")
      .replaceAll("--trust", "`--trust`")
      .replaceAll("--add-dir", "`--add-dir`")
      .replaceAll(".codex/hooks.json", "`.codex/hooks.json`"),
  );
}

export function writeQuickstart(
  projectRoot: string,
  locale: InitLocale,
  plansDir = "plans",
  platform = "cursor",
): string | null {
  const root = resolveProjectRootOrThrow(projectRoot);
  const normalized = normalizePlansDir(plansDir);
  const plansLabel = normalized.ok ? normalized.value : "plans";
  const docsDir = path.join(root, "docs");
  const destDir = path.join(docsDir, "autopilot");
  assertNotSymlink(docsDir, "docs/");
  assertNotSymlink(destDir, "docs/autopilot/");
  mkdirRealDirSync(destDir, "docs/autopilot/", root);
  assertRealpathInside(root, destDir, "docs/autopilot/");
  const dest = path.join(destDir, "quickstart.md");
  try {
    const st = fs.lstatSync(dest);
    if (st.isSymbolicLink()) {
      throw new Error(
        "docs/autopilot/quickstart.md is a symlink; refusing to open",
      );
    }
    if (st.isFile()) return null;
    throw new Error(
      "docs/autopilot/quickstart.md exists and is not a regular file",
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
  }
  const platformId = sanitizePlatformId(platform) || "cursor";
  const host = formatHostDisplayName(platformId);
  const afterInstall = hostActivationDocLines(locale, platformId);
  // Codex + Kimi + Copilot + Grok: P0 is line-start triggers (no Autopilot skills path).
  // Gemini / Factory / Hermes / Antigravity co-install skills — prefer slash + line-start.
  const isLineStartHost =
    platformId === "codex" ||
    platformId === "kimi-code" ||
    platformId === "copilot-cli" ||
    platformId === "grok-build";
  const flowPlanYouZh = isLineStartHost
    ? "行首 `Autopilot ON` / `开启自动驾驶`（或手打 `/autopilot-on`）；逐轮回答 grill"
    : "`/autopilot-on`（可带需求描述）；逐轮回答 grill";
  const flowRunYouZh = isLineStartHost
    ? "行首 `Autopilot RUN` / `开始执行`（或手打 `/autopilot-run`，可带 `<slug>`）"
    : "`/autopilot-run`（或带 `<slug>`）";
  const planningPrefZh = isLineStartHost
    ? `推荐：在 ${host} 中优先行首 \`Autopilot ON\` / \`开启自动驾驶\`（无 Autopilot skills UI；手打 \`/autopilot-on\` 仍可解析）

也可：\`/autopilot-on\` 或 \`/autopilot-on <需求描述>\``
    : `推荐：在 ${host} 中使用 \`/autopilot-on\` 或 \`/autopilot-on <需求描述>\`

也可：行首 \`Autopilot ON\` / \`开启自动驾驶\``;
  const executingPrefZh = isLineStartHost
    ? `优先：行首 \`Autopilot RUN\` / \`开始执行\`（手打 \`/autopilot-run\` 仍可解析）

也可：\`/autopilot-run\` 或 \`/autopilot-run <slug>\``
    : `\`/autopilot-run\` 或 \`/autopilot-run <slug>\`

也可：\`Autopilot RUN\` / \`开始执行\``;
  const runSkillZh = isLineStartHost
    ? `**RUN：** 非 executing（needPick）时先选型；真正 executing 再跑 checklist（${host} 无 Autopilot skills 路径）。`
    : `**\`autopilot-run\` skill：** 非 executing（needPick）时首分支**只选型**；真正 executing 再跑 checklist。`;
  const flowPlanYouEn = isLineStartHost
    ? "line-start `Autopilot ON` (or typed `/autopilot-on`); reply to each grill round"
    : "`/autopilot-on` (optional description); reply to each grill round";
  const flowRunYouEn = isLineStartHost
    ? "line-start `Autopilot RUN` (or typed `/autopilot-run`, optional `<slug>`)"
    : "`/autopilot-run` (or with `<slug>`)";
  const planningPrefEn = isLineStartHost
    ? `Preferred: in ${host}, line-start \`Autopilot ON\` (no Autopilot skills UI; typed \`/autopilot-on\` still parses)

Also: \`/autopilot-on\` or \`/autopilot-on <what to build>\``
    : `Preferred: in ${host}, \`/autopilot-on\` or \`/autopilot-on <what to build>\`

Also: line-start \`Autopilot ON\``;
  const executingPrefEn = isLineStartHost
    ? `Preferred: line-start \`Autopilot RUN\` (typed \`/autopilot-run\` still parses)

Also: \`/autopilot-run\` or \`/autopilot-run <slug>\``
    : `\`/autopilot-run\` or \`/autopilot-run <slug>\`

Also: \`Autopilot RUN\``;
  const runSkillEn = isLineStartHost
    ? `**RUN:** when not executing (needPick), pick first; checklist execution only after executing is armed (no Autopilot skills path on ${host}).`
    : `**\`autopilot-run\` skill:** when not executing (needPick), first branch is **pick only**; checklist execution only after executing is armed.`;
  const body =
    locale === "zh-CN"
      ? `# Autopilot 快速开始

命令速查 + 每步产物。

## 推荐流程（产物）

| 步骤 | 你做什么 | Autopilot 做什么 | 产物 |
|------|----------|------------------|------|
| **1. 规划** | ${flowPlanYouZh} | 写 \`${plansLabel}/<slug>/\`（可改文档），**不写产品代码** | \`brief.md\`、\`plan.md\`、\`checklist.md\` |
| **2. 执行** | ${flowRunYouZh} | 一项一项：实现 → 自审修复 → 多角度确认 → 勾选推进 | 该项代码/文档；推进/完成时 dirty 则本地 commit（干净则跳过；确认轮不 commit；默认不自动 push） |
| **3. 完成** | — | 勾选最后一项；dirty 则本地 commit（干净则跳过；默认不自动 push）；checklist 清空后停止 | 该轨结束 |

## Planning

${planningPrefZh}

**讨论 ≠ ON。** 普通闲聊不会开启 Autopilot；只有 slash \`/autopilot-on\` 或行首 ON 触发语（如 \`Autopilot ON\`、\`开启自动驾驶\`）才会 \`applyOn\`。

Skills 面板上 \`/autopilot-on\` 的 **description** 只是短展示文案（**不是**触发条件）；门闩在 **skill 正文**。升到会改 stock skill 文案的版本后，请跑 \`npx @autopilot-harness/cli upgrade\` 或 \`npx @autopilot-harness/cli locale set <en|zh-CN>\` 刷新已安装 skill。

## Executing

${executingPrefZh}

### 多 plan 选型（通道 A）vs 硬错误（通道 C）

| 情况 | 行为 |
|------|------|
| 多个可执行 plan、未唯一绑定、裸 RUN | **完整 agent 回合**（通道 A）：对话列候选，等数字或 \`/autopilot-run <slug>\`。**不是**错误弹窗 / blocked。本回合不写产品代码。 |
| 已绑唯一 plan / 仅 1 个 runnable / 命令已带 slug | 跳过选型，直接执行 |
| 另一会话 \`executing+armed\` | **拦截**（通道 C）+ snake_case \`user_message\`（含 track + 会话）；opaque 时用 \`status\` / \`doctor\`。释放：占用聊 OFF 或 \`session purge <id>\` |
| 非法 slug / 无 runnable | 通道 C（真错误，不是选型列表） |

**通道规则：** needPick → 只用通道 A；busy/真错误 → 通道 C。**禁止**对 busy 用 \`continue: true\` 凑可见性。

**示例脚本（裸 RUN，N≥2）：** Hook needPick（phase 非 executing）→ Cursor continue / Claude additionalContext → agent 编号列出 → 用户回数字或 \`/autopilot-run <slug>\` → 再进 executing。

**候选来源：** 扫 runnable \`${plansLabel}/*/checklist.md\`，和/或 \`status\`（\`pending\` + \`candidates\`）；status 失败时回退扫盘。

${runSkillZh}

**ON ≠ 锁：** planning 不占 \`one_executor\`。**Plans 绑定 / 脏 bind：** 本聊只编过 1 个 \`${plansLabel}/<slug>/\` → 裸 RUN 可直跑；≥2 / 脏 \`_multi\` → 仍 needPick；REPLAN/ON 换轨会清/失效 bind。

## 暂停 / 恢复 / 改方案

- 暂停：\`/autopilot-off\` 或行首 \`Autopilot OFF\` / \`关闭自动驾驶\` — 本会话 paused；不推进 checklist，也不跑自审，直到 resume（phase 通常不变；\`done\` → \`idle\`）。僵死 \`executing+armed\`：占用聊 OFF，或 \`status\`/\`doctor\` 确认后 \`session purge <id>\`。
- 恢复：\`/autopilot-resume\` 或 \`/autopilot-resume <slug>\`（新聊天可认领旧轨）；也可行首 \`Autopilot RESUME\` / \`继续执行\` — 清 pause，**保留**自审链进度；多轨执行中时用 \`<slug>\` 指定。认领后以**本聊天**为执行会话；勿在旧聊天继续跑同一轨。认领优先未 pause 的执行会话，也可回退到唯一一条**已 pause** 的执行轨（旧聊天已死时恢复）。
- 改方案：\`/autopilot-replan\` 或行首 \`Autopilot REPLAN\` / \`修改方案\` — 回到 planning，**重置**自审链；只改 \`plan.md\` 与未勾选项，勿静默删已完成 \`[x]\`；改完再 \`/autopilot-run\`。

## 终端

**安装**用 scoped 包名（不要用不存在的裸 \`npx ${CLI_NAME}\`）。\`cwd\` = 目标项目：

\`\`\`bash
npx ${NPM_PACKAGE_NAME} init --platform ${platformId} --yes
npx ${NPM_PACKAGE_NAME} status
npx ${NPM_PACKAGE_NAME} doctor
npx ${NPM_PACKAGE_NAME} upgrade --dry-run
\`\`\`

从本仓库克隆开发或 dogfood：见 https://github.com/mt2007/autopilot-harness/blob/main/CONTRIBUTING.md 。

## 安装后

${afterInstall.map((l) => `- ${l}`).join("\n")}

## 自审范围（\`review.scope\`）

写在 \`.autopilot/config.yml\`：

| 取值 | 含义 |
|------|------|
| **\`project\`**（默认） | **任意**产品代码编辑都会自审——**不需要**先 ON / RUN |
| **\`executing_only\`** | 仅在 \`/autopilot-run\`（checklist 执行中）且改了产品代码后，才走修复 → 多角度确认 |

产品代码排除命中 \`.autopilotignore\` 的路径，以及**未跟踪且被 \`.gitignore\` 忽略**的路径。暂停 / OFF 期间不跑自审链，需 resume。

只开 \`/autopilot-on\` **不会**启动自审（规划只写方案/文档）。\`project\` 且**未在** checklist 执行中（含仍在 planning）时，确认链以 **自审完成** 结束（不勾选推进 checklist）；在 RUN 执行中则仍按项推进/完成。若已有全局 Cursor 自审 hook，慎与 \`project\` 叠用（可能双重注入）。各宿主自带的 Plan 模式与 Autopilot 无关，目前未对接。

## 排障速查

- skills / hooks 未出现：\`Developer: Reload Window\`，或新开 Agent 对话；再跑 \`doctor\`。
- 自审中途停住：确认 Autopilot stop 带 \`loop_limit: null\`（缺则 \`upgrade\`）；Cursor 默认 stop 上限为 5。
- \`project\` 下双重 followup：关掉 \`~/.cursor\` 全局自审，或只用 Autopilot。
- 改了代码却不自审：检查 \`review.scope\`、是否 paused/OFF、路径是否被 \`.autopilotignore\` / 未跟踪+\`.gitignore\` 排除。

方案与清单在 \`${plansLabel}/<slug>/\`（权威进度是 \`checklist.md\`）。
`
      : `# Autopilot quickstart

Command cheat sheet + per-step artifacts.

## Recommended flow (artifacts)

| Step | You do | Autopilot does | Artifacts |
|------|--------|----------------|-----------|
| **1. Plan** | ${flowPlanYouEn} | Writes \`${plansLabel}/<slug>/\` (may edit docs); **no product code** | \`brief.md\`, \`plan.md\`, \`checklist.md\` |
| **2. Run** | ${flowRunYouEn} | One item at a time: implement → fix → multi-lens confirm → advance | Code/docs for that item; on advance/done, local commit if dirty (skip if clean; confirm rounds do not commit; no auto-push) |
| **3. Done** | — | Marks the last item; local commit if dirty (skip if clean; no auto-push); stops when the checklist is clear | Track complete |

## Planning

${planningPrefEn}

**Discussion ≠ ON.** Casual chat does not turn Autopilot on — only slash \`/autopilot-on\` or a line-start ON phrase (e.g. \`Autopilot ON\`) runs \`applyOn\`.

The Skills-panel **description** for \`/autopilot-on\` is short user-facing copy only (not a trigger). The ON gate lives in the **skill body**. After upgrading to a release that changes stock skill copy, run \`npx @autopilot-harness/cli upgrade\` or \`npx @autopilot-harness/cli locale set <en|zh-CN>\` so installed skills refresh.

## Executing

${executingPrefEn}

### Multi-plan pick (channel A) vs hard failures (channel C)

| Case | Behavior |
|------|----------|
| Multiple runnable plans, no unique bind, bare RUN | **Full agent turn** (channel A): list candidates; wait for a number or \`/autopilot-run <slug>\`. **Not** an error popup / blocked. No product code this turn. |
| Unique bind / only one runnable / slug on the command | Skip pick; enter executing |
| Another session \`executing+armed\` | **Block** (channel C) + snake_case \`user_message\` (track + session); opaque → \`status\` / \`doctor\`. Release: OFF there or \`session purge <id>\` |
| Illegal slug / no runnable | Channel C (hard failure, not a pick list) |

**Channel rule:** needPick → channel A only; busy/true errors → channel C. Do **not** use \`continue: true\` on busy for visibility.

**Example script (bare RUN, N≥2):** Hook needPick (phase non-executing) → Cursor continue / Claude additionalContext → agent lists numbered plans → user replies with a number or \`/autopilot-run <slug>\` → then executing.

**Candidate sources:** scan runnable \`${plansLabel}/*/checklist.md\`, and/or \`status\` (\`pending\` + \`candidates\`); fall back to the plans scan if status fails.

${runSkillEn}

**ON ≠ lock:** planning does not hold \`one_executor\`. **Plans bind / dirty bind:** one edited \`${plansLabel}/<slug>/\` in this chat → bare RUN may auto-run; ≥2 / dirty \`_multi\` → still needPick; REPLAN/ON track change clears/invalidates the bind.

## Pause / resume / replan

- Pause: \`/autopilot-off\` or line-start \`Autopilot OFF\` — pauses this conversation; no checklist advance and no self-review until resume (phase usually unchanged; \`done\` → \`idle\`). Stuck \`executing+armed\`: OFF in that chat, or \`session purge <id>\` after \`status\` / \`doctor\`.
- Resume: \`/autopilot-resume\` or \`/autopilot-resume <slug>\` (new chat can claim a track); also line-start \`Autopilot RESUME\` — clears pause, **keeps** the review chain; use \`<slug>\` when several tracks are executing. After a claim, **this** chat owns the session; do not keep executing the same track in the old chat. Claim prefers an unpaused executing worker, and can fall back to a single **paused** executing session (dead-chat recovery).
- Replan: \`/autopilot-replan\` or line-start \`Autopilot REPLAN\` — returns to planning and **resets** the review chain; revise \`plan.md\` and unchecked items only (do not silently delete completed \`[x]\`); then \`/autopilot-run\` when ready.

## Terminal

**Install** with the scoped package (not bare \`npx ${CLI_NAME}\`). \`cwd\` = the app:

\`\`\`bash
npx ${NPM_PACKAGE_NAME} init --platform ${platformId} --yes
npx ${NPM_PACKAGE_NAME} status
npx ${NPM_PACKAGE_NAME} doctor
npx ${NPM_PACKAGE_NAME} upgrade --dry-run
\`\`\`

Developing or dogfooding from a clone of this repo: see https://github.com/mt2007/autopilot-harness/blob/main/CONTRIBUTING.md .

## After install

${afterInstall.map((l) => `- ${l}`).join("\n")}

## Self-review scope (\`review.scope\`)

In \`.autopilot/config.yml\`:

| Value | Meaning |
|-------|---------|
| **\`project\`** (default) | Fix → confirm on **any** product-code edit — **no** ON/RUN required |
| **\`executing_only\`** | Fix → confirm only after \`/autopilot-run\` (checklist executing) + product-code edits |

Product-code paths exclude \`.autopilotignore\` hits and **untracked** \`.gitignore\` hits. Paused/OFF skips the chain until resume.

\`/autopilot-on\` by itself does **not** start self-review (planning writes plans/docs only). With \`project\` and **not** checklist-executing (including still planning), the chain ends at **review complete** (no checklist advance); during RUN it still advances/done as usual. Avoid stacking a global Cursor self-review hook with \`project\` (double injection). Host Plan modes are separate; Autopilot does not bridge them yet.

## Troubleshooting

- Skills / hooks missing: \`Developer: Reload Window\`, or a new Agent chat; then run \`doctor\`.
- Review stops mid-chain: ensure Autopilot stop has \`loop_limit: null\` (run \`upgrade\` if missing); Cursor defaults stop hooks to 5.
- Double followups under \`project\`: disable \`~/.cursor\` global self-review, or use Autopilot alone.
- Edited code but no self-review: check \`review.scope\`, paused/OFF, and whether the path is excluded by \`.autopilotignore\` or untracked+\`.gitignore\`.

Artifacts live under \`${plansLabel}/<slug>/\` (progress authority is \`checklist.md\`).
`;
  assertNotSymlink(dest, "docs/autopilot/quickstart.md");
  writeTextFileReplace(dest, body, root);
  return path.relative(root, dest);
}

export function formatCheatSheet(
  locale: InitLocale,
  cliCommand: string = resolveCliCommand(),
  plansDir = "plans",
  platformOrPlatforms: string | readonly string[] = "cursor",
): string[] {
  const normalized = normalizePlansDir(plansDir);
  const plansLabel = normalized.ok ? normalized.value : "plans";
  const ids = uniquePlatformIds(platformOrPlatforms);
  const host =
    ids.length <= 1
      ? formatHostDisplayName(ids[0] ?? "cursor")
      : ids.map((id) => formatHostDisplayName(id)).join(" / ");
  // All selected hosts are line-start P0 (Codex/Kimi/Copilot/Grok) — prefer triggers
  // over slash, including multi line-start-only host mixes.
  const lineStartOnly =
    ids.length > 0 &&
    ids.every(
      (id) =>
        id === "codex" ||
        id === "kimi-code" ||
        id === "copilot-cli" ||
        id === "grok-build",
    );
  const lineStartSideTips = lineStartOnly
    ? []
    : ids.filter(
        (id) =>
          id === "codex" ||
          id === "kimi-code" ||
          id === "copilot-cli" ||
          id === "grok-build",
      );
  if (locale === "zh-CN") {
    const planningBlock = lineStartOnly
      ? [
          `  推荐：在 ${host} 中行首 Autopilot ON / 开启自动驾驶`,
          "        （无 Autopilot skills；手打 /autopilot-on 仍可解析）",
          "  也可：/autopilot-on · /autopilot-on 我想做：<描述需求>",
        ]
      : [
          `  推荐：在 ${host} 中 /autopilot-on`,
          "        /autopilot-on 我想做：<描述需求>",
          "  也可：Autopilot ON",
          ...lineStartSideTips.map(
            (id) =>
              `  ${formatHostDisplayName(id)}：优先行首 Autopilot ON / 开启自动驾驶（手打 slash 仍可解析）`,
          ),
        ];
    const executingBlock = lineStartOnly
      ? [
          "  优先：行首 Autopilot RUN / 开始执行",
          "  也可：/autopilot-run · /autopilot-run <slug>",
        ]
      : [
          "  /autopilot-run",
          "  /autopilot-run <slug>",
          ...lineStartSideTips.map(
            (id) =>
              `  ${formatHostDisplayName(id)}：优先行首 Autopilot RUN / 开始执行`,
          ),
        ];
    return [
      "── 新开任务（Planning）──────────────────",
      ...planningBlock,
      "",
      "── 开始执行 ─────────────────────────────",
      ...executingBlock,
      "",
      "── 暂停 / 恢复 / 改方案 ─────────────────",
      "  Autopilot OFF · RESUME · REPLAN",
      "",
      "── 终端 ─────────────────────────────────",
      `  ${cliCommand} status`,
      `  ${cliCommand} doctor`,
      `  ${cliCommand} session list`,
      `  ${cliCommand} locale set en`,
      "",
      "── 生效提示 ─────────────────────────────",
      ...hostActivationPlainLines(locale, ids).map((l) => `  ${l}`),
      "",
      `  详细：docs/autopilot/quickstart.md · ${plansLabel}/README.md`,
    ];
  }
  const planningBlockEn = lineStartOnly
    ? [
        `  Preferred: in ${host}, line-start Autopilot ON`,
        "             (no Autopilot skills; typed /autopilot-on still parses)",
        "  Also:      /autopilot-on · /autopilot-on <what to build>",
      ]
    : [
        `  Preferred: in ${host}, /autopilot-on`,
        "             /autopilot-on <what to build>",
        "  Also:      Autopilot ON",
        ...lineStartSideTips.map(
          (id) =>
            `  ${formatHostDisplayName(id)}:     prefer line-start Autopilot ON (typed slash still parses)`,
        ),
      ];
  const executingBlockEn = lineStartOnly
    ? [
        "  Preferred: line-start Autopilot RUN",
        "  Also:      /autopilot-run · /autopilot-run <slug>",
      ]
    : [
        "  /autopilot-run",
        "  /autopilot-run <slug>",
        ...lineStartSideTips.map(
          (id) =>
            `  ${formatHostDisplayName(id)}:     prefer line-start Autopilot RUN`,
        ),
      ];
  return [
    "── Planning ─────────────────────────────",
    ...planningBlockEn,
    "",
    "── Executing ────────────────────────────",
    ...executingBlockEn,
    "",
    "── Pause / resume / replan ──────────────",
    "  Autopilot OFF · RESUME · REPLAN",
    "",
    "── Terminal ─────────────────────────────",
    `  ${cliCommand} status`,
    `  ${cliCommand} doctor`,
    `  ${cliCommand} session list`,
    `  ${cliCommand} locale set zh-CN`,
    "",
    "── After install ────────────────────────",
    ...hostActivationPlainLines(locale, ids).map((l) => `  ${l}`),
    "",
    `  See: docs/autopilot/quickstart.md · ${plansLabel}/README.md`,
  ];
}
