import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { InitLocale, InitYesOptions, PlansGitPolicy } from "./types.js";

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

/** Refuse writing through a symlink (stat follows links; lstat does not). */
export function assertNotSymlink(filePath: string, label: string): void {
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`${label} is a symlink; refusing to modify`);
  }
}

/** After mkdir/resolve, ensure realpath stays under project root. */
export function assertRealpathInside(
  projectRoot: string,
  targetPath: string,
  label: string,
): void {
  const realRoot = fs.realpathSync(path.resolve(projectRoot));
  const realTarget = fs.realpathSync(path.resolve(targetPath));
  if (
    realTarget !== realRoot &&
    !realTarget.startsWith(realRoot + path.sep)
  ) {
    throw new Error(`${label} realpath escapes the project root`);
  }
}

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
  const root = path.resolve(projectRoot);
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
  return {
    projectRoot: root,
    hasGit,
    branch,
    alreadyInitialized: fs.existsSync(
      path.join(root, ".autopilot", "config.yml"),
    ),
  };
}

function appendGitignoreLines(
  projectRoot: string,
  comment: string,
  lines: string[],
): string | null {
  const gi = path.join(projectRoot, ".gitignore");
  if (fs.existsSync(gi)) {
    const st = fs.lstatSync(gi);
    if (st.isSymbolicLink()) {
      throw new Error(".gitignore is a symlink; refusing to modify");
    }
    if (!st.isFile()) {
      throw new Error(".gitignore exists and is not a regular file");
    }
  }
  let body = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
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
  fs.writeFileSync(gi, body, "utf8");
  return path.relative(projectRoot, gi);
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
  if (fs.existsSync(file)) {
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink()) {
      throw new Error(`${file} is a symlink; refusing to modify`);
    }
    if (!st.isFile()) {
      throw new Error(`${file} exists and is not a regular file`);
    }
  }
  let body = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (body.includes("alias autopilot=")) {
    return { path: file, added: false };
  }
  if (body.length > 0 && !body.endsWith("\n")) body += "\n";
  body += `\n# Autopilot Harness\n${ALIAS_LINE}\n`;
  fs.writeFileSync(file, body, "utf8");
  return { path: file, added: true };
}

export function writeQuickstart(
  projectRoot: string,
  locale: InitLocale,
  plansDir = "plans",
): string | null {
  const normalized = normalizePlansDir(plansDir);
  const plansLabel = normalized.ok ? normalized.value : "plans";
  const docsDir = path.join(projectRoot, "docs");
  const destDir = path.join(docsDir, "autopilot");
  assertNotSymlink(docsDir, "docs/");
  assertNotSymlink(destDir, "docs/autopilot/");
  fs.mkdirSync(destDir, { recursive: true });
  assertRealpathInside(projectRoot, destDir, "docs/autopilot/");
  const dest = path.join(destDir, "quickstart.md");
  if (fs.existsSync(dest)) {
    assertNotSymlink(dest, "docs/autopilot/quickstart.md");
    return null;
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
  fs.writeFileSync(dest, body, "utf8");
  return path.relative(projectRoot, dest);
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
    `  ${cliName} locale set zh-CN`,
    "",
    `  See: docs/autopilot/quickstart.md · ${plansLabel}/README.md`,
  ];
}
