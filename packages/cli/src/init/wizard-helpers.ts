import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { CLI_NAME } from "../names.js";
import type { InitLocale, InitYesOptions, PlansGitPolicy } from "./types.js";
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
  platform: "cursor";
  surface: "ide";
  plansDir: string;
  plansGit: PlansGitPolicy;
  verifyEnabled: boolean;
  /** executing_only = after RUN; project = any product-code edit. */
  reviewScope: "executing_only" | "project";
  /** 0 = unlimited. */
  maxErrorsBeforePause: number;
  shellAlias: ShellAliasTarget;
  force: boolean;
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
  body += `\n# ${comment}\n${toAdd.map((l) => `${l}\n`).join("")}`;
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
    ".autopilot/worktrees/",
    ".autopilot/verify-last.json",
    ".autopilot/logs/",
  ]);
}

/** Map wizard answers → installInitYes options (+ post-install alias). */
export function answersToInstallOptions(
  answers: InitWizardAnswers,
): InitYesOptions {
  return {
    projectRoot: answers.projectRoot,
    platform: answers.platform,
    surface: answers.surface,
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
    // Refuse control chars that break shell rc lines.
    if (/[\0\n\r]/.test(abs)) return null;
    if (!isTrustedCliEntrypoint(abs)) return null;
    return abs;
  } catch {
    return null;
  }
}

/**
 * argv[1] is often some other .js under test runners / wrappers.
 * Only accept known Autopilot CLI entry names (and bin.js under our package paths).
 */
export function isTrustedCliEntrypoint(absPath: string): boolean {
  if (typeof absPath !== "string" || !absPath.trim()) return false;
  // Normalize before basename — on POSIX, path.basename ignores `\`, so a
  // Windows-style path would otherwise never look like `bin.js`.
  const norm = absPath.split(/[/\\]+/).filter(Boolean).join("/");
  const base = path.posix.basename(norm);
  if (
    base === "autopilot-harness" ||
    base === "autopilot-harness.js" ||
    base === "autopilot-harness.mjs"
  ) {
    return true;
  }
  if (base !== "bin.js") return false;
  // Local monorepo, scoped package, or npm-installed package root.
  return (
    /(^|\/)packages\/cli\/(dist|src)\/bin\.js$/.test(norm) ||
    /(^|\/)@autopilot-harness\/cli\/(dist|src)\/bin\.js$/.test(norm) ||
    /(^|\/)autopilot-harness\/(dist|src)\/bin\.js$/.test(norm)
  );
}

/**
 * Runnable CLI command for docs / cheat sheets.
 * Prefers `node <this-bin>`; falls back to `npx autopilot-harness`.
 */
export function resolveCliCommand(): string {
  const script = tryResolveRunningCliScript();
  if (script) return `node ${shellSingleQuote(script)}`;
  return `npx ${CLI_NAME}`;
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
  return `autopilot() { command npx ${CLI_NAME} "$@"; }`;
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
function sanitizePlatformId(platform: string): string {
  if (typeof platform !== "string") return "";
  return platform
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/[^A-Za-z0-9._+-]/g, "")
    .toLowerCase()
    .slice(0, 64);
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
    case "kimi-code":
      return "Kimi Code";
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
export function formatPostInstallOutro(platform: string): string {
  return `You're all set — try /autopilot-on in ${formatHostDisplayName(platform)}.`;
}

/**
 * Host-specific activation tips after hooks/skills install.
 * Always English (init UX language). Install what you chose → tip for that host.
 */
export function formatHostActivationTips(platform: string): string[] {
  const id = sanitizePlatformId(platform);
  const host = formatHostDisplayName(id);
  switch (id) {
    case "cursor":
      return [
        `If /autopilot-* skills or Autopilot hooks do not appear in ${host}: run Developer: Reload Window, or start a new Agent chat.`,
      ];
    default:
      return [
        `If Autopilot skills or hooks do not appear in ${host}: reload or restart ${host}, then open a new agent session.`,
      ];
  }
}

/** Non-interactive init / upgrade footer lines (English). */
export function formatPostInstallFooter(platform: string): string[] {
  return [formatPostInstallOutro(platform), ...formatHostActivationTips(platform)];
}

/** Plain (no markdown) host tips — cheat sheet / footer. */
function hostActivationPlainLines(
  locale: InitLocale,
  platform: string,
): string[] {
  const id = sanitizePlatformId(platform);
  const host = formatHostDisplayName(id);
  if (locale === "zh-CN") {
    if (id === "cursor") {
      return [
        `在 ${host} 中试用 /autopilot-on。`,
        `若 skills / hooks 未出现：执行 Developer: Reload Window，或新开一条 Agent 对话。`,
      ];
    }
    return [
      `在 ${host} 中试用 /autopilot-on。`,
      `若 skills / hooks 未出现：重载或重启 ${host}，再开新会话。`,
    ];
  }
  if (id === "cursor") {
    return [
      `Try /autopilot-on in ${host}.`,
      `If skills or hooks are missing: Developer: Reload Window, or start a new Agent chat.`,
    ];
  }
  return [
    `Try /autopilot-on in ${host}.`,
    `If skills or hooks are missing: reload or restart ${host}, then open a new agent session.`,
  ];
}

/** Markdown bullets for docs/autopilot/quickstart.md. */
function hostActivationDocLines(
  locale: InitLocale,
  platform: string,
): string[] {
  return hostActivationPlainLines(locale, platform).map((l) =>
    l
      .replace("/autopilot-on", "`/autopilot-on`")
      .replace(
        "Developer: Reload Window",
        "`Developer: Reload Window`",
      ),
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
  const cliCmd = resolveCliCommand();
  const host = formatHostDisplayName(platform);
  const afterInstall = hostActivationDocLines(locale, platform);
  const body =
    locale === "zh-CN"
      ? `# Autopilot 快速开始

## Planning

推荐：在 ${host} 中使用 \`/autopilot-on\` 或 \`/autopilot-on <需求描述>\`

也可：行首 \`Autopilot ON\` / \`开启自动驾驶\`

## Executing

\`/autopilot-run\` 或 \`/autopilot-run <slug>\`

也可：\`Autopilot RUN\` / \`开始执行\`

## 暂停 / 恢复 / 改方案

- 暂停：\`Autopilot OFF\`
- 恢复：\`Autopilot RESUME\` / \`/autopilot-resume\`
- 改方案：\`Autopilot REPLAN\` / \`/autopilot-replan\`

## 终端

\`\`\`bash
${cliCmd} status
${cliCmd} doctor
${cliCmd} upgrade --dry-run
\`\`\`

## 安装后

${afterInstall.map((l) => `- ${l}`).join("\n")}

方案与清单在 \`${plansLabel}/<slug>/\`。
`
      : `# Autopilot quickstart

## Planning

Preferred: in ${host}, \`/autopilot-on\` or \`/autopilot-on <what to build>\`

Also: line-start \`Autopilot ON\`

## Executing

\`/autopilot-run\` or \`/autopilot-run <slug>\`

Also: \`Autopilot RUN\`

## Pause / resume / replan

- Pause: \`Autopilot OFF\`
- Resume: \`Autopilot RESUME\` / \`/autopilot-resume\`
- Replan: \`Autopilot REPLAN\` / \`/autopilot-replan\`

## Terminal

\`\`\`bash
${cliCmd} status
${cliCmd} doctor
${cliCmd} upgrade --dry-run
\`\`\`

## After install

${afterInstall.map((l) => `- ${l}`).join("\n")}

Artifacts live under \`${plansLabel}/<slug>/\`.
`;
  assertNotSymlink(dest, "docs/autopilot/quickstart.md");
  writeTextFileReplace(dest, body, root);
  return path.relative(root, dest);
}

export function formatCheatSheet(
  locale: InitLocale,
  cliCommand: string = resolveCliCommand(),
  plansDir = "plans",
  platform = "cursor",
): string[] {
  const normalized = normalizePlansDir(plansDir);
  const plansLabel = normalized.ok ? normalized.value : "plans";
  const host = formatHostDisplayName(platform);
  if (locale === "zh-CN") {
    return [
      "── 新开任务（Planning）──────────────────",
      `  推荐：在 ${host} 中 /autopilot-on`,
      "        /autopilot-on 我想做：<描述需求>",
      "  也可：Autopilot ON",
      "",
      "── 开始执行 ─────────────────────────────",
      "  /autopilot-run",
      "  /autopilot-run <slug>",
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
      ...hostActivationPlainLines(locale, platform).map((l) => `  ${l}`),
      "",
      `  详细：docs/autopilot/quickstart.md · ${plansLabel}/README.md`,
    ];
  }
  return [
    "── Planning ─────────────────────────────",
    `  Preferred: in ${host}, /autopilot-on`,
    "             /autopilot-on <what to build>",
    "  Also:      Autopilot ON",
    "",
    "── Executing ────────────────────────────",
    "  /autopilot-run",
    "  /autopilot-run <slug>",
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
    ...hostActivationPlainLines(locale, platform).map((l) => `  ${l}`),
    "",
    `  See: docs/autopilot/quickstart.md · ${plansLabel}/README.md`,
  ];
}
