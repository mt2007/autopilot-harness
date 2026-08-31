import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAutopilotRuntimeGitignore,
  applyPlansGitignore,
  answersToInstallOptions,
  assertParentDirInProject,
  assertWrittenInsideProject,
  assertRegularFileInsideProject,
  autopilotShellAliasLine,
  appendShellAlias,
  formatCheatSheet,
  formatHostDisplayName,
  formatHostActivationTips,
  formatPostInstallOutro,
  formatPostInstallFooter,
  normalizePlansDir,
  probeProject,
  resolveCliCommand,
  shellSingleQuote,
  isTrustedCliEntrypoint,
  writeQuickstart,
} from "../src/init/wizard-helpers.js";
import { installInitYes } from "../src/init/install.js";
import * as readUntrusted from "../src/read-untrusted-file.js";
import {
  collectWizardAnswers,
  runInteractiveInit,
  type InitPrompts,
} from "../src/init/tui.js";
import type { InitWizardAnswers } from "../src/init/wizard-helpers.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-tui-"));
}

function scriptedPrompts(script: {
  confirms?: boolean[];
  selects?: unknown[];
  texts?: string[];
}): InitPrompts {
  const confirms = [...(script.confirms ?? [])];
  const selects = [...(script.selects ?? [])];
  const texts = [...(script.texts ?? [])];
  return {
    intro: () => {},
    outro: () => {},
    note: () => {},
    log: { info: () => {}, warn: () => {}, step: () => {} },
    isCancel: (v): v is symbol => typeof v === "symbol",
    spinner: () => ({ start: () => {}, stop: () => {} }),
    confirm: async () => {
      if (confirms.length === 0) throw new Error("unexpected confirm");
      return confirms.shift()!;
    },
    select: async <T>() => {
      if (selects.length === 0) throw new Error("unexpected select");
      return selects.shift() as T;
    },
    text: async () => {
      if (texts.length === 0) throw new Error("unexpected text");
      return texts.shift()!;
    },
  };
}

describe("wizard helpers", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("probeProject reports missing .autopilot", () => {
    root = tmpProject();
    const probe = probeProject(root);
    expect(probe.alreadyInitialized).toBe(false);
    expect(probe.projectRoot).toBe(path.resolve(root));
  });

  it("probeProject keeps hasGit when branch command fails", () => {
    root = tmpProject();
    execSync("git init", { cwd: root, stdio: "ignore" });
    const probe = probeProject(root);
    expect(probe.hasGit).toBe(true);
    expect(probe.alreadyInitialized).toBe(false);
  });

  it("assertParentDirInProject accepts a real in-project directory", () => {
    root = tmpProject();
    const dir = path.join(root, "nested");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "a.txt");
    expect(() => assertParentDirInProject(root, file, "nested/")).not.toThrow();
  });

  it("probeProject rejects empty projectRoot without probing cwd", () => {
    const probe = probeProject("  ");
    expect(probe.projectRoot).toBe("");
    expect(probe.hasGit).toBe(false);
    expect(probe.alreadyInitialized).toBe(false);
  });

  it("assertParentDirInProject refuses symlink parent (incl. escape)", () => {
    root = tmpProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ah-parent-esc-"));
    try {
      const link = path.join(root, "nested");
      fs.symlinkSync(outside, link);
      const file = path.join(link, "a.txt");
      expect(() => assertParentDirInProject(root, file, "nested/")).toThrow(
        /symlink|escapes/i,
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("assertParentDirInProject refuses missing parent", () => {
    root = tmpProject();
    const file = path.join(root, "missing-dir", "a.txt");
    expect(() => assertParentDirInProject(root, file, "missing-dir/")).toThrow(
      /missing/i,
    );
  });

  it("assertParentDirInProject refuses parent that is a regular file", () => {
    root = tmpProject();
    const parent = path.join(root, "nested");
    fs.writeFileSync(parent, "not-a-dir\n", "utf8");
    const file = path.join(parent, "a.txt");
    expect(() => assertParentDirInProject(root, file, "nested/")).toThrow(
      /not a directory/i,
    );
  });

  it("assertWrittenInsideProject accepts in-project file and unlinks escape", () => {
    root = tmpProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ah-written-esc-"));
    try {
      const okFile = path.join(root, "ok.txt");
      fs.writeFileSync(okFile, "in\n", "utf8");
      expect(() =>
        assertWrittenInsideProject(root, okFile, "ok.txt"),
      ).not.toThrow();

      const linkDir = path.join(root, "linkdir");
      fs.symlinkSync(outside, linkDir);
      const escaped = path.join(linkDir, "leaked.txt");
      fs.writeFileSync(escaped, "out\n", "utf8");
      expect(fs.existsSync(path.join(outside, "leaked.txt"))).toBe(true);
      expect(() =>
        assertWrittenInsideProject(root, escaped, "leaked.txt"),
      ).toThrow(/escapes/i);
      expect(fs.existsSync(path.join(outside, "leaked.txt"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("assertWrittenInsideProject refuses symlink at path and removes it", () => {
    root = tmpProject();
    const target = path.join(root, "target.txt");
    const link = path.join(root, "link.txt");
    fs.writeFileSync(target, "t\n", "utf8");
    fs.symlinkSync(target, link);
    expect(() =>
      assertWrittenInsideProject(root, link, "link.txt"),
    ).toThrow(/symlink/i);
    expect(fs.existsSync(link)).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("t\n");
  });

  it("assertRegularFileInsideProject refuses in-project symlink without unlinking", () => {
    root = tmpProject();
    const target = path.join(root, "target.txt");
    const link = path.join(root, "link.txt");
    fs.writeFileSync(target, "t\n", "utf8");
    fs.symlinkSync(target, link);
    expect(() =>
      assertRegularFileInsideProject(root, link, "link.txt"),
    ).toThrow(/symlink/i);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it("applyPlansGitignore dedupes and supports custom dir", () => {
    root = tmpProject();
    expect(applyPlansGitignore(root, "docs/plans")).toBe(".gitignore");
    const body = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(body).toMatch(/docs\/plans\//);
    expect(applyPlansGitignore(root, "docs/plans")).toBeNull();
  });

  it("applyPlansGitignore and writeQuickstart refuse empty projectRoot", () => {
    expect(() => applyPlansGitignore("  ", "plans")).toThrow(
      /projectRoot must be a non-empty string/,
    );
    expect(() => writeQuickstart("", "en")).toThrow(
      /projectRoot must be a non-empty string/,
    );
  });

  it("applyAutopilotRuntimeGitignore writes runtime paths once", () => {
    root = tmpProject();
    expect(applyAutopilotRuntimeGitignore(root)).toBe(".gitignore");
    const body = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(body).toMatch(/\.autopilot\/state\.db/);
    expect(body).toMatch(/\.autopilot\/state\.db\.bak\*/);
    expect(body).toMatch(/\.autopilot\/worktrees\//);
    expect(applyAutopilotRuntimeGitignore(root)).toBeNull();
  });

  it("applyAutopilotRuntimeGitignore appends missing bak without duplicate header", () => {
    root = tmpProject();
    fs.writeFileSync(
      path.join(root, ".gitignore"),
      `# Autopilot runtime
.autopilot/state.db
.autopilot/state.db-*
.autopilot/worktrees/
.autopilot/verify-last.json
.autopilot/logs/

# other
dist/
`,
    );
    expect(applyAutopilotRuntimeGitignore(root)).toBe(".gitignore");
    const body = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(body).toMatch(/\.autopilot\/state\.db\.bak\*/);
    expect(body.match(/# Autopilot runtime/g)?.length).toBe(1);
    // Inserted inside the runtime section, not after unrelated trailing rules.
    expect(body.indexOf(".autopilot/state.db.bak*")).toBeLessThan(
      body.indexOf("# other"),
    );
  });

  it("writeQuickstart + formatCheatSheet locale", () => {
    root = tmpProject();
    const rel = writeQuickstart(root, "zh-CN");
    expect(rel).toBe(path.join("docs", "autopilot", "quickstart.md"));
    const qs = fs.readFileSync(path.join(root, rel!), "utf8");
    expect(qs).toMatch(/快速开始/);
    expect(qs).toMatch(/status/);
    expect(qs).toMatch(/在 Cursor 中/);
    expect(qs).toMatch(/Reload Window/);
    expect(formatCheatSheet("en", "autopilot-harness").join("\n")).toMatch(
      /Planning/,
    );
    expect(formatCheatSheet("en", "autopilot-harness").join("\n")).toMatch(
      /session list/,
    );
    expect(formatCheatSheet("en", "autopilot-harness").join("\n")).toMatch(
      /locale set zh-CN/,
    );
    expect(formatCheatSheet("en", "autopilot-harness").join("\n")).toMatch(
      /in Cursor/,
    );
    expect(formatCheatSheet("en", "autopilot-harness").join("\n")).toMatch(
      /After install/,
    );
    expect(formatCheatSheet("zh-CN", "autopilot-harness").join("\n")).toMatch(
      /locale set en/,
    );
    expect(formatCheatSheet("zh-CN", "autopilot-harness").join("\n")).toMatch(
      /生效提示/,
    );
  });

  it("host-aware post-install tips stay English and follow platform", () => {
    expect(formatHostDisplayName("cursor")).toBe("Cursor");
    expect(formatHostDisplayName("claude-code")).toBe("Claude Code");
    expect(formatPostInstallOutro("cursor")).toBe(
      "You're all set — try /autopilot-on in Cursor.",
    );
    expect(formatPostInstallOutro("claude-code")).toBe(
      "You're all set — try /autopilot-on in Claude Code.",
    );
    const cursorTips = formatHostActivationTips("cursor").join("\n");
    expect(cursorTips).toMatch(/Reload Window/);
    expect(cursorTips).toMatch(/Agent chat/);
    expect(formatHostActivationTips("claude-code").join("\n")).toMatch(
      /Claude Code/,
    );
    const footer = formatPostInstallFooter("cursor").join("\n");
    expect(footer).toMatch(/You're all set/);
    expect(footer).toMatch(/Reload Window/);
    expect(
      formatCheatSheet("en", "cmd", "plans", "claude-code").join("\n"),
    ).toMatch(/in Claude Code/);
    // Hostile platform ids must not leak C0 controls into terminal tips.
    expect(formatHostDisplayName("cur\nsor")).toBe("Cursor");
    expect(formatHostDisplayName("claude-\x00code")).toBe("Claude Code");
    expect(formatHostDisplayName("\n\t")).toBe("your agent host");
    const scrubbedTip = formatHostActivationTips("claude\n-code")[0]!;
    expect(scrubbedTip).toContain("Claude Code");
    expect(scrubbedTip).not.toMatch(/[\u0000-\u001f\u007f]/);
    const truncated = formatHostDisplayName(`cursor${"x".repeat(200)}`);
    expect(truncated.length).toBeLessThanOrEqual(64);
    expect(truncated.startsWith("Cursor")).toBe(true);
    expect(formatHostDisplayName("cursor!!!")).toBe("Cursor");
    expect(formatPostInstallOutro("cursor!!!")).toBe(
      "You're all set — try /autopilot-on in Cursor.",
    );
    // Hand-edited YAML may use different casing.
    expect(formatHostDisplayName("CURSOR")).toBe("Cursor");
    expect(formatHostDisplayName("Claude-Code")).toBe("Claude Code");
    expect(formatHostActivationTips("Cursor").join("\n")).toMatch(
      /Reload Window/,
    );
    // Junk prefixes must not truncate away a real host id.
    expect(formatHostDisplayName(`${"*".repeat(80)}cursor`)).toBe("Cursor");
    expect(formatHostActivationTips(`${"*".repeat(80)}CURSOR`).join("\n")).toMatch(
      /Reload Window/,
    );
  });

  it("resolveCliCommand and alias prefer running bin when available", () => {
    root = tmpProject();
    const prev = process.argv[1];
    const fakeBin = path.join(root, "packages", "cli", "dist", "bin.js");
    fs.mkdirSync(path.dirname(fakeBin), { recursive: true });
    fs.writeFileSync(fakeBin, "#!/usr/bin/env node\n", "utf8");
    process.argv[1] = fakeBin;
    try {
      const abs = fs.realpathSync(fakeBin);
      const cmd = resolveCliCommand();
      expect(cmd).toBe(`node ${shellSingleQuote(abs)}`);
      expect(autopilotShellAliasLine()).toBe(
        `autopilot() { command node ${shellSingleQuote(abs)} "$@"; }`,
      );
    } finally {
      process.argv[1] = prev;
    }
  });

  it("resolveCliCommand accepts npm-installed package dist/bin.js", () => {
    root = tmpProject();
    const prev = process.argv[1];
    const fakeBin = path.join(
      root,
      "node_modules",
      "autopilot-harness",
      "dist",
      "bin.js",
    );
    fs.mkdirSync(path.dirname(fakeBin), { recursive: true });
    fs.writeFileSync(fakeBin, "#!/usr/bin/env node\n", "utf8");
    process.argv[1] = fakeBin;
    try {
      const abs = fs.realpathSync(fakeBin);
      expect(resolveCliCommand()).toBe(`node ${shellSingleQuote(abs)}`);
    } finally {
      process.argv[1] = prev;
    }
  });

  it("isTrustedCliEntrypoint accepts Windows-style separators", () => {
    expect(
      isTrustedCliEntrypoint(
        "C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\autopilot-harness\\dist\\bin.js",
      ),
    ).toBe(true);
    expect(
      isTrustedCliEntrypoint(
        "C:\\Users\\dev\\workspaces\\autopilot-harness\\packages\\cli\\dist\\bin.js",
      ),
    ).toBe(true);
    expect(isTrustedCliEntrypoint("")).toBe(false);
    expect(
      isTrustedCliEntrypoint("C:\\tmp\\evil-autopilot-harness\\bin.js"),
    ).toBe(false);
  });

  it("resolveCliCommand ignores non-CLI argv[1] (e.g. test runners)", () => {
    root = tmpProject();
    const prev = process.argv[1];
    const decoy = path.join(root, "process.js");
    fs.writeFileSync(decoy, "#!/usr/bin/env node\n", "utf8");
    process.argv[1] = decoy;
    try {
      expect(resolveCliCommand()).toBe(`npx autopilot-harness`);
      expect(autopilotShellAliasLine()).toBe(
        `autopilot() { command npx autopilot-harness "$@"; }`,
      );
    } finally {
      process.argv[1] = prev;
    }
  });

  it("resolveCliCommand ignores unrelated bin.js outside the package", () => {
    root = tmpProject();
    const prev = process.argv[1];
    const decoy = path.join(root, "bin.js");
    fs.writeFileSync(decoy, "#!/usr/bin/env node\n", "utf8");
    process.argv[1] = decoy;
    try {
      expect(resolveCliCommand()).toBe(`npx autopilot-harness`);
    } finally {
      process.argv[1] = prev;
    }
  });

  it("autopilotShellAliasLine survives quotes, $, backticks, and spaces in path", () => {
    root = tmpProject();
    const prev = process.argv[1];
    const nastyDir = path.join(
      root,
      `dir " $(\`id\`) o'hara space`,
      "packages",
      "cli",
      "dist",
    );
    fs.mkdirSync(nastyDir, { recursive: true });
    const fakeBin = path.join(nastyDir, "bin.js");
    fs.writeFileSync(fakeBin, "#!/usr/bin/env node\n", "utf8");
    process.argv[1] = fakeBin;
    try {
      const abs = fs.realpathSync(fakeBin);
      const line = autopilotShellAliasLine();
      expect(line).toBe(
        `autopilot() { command node ${shellSingleQuote(abs)} "$@"; }`,
      );
      // Function form — not a single-quoted alias= that would truncate on '.
      expect(line.startsWith("autopilot() {")).toBe(true);
      expect(line).not.toMatch(/^alias autopilot=/);
      // Path is single-quoted for the shell; $( must not appear outside quotes
      // as a bare expansion (the quoted path may still contain those chars).
      const afterNode = line.slice(line.indexOf("node ") + 5);
      const pathTok = afterNode.slice(0, afterNode.lastIndexOf(' "$@"'));
      expect(pathTok.startsWith("'")).toBe(true);
      expect(pathTok.endsWith("'") || pathTok.includes(`'"'"'`)).toBe(true);
    } finally {
      process.argv[1] = prev;
    }
  });

  it("appendShellAlias dedupes function and legacy alias forms", () => {
    root = tmpProject();
    const prevHome = process.env.HOME;
    const prevArgv = process.argv[1];
    process.env.HOME = root;
    const fakeBin = path.join(root, "cli-bin.js");
    fs.writeFileSync(fakeBin, "#!/usr/bin/env node\n", "utf8");
    process.argv[1] = fakeBin;
    try {
      const first = appendShellAlias("zshrc");
      expect(first.added).toBe(true);
      expect(first.path).toBe(path.join(root, ".zshrc"));
      const body = fs.readFileSync(first.path, "utf8");
      expect(body).toMatch(/autopilot\s*\(\)/);
      expect(appendShellAlias("zshrc").added).toBe(false);

      fs.writeFileSync(
        path.join(root, ".bashrc"),
        "alias autopilot='npx old'\n",
        "utf8",
      );
      expect(appendShellAlias("bashrc").added).toBe(false);

      // Comment / prose mentioning alias must not block installing the shortcut.
      fs.writeFileSync(
        path.join(root, ".bashrc"),
        "# see docs: alias autopilot='npx old'\necho hi\n",
        "utf8",
      );
      expect(appendShellAlias("bashrc").added).toBe(true);
    } finally {
      process.env.HOME = prevHome;
      process.argv[1] = prevArgv;
    }
  });

  it("normalizePlansDir rejects traversal and injection", () => {
    expect(normalizePlansDir("../x").ok).toBe(false);
    expect(normalizePlansDir("/abs").ok).toBe(false);
    expect(normalizePlansDir("plans\nfoo: bar").ok).toBe(false);
    expect(normalizePlansDir("plans/../etc").ok).toBe(false);
    expect(normalizePlansDir("docs/plans").ok).toBe(true);
  });

  it("rejects malicious plansDir without writing", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
      plansDir: "../../tmp-evil",
    });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(path.join(root, ".autopilot"))).toBe(false);
  });

  it("writeQuickstart does not overwrite existing file", () => {
    root = tmpProject();
    const dest = path.join(root, "docs", "autopilot", "quickstart.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "# keep-me\n", "utf8");
    expect(writeQuickstart(root, "en", "plans")).toBeNull();
    expect(fs.readFileSync(dest, "utf8")).toBe("# keep-me\n");
  });

  it("force refresh does not create a second plans tree", () => {
    root = tmpProject();
    const first = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
      plansDir: "docs/plans",
    });
    expect(first.ok).toBe(true);
    const second = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: true,
      plansDir: "other-plans",
      plansGit: "local-only",
    });
    expect(second.ok).toBe(true);
    expect(fs.existsSync(path.join(root, "other-plans"))).toBe(false);
    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(config).toMatch(/plans_dir:\s*docs\/plans/);
    const gi = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(gi).not.toMatch(/other-plans/);
  });

  it("refuses when .gitignore is a directory", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".gitignore"), { recursive: true });
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not a regular file/i);
    }
    // Must not leave config.yml that blocks retry without --force
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });

  it("rolls back config.yml if hooks become unreadable mid-init", () => {
    root = tmpProject();
    const hooksDir = path.join(root, ".cursor");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hooksPath = path.join(hooksDir, "hooks.json");
    fs.writeFileSync(
      hooksPath,
      JSON.stringify({ version: 1, hooks: {} }),
      "utf8",
    );

    // preflight + hooksPre succeed; hooksFresh (3rd) returns corrupt JSON.
    const orig = readUntrusted.readUntrustedUtf8File;
    let hooksReads = 0;
    const spy = vi
      .spyOn(readUntrusted, "readUntrustedUtf8File")
      .mockImplementation((filePath, maxBytes, label) => {
        if (path.resolve(String(filePath)) === path.resolve(hooksPath)) {
          hooksReads += 1;
          if (hooksReads >= 3) return "{not-json";
        }
        return orig(filePath, maxBytes, label);
      });
    try {
      const result = installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      });
      expect(result.ok).toBe(false);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
      // Proves we got past config write before failing (orphan pin is OK).
      expect(fs.existsSync(path.join(root, ".autopilot", "pin.json"))).toBe(
        true,
      );
      expect(hooksReads).toBeGreaterThanOrEqual(3);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses writing through a .gitignore symlink", () => {
    root = tmpProject();
    const outside = path.join(root, "outside-gi");
    fs.writeFileSync(outside, "keep\n", "utf8");
    fs.symlinkSync(outside, path.join(root, ".gitignore"));
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/symlink/i);
    }
    expect(fs.readFileSync(outside, "utf8")).toBe("keep\n");
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });

  it("refuses writing through a dangling .gitignore symlink", () => {
    root = tmpProject();
    const outside = path.join(root, "outside-gi-missing");
    fs.symlinkSync(outside, path.join(root, ".gitignore"));
    expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(false);
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/symlink/i);
    expect(fs.existsSync(outside)).toBe(false);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });

  it("refuses writing through a dangling quickstart.md symlink", () => {
    root = tmpProject();
    const qsDir = path.join(root, "docs", "autopilot");
    fs.mkdirSync(qsDir, { recursive: true });
    const outside = path.join(root, "outside-qs.md");
    fs.symlinkSync(outside, path.join(qsDir, "quickstart.md"));
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/symlink/i);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it("refuses writing through a dangling plans README symlink", () => {
    root = tmpProject();
    const plansDir = path.join(root, "plans");
    fs.mkdirSync(plansDir, { recursive: true });
    const outside = path.join(root, "outside-plans-readme.md");
    fs.symlinkSync(outside, path.join(plansDir, "README.md"));
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/symlink/i);
    expect(fs.existsSync(outside)).toBe(false);
  });

  it("assertNotSymlink refuses dangling symlinks", async () => {
    root = tmpProject();
    const { assertNotSymlink } = await import("../src/init/wizard-helpers.js");
    const link = path.join(root, "dang");
    fs.symlinkSync(path.join(root, "missing-target"), link);
    expect(() => assertNotSymlink(link, "dang")).toThrow(/symlink/i);
  });

  it("refuses when .autopilot is a symlink", () => {
    root = tmpProject();
    const outside = path.join(root, "outside-ap");
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".autopilot"));
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/symlink/i);
    }
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("refuses when docs/ is a symlink (workflows path)", () => {
    root = tmpProject();
    const outside = path.join(root, "outside-docs");
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(root, "docs"));
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/symlink/i);
    }
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("install with local-only plans + custom dir + verify", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
      plansDir: "docs/plans",
      plansGit: "local-only",
      verifyEnabled: true,
    });
    expect(result.ok).toBe(true);
    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(config).toMatch(/plans_dir:\s*docs\/plans/);
    expect(config).toMatch(/enabled:\s*true/);
    const gi = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(gi).toMatch(/docs\/plans\//);
    expect(gi).toMatch(/\.autopilot\/state\.db/);
    expect(
      fs.existsSync(path.join(root, "docs", "plans", "README.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, "docs", "autopilot", "quickstart.md")),
    ).toBe(true);
  });
});

describe("interactive init (scripted prompts)", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("runInteractiveInit refuses non-TTY without injected prompts", async () => {
    root = tmpProject();
    const prev = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    try {
      const code = await runInteractiveInit({ projectRoot: root });
      expect(code).toBe(1);
      expect(fs.existsSync(path.join(root, ".autopilot"))).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: prev,
        configurable: true,
      });
    }
  });

  it("collectWizardAnswers force path skips plans prompts", async () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "platform: cursor\nlocale: zh-CN\n",
    );
    const answers = await collectWizardAnswers({
      projectRoot: root,
      force: true,
      prompts: scriptedPrompts({
        confirms: [true, true], // install here, ready to refresh
        selects: ["skip"], // shell alias only
      }),
    });
    expect(answers).not.toBeNull();
    expect(answers!.force).toBe(true);
    expect(answers!.plansDir).toBe("plans");
    expect(answers!.locale).toBe("zh-CN");
  });

  it("collectWizardAnswers happy path", async () => {
    root = tmpProject();
    const answers = await collectWizardAnswers({
      projectRoot: root,
      prompts: scriptedPrompts({
        confirms: [true, true], // install here, ready
        selects: [
          "en",
          "cursor",
          "ide",
          "plans",
          "commit",
          "executing_only",
          "skip",
          "unlimited",
          "skip",
        ],
      }),
    });
    expect(answers).not.toBeNull();
    expect(answers!.locale).toBe("en");
    expect(answers!.plansDir).toBe("plans");
    expect(answers!.plansGit).toBe("commit");
    expect(answers!.verifyEnabled).toBe(false);
    expect(answers!.maxErrorsBeforePause).toBe(0);
    expect(answers!.shellAlias).toBe("skip");
  });

  it("collectWizardAnswers cancel on install-here No", async () => {
    root = tmpProject();
    const answers = await collectWizardAnswers({
      projectRoot: root,
      prompts: scriptedPrompts({ confirms: [false] }),
    });
    expect(answers).toBeNull();
  });

  it("collectWizardAnswers custom plans dir", async () => {
    root = tmpProject();
    const answers = await collectWizardAnswers({
      projectRoot: root,
      prompts: scriptedPrompts({
        confirms: [true, true],
        selects: [
          "zh-CN",
          "cursor",
          "ide",
          "custom",
          "local-only",
          "executing_only",
          "enable",
          "5",
          "skip",
        ],
        texts: ["docs/plans"],
      }),
    });
    expect(answers).not.toBeNull();
    expect(answers!.locale).toBe("zh-CN");
    expect(answers!.plansDir).toBe("docs/plans");
    expect(answers!.plansGit).toBe("local-only");
    expect(answers!.verifyEnabled).toBe(true);
    expect(answers!.maxErrorsBeforePause).toBe(5);
  });

  it("collectWizardAnswers custom error pause threshold", async () => {
    root = tmpProject();
    const answers = await collectWizardAnswers({
      projectRoot: root,
      prompts: scriptedPrompts({
        confirms: [true, true],
        selects: [
          "en",
          "cursor",
          "ide",
          "plans",
          "commit",
          "executing_only",
          "skip",
          "custom",
          "skip",
        ],
        texts: ["12"],
      }),
    });
    expect(answers).not.toBeNull();
    expect(answers!.maxErrorsBeforePause).toBe(12);
  });

  it("runInteractiveInit installs via answers", async () => {
    root = tmpProject();
    const code = await runInteractiveInit({
      projectRoot: root,
      prompts: scriptedPrompts({
        confirms: [true, true],
        selects: [
          "en",
          "cursor",
          "ide",
          "plans",
          "commit",
          "executing_only",
          "skip",
          "unlimited",
          "skip",
        ],
      }),
    });
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      true,
    );
    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(config).toMatch(/max_before_pause:\s*0/);
    expect(
      fs.existsSync(path.join(root, "docs", "autopilot", "quickstart.md")),
    ).toBe(true);
  });

  it("answersToInstallOptions maps fields", () => {
    const answers: InitWizardAnswers = {
      projectRoot: "/tmp/x",
      locale: "en",
      platform: "cursor",
      surface: "ide",
      plansDir: "plans",
      plansGit: "leave",
      verifyEnabled: false,
      reviewScope: "executing_only",
      maxErrorsBeforePause: 0,
      shellAlias: "skip",
      force: false,
      packageVersion: "0.1.0",
    };
    expect(answersToInstallOptions(answers)).toMatchObject({
      plansGit: "leave",
      reviewScope: "executing_only",
      maxErrorsBeforePause: 0,
      writeQuickstart: true,
    });
  });
});
