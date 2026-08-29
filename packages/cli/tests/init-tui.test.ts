import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyAutopilotRuntimeGitignore,
  applyPlansGitignore,
  answersToInstallOptions,
  formatCheatSheet,
  normalizePlansDir,
  probeProject,
  writeQuickstart,
} from "../src/init/wizard-helpers.js";
import { installInitYes } from "../src/init/install.js";
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

  it("applyPlansGitignore dedupes and supports custom dir", () => {
    root = tmpProject();
    expect(applyPlansGitignore(root, "docs/plans")).toBe(".gitignore");
    const body = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(body).toMatch(/docs\/plans\//);
    expect(applyPlansGitignore(root, "docs/plans")).toBeNull();
  });

  it("applyAutopilotRuntimeGitignore writes runtime paths once", () => {
    root = tmpProject();
    expect(applyAutopilotRuntimeGitignore(root)).toBe(".gitignore");
    const body = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(body).toMatch(/\.autopilot\/state\.db/);
    expect(body).toMatch(/\.autopilot\/worktrees\//);
    expect(applyAutopilotRuntimeGitignore(root)).toBeNull();
  });

  it("writeQuickstart + formatCheatSheet locale", () => {
    root = tmpProject();
    const rel = writeQuickstart(root, "zh-CN");
    expect(rel).toBe(path.join("docs", "autopilot", "quickstart.md"));
    expect(
      fs.readFileSync(path.join(root, rel!), "utf8"),
    ).toMatch(/快速开始/);
    expect(formatCheatSheet("en", "autopilot-harness").join("\n")).toMatch(
      /Planning/,
    );
    expect(formatCheatSheet("en", "autopilot-harness").join("\n")).toMatch(
      /locale set zh-CN/,
    );
    expect(formatCheatSheet("zh-CN", "autopilot-harness").join("\n")).toMatch(
      /locale set en/,
    );
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

    const realRead = fs.readFileSync;
    let reads = 0;
    const spy = ((...args: Parameters<typeof fs.readFileSync>) => {
      const target = String(args[0]);
      if (target === hooksPath) {
        reads += 1;
        // preflight + hooksPre succeed; hooksFresh (3rd) returns corrupt JSON.
        if (reads >= 3) {
          return "{not-json";
        }
      }
      return realRead(...args);
    }) as typeof fs.readFileSync;
    fs.readFileSync = spy;
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
      expect(reads).toBeGreaterThanOrEqual(3);
    } finally {
      fs.readFileSync = realRead;
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
      "platform: cursor\n",
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
          "skip",
          "defaults",
          "skip",
        ],
      }),
    });
    expect(answers).not.toBeNull();
    expect(answers!.locale).toBe("en");
    expect(answers!.plansDir).toBe("plans");
    expect(answers!.plansGit).toBe("commit");
    expect(answers!.verifyEnabled).toBe(false);
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
          "enable",
          "defaults",
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
          "skip",
          "defaults",
          "skip",
        ],
      }),
    });
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      true,
    );
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
      shellAlias: "skip",
      force: false,
      packageVersion: "0.1.0",
    };
    expect(answersToInstallOptions(answers)).toMatchObject({
      plansGit: "leave",
      writeQuickstart: true,
    });
  });
});
