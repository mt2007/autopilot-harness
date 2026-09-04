import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { CLI_NAME } from "../names.js";
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
  /** executing_only = after RUN; project = any product-code edit. */
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
// sanitizePlatformId lives in ./platforms.js (shared with config parsing).

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
export function formatPostInstallOutro(
  platformOrPlatforms: string | readonly string[],
): string {
  const ids = (
    typeof platformOrPlatforms === "string"
      ? [platformOrPlatforms]
      : [...platformOrPlatforms]
  )
    .map(sanitizePlatformId)
    .filter(Boolean);
  if (ids.length === 0) {
    return "You're all set — try /autopilot-on in your agent host.";
  }
  if (ids.length === 1) {
    return `You're all set — try /autopilot-on in ${formatHostDisplayName(ids[0]!)}.`;
  }
  const names = ids.map((id) => formatHostDisplayName(id)).join(", ");
  return `You're all set — try /autopilot-on in ${names}.`;
}

/**
 * Host-specific activation tips after hooks/skills install.
 * Always English (init UX language). Install what you chose → tip for that host.
 */
export function formatHostActivationTips(
  platformOrPlatforms: string | readonly string[],
): string[] {
  const ids = (
    typeof platformOrPlatforms === "string"
      ? [platformOrPlatforms]
      : [...platformOrPlatforms]
  )
    .map(sanitizePlatformId)
    .filter(Boolean);
  const tips: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const host = formatHostDisplayName(id);
    if (id === "cursor") {
      tips.push(
        `If /autopilot-* skills or Autopilot hooks do not appear in ${host}: run Developer: Reload Window, or start a new Agent chat.`,
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
  const ids = (
    typeof platformOrPlatforms === "string"
      ? [platformOrPlatforms]
      : [...platformOrPlatforms]
  )
    .map(sanitizePlatformId)
    .filter(Boolean);
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const id of ids.length > 0 ? ids : ["cursor"]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const host = formatHostDisplayName(id);
    if (locale === "zh-CN") {
      if (id === "cursor") {
        lines.push(
          `在 ${host} 中试用 /autopilot-on。`,
          `若 skills / hooks 未出现：执行 Developer: Reload Window，或新开一条 Agent 对话。`,
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
  const host = formatHostDisplayName(platform);
  const afterInstall = hostActivationDocLines(locale, platform);
  const body =
    locale === "zh-CN"
      ? `# Autopilot 快速开始

命令速查 + 每步产物。

## 推荐流程（产物）

| 步骤 | 你做什么 | Autopilot 做什么 | 产物 |
|------|----------|------------------|------|
| **1. 规划** | \`/autopilot-on\`（可带需求描述）；逐轮回答 grill | 写 \`${plansLabel}/<slug>/\`（可改文档），**不写产品代码** | \`brief.md\`、\`plan.md\`、\`checklist.md\` |
| **2. 执行** | \`/autopilot-run\`（或带 \`<slug>\`） | 一项一项：实现 → 自审修复 → 多角度确认 → 勾选推进 | 该项代码/文档；推进/完成时 dirty 则本地 commit（干净则跳过；确认轮不 commit；默认不自动 push） |
| **3. 完成** | — | 勾选最后一项；dirty 则本地 commit（干净则跳过；默认不自动 push）；checklist 清空后停止 | 该轨结束 |

## Planning

推荐：在 ${host} 中使用 \`/autopilot-on\` 或 \`/autopilot-on <需求描述>\`

也可：行首 \`Autopilot ON\` / \`开启自动驾驶\`

## Executing

\`/autopilot-run\` 或 \`/autopilot-run <slug>\`

也可：\`Autopilot RUN\` / \`开始执行\`

## 暂停 / 恢复 / 改方案

- 暂停：\`/autopilot-off\` 或行首 \`Autopilot OFF\` / \`关闭自动驾驶\` — 本会话 paused；不推进 checklist，也不跑自审，直到 resume（phase 通常不变；\`done\` → \`idle\`）。
- 恢复：\`/autopilot-resume\` 或 \`/autopilot-resume <slug>\`（新聊天可认领旧轨）；也可行首 \`Autopilot RESUME\` / \`继续执行\` — 清 pause，**保留**自审链进度；多轨执行中时用 \`<slug>\` 指定。认领后以**本聊天**为执行会话；勿在旧聊天继续跑同一轨。认领优先未 pause 的执行会话，也可回退到唯一一条**已 pause** 的执行轨（旧聊天已死时恢复）。
- 改方案：\`/autopilot-replan\` 或行首 \`Autopilot REPLAN\` / \`修改方案\` — 回到 planning，**重置**自审链；只改 \`plan.md\` 与未勾选项，勿静默删已完成 \`[x]\`；改完再 \`/autopilot-run\`。

## 终端

CLI 尚未发布到 npm 时，用已构建的二进制（把路径换成你的 harness 克隆；\`cwd\` = 目标项目）：

\`\`\`bash
node /path/to/autopilot-harness/packages/cli/dist/bin.js status
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor
node /path/to/autopilot-harness/packages/cli/dist/bin.js upgrade --dry-run
\`\`\`

## 安装后

${afterInstall.map((l) => `- ${l}`).join("\n")}

## 自审范围（\`review.scope\`）

写在 \`.autopilot/config.yml\`：

| 取值 | 含义 |
|------|------|
| **\`executing_only\`**（默认） | 仅在 \`/autopilot-run\`（checklist 执行中）且改了产品代码后，才走修复 → 多角度确认 |
| **\`project\`** | **任意**产品代码编辑都会自审——**不需要**先 ON / RUN |

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
| **1. Plan** | \`/autopilot-on\` (optional description); reply to each grill round | Writes \`${plansLabel}/<slug>/\` (may edit docs); **no product code** | \`brief.md\`, \`plan.md\`, \`checklist.md\` |
| **2. Run** | \`/autopilot-run\` (or with \`<slug>\`) | One item at a time: implement → fix → multi-lens confirm → advance | Code/docs for that item; on advance/done, local commit if dirty (skip if clean; confirm rounds do not commit; no auto-push) |
| **3. Done** | — | Marks the last item; local commit if dirty (skip if clean; no auto-push); stops when the checklist is clear | Track complete |

## Planning

Preferred: in ${host}, \`/autopilot-on\` or \`/autopilot-on <what to build>\`

Also: line-start \`Autopilot ON\`

## Executing

\`/autopilot-run\` or \`/autopilot-run <slug>\`

Also: \`Autopilot RUN\`

## Pause / resume / replan

- Pause: \`/autopilot-off\` or line-start \`Autopilot OFF\` — pauses this conversation; no checklist advance and no self-review until resume (phase usually unchanged; \`done\` → \`idle\`).
- Resume: \`/autopilot-resume\` or \`/autopilot-resume <slug>\` (new chat can claim a track); also line-start \`Autopilot RESUME\` — clears pause, **keeps** the review chain; use \`<slug>\` when several tracks are executing. After a claim, **this** chat owns the session; do not keep executing the same track in the old chat. Claim prefers an unpaused executing worker, and can fall back to a single **paused** executing session (dead-chat recovery).
- Replan: \`/autopilot-replan\` or line-start \`Autopilot REPLAN\` — returns to planning and **resets** the review chain; revise \`plan.md\` and unchecked items only (do not silently delete completed \`[x]\`); then \`/autopilot-run\` when ready.

## Terminal

CLI is not on public npm yet. Use the built binary (replace the path with your harness clone; \`cwd\` = the app):

\`\`\`bash
node /path/to/autopilot-harness/packages/cli/dist/bin.js status
node /path/to/autopilot-harness/packages/cli/dist/bin.js doctor
node /path/to/autopilot-harness/packages/cli/dist/bin.js upgrade --dry-run
\`\`\`

## After install

${afterInstall.map((l) => `- ${l}`).join("\n")}

## Self-review scope (\`review.scope\`)

In \`.autopilot/config.yml\`:

| Value | Meaning |
|-------|---------|
| **\`executing_only\`** (default) | Fix → confirm only after \`/autopilot-run\` (checklist executing) + product-code edits |
| **\`project\`** | Fix → confirm on **any** product-code edit — **no** ON/RUN required |

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
  const ids = (
    typeof platformOrPlatforms === "string"
      ? [platformOrPlatforms]
      : [...platformOrPlatforms]
  )
    .map(sanitizePlatformId)
    .filter(Boolean);
  const host =
    ids.length <= 1
      ? formatHostDisplayName(ids[0] ?? "cursor")
      : ids.map((id) => formatHostDisplayName(id)).join(" / ");
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
      ...hostActivationPlainLines(locale, ids).map((l) => `  ${l}`),
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
    ...hostActivationPlainLines(locale, ids).map((l) => `  ${l}`),
    "",
    `  See: docs/autopilot/quickstart.md · ${plansLabel}/README.md`,
  ];
}
