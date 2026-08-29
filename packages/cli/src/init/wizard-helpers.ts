import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
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
    writeQuickstart: true,
  };
}

const ALIAS_LINE = "alias autopilot='npx autopilot-harness'";

/** Append shell alias with dedupe. Returns path + whether a line was added. */
export function appendShellAlias(
  target: Exclude<ShellAliasTarget, "skip">,
): { path: string; added: boolean } {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    throw new Error("HOME is not set; cannot write shell alias");
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
  if (body.includes("alias autopilot=")) {
    return { path: file, added: false };
  }
  if (body.length > 0 && !body.endsWith("\n")) body += "\n";
  body += `\n# Autopilot Harness\n${ALIAS_LINE}\n`;
  assertNotSymlink(file, path.basename(file));
  writeTextFileReplace(file, body);
  return { path: file, added: true };
}

export function writeQuickstart(
  projectRoot: string,
  locale: InitLocale,
  plansDir = "plans",
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
  const body =
    locale === "zh-CN"
      ? `# Autopilot 快速开始

## Planning

推荐：\`/autopilot-on\` 或 \`/autopilot-on <需求描述>\`

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
npx autopilot-harness status
npx autopilot-harness doctor
npx autopilot-harness upgrade --dry-run
\`\`\`

方案与清单在 \`${plansLabel}/<slug>/\`。
`
      : `# Autopilot quickstart

## Planning

Preferred: \`/autopilot-on\` or \`/autopilot-on <what to build>\`

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
npx autopilot-harness status
npx autopilot-harness doctor
npx autopilot-harness upgrade --dry-run
\`\`\`

Artifacts live under \`${plansLabel}/<slug>/\`.
`;
  assertNotSymlink(dest, "docs/autopilot/quickstart.md");
  writeTextFileReplace(dest, body, root);
  return path.relative(root, dest);
}

export function formatCheatSheet(
  locale: InitLocale,
  cliName: string,
  plansDir = "plans",
): string[] {
  const normalized = normalizePlansDir(plansDir);
  const plansLabel = normalized.ok ? normalized.value : "plans";
  if (locale === "zh-CN") {
    return [
      "── 新开任务（Planning）──────────────────",
      "  推荐：/autopilot-on",
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
      `  ${cliName} status`,
      `  ${cliName} doctor`,
      `  ${cliName} session list`,
      `  ${cliName} locale set en`,
      "",
      `  详细：docs/autopilot/quickstart.md · ${plansLabel}/README.md`,
    ];
  }
  return [
    "── Planning ─────────────────────────────",
    "  Preferred: /autopilot-on",
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
    `  ${cliName} status`,
    `  ${cliName} doctor`,
    `  ${cliName} session list`,
    `  ${cliName} locale set zh-CN`,
    "",
    `  See: docs/autopilot/quickstart.md · ${plansLabel}/README.md`,
  ];
}
