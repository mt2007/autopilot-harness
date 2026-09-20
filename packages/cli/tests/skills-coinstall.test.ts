import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { skillDescriptions } from "@autopilot-harness/i18n";
import {
  applyFactorySkillFrontmatter,
  AUTOPILOT_SKILL_NAMES,
  installInitYes,
} from "../src/init/install.js";
import { uninstallProject } from "../src/uninstall.js";
import { upgradeProject } from "../src/upgrade.js";

const SKILL_NAMES = [...AUTOPILOT_SKILL_NAMES];

function hasSkill(root: string, hostParent: string, name: string): boolean {
  return fs.existsSync(path.join(root, hostParent, "skills", name, "SKILL.md"));
}

function expectAllSkills(root: string, hostParent: string): void {
  for (const name of SKILL_NAMES) {
    expect(hasSkill(root, hostParent, name)).toBe(true);
  }
}

function expectNoSkills(root: string, hostParent: string): void {
  expect(fs.existsSync(path.join(root, hostParent, "skills"))).toBe(false);
}

describe("skills co-install (Gemini / Factory / Hermes)", () => {
  let root = "";
  let hermesHome = "";
  let prevHermes: string | undefined;

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
    if (hermesHome && fs.existsSync(hermesHome)) {
      fs.rmSync(hermesHome, { recursive: true, force: true });
    }
    hermesHome = "";
    if (prevHermes === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = prevHermes;
    prevHermes = undefined;
  });

  function withHermesHome(): string {
    prevHermes = process.env.HERMES_HOME;
    hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-hermes-"));
    process.env.HERMES_HOME = hermesHome;
    return hermesHome;
  }

  it("applyFactorySkillFrontmatter inserts disable-model-invocation once", () => {
    const body = `---
name: autopilot-on
description: "hi"
---

body
`;
    const once = applyFactorySkillFrontmatter(body);
    expect(once).toMatch(/^disable-model-invocation:\s*true$/m);
    expect(applyFactorySkillFrontmatter(once)).toBe(once);
    const forced = applyFactorySkillFrontmatter(`---
name: autopilot-on
description: "hi"
disable-model-invocation: false
---

body
`);
    expect(forced).toMatch(/^disable-model-invocation:\s*true$/m);
    expect(forced).not.toMatch(/disable-model-invocation:\s*false/);
    expect(() => applyFactorySkillFrontmatter("# no frontmatter\n")).toThrow(
      /closed YAML frontmatter/,
    );
  });

  it("Gemini + Antigravity both write their own skills dirs (Gemini not skipped)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-dual-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);

    for (const name of SKILL_NAMES) {
      expect(
        fs.existsSync(path.join(root, ".gemini", "skills", name, "SKILL.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(root, ".agents", "skills", name, "SKILL.md")),
      ).toBe(true);
    }
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.gemini\/skills\/\*\*/);
    expect(ignore).toMatch(/\.agents\/skills\/\*\*/);
  });

  it("init writes skills only for enabled hosts (Cursor/Antigravity/Gemini/Factory/Hermes)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-who-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expectAllSkills(root, ".cursor");
    expectNoSkills(root, ".gemini");
    expectNoSkills(root, ".factory");
    expectNoSkills(root, ".agents");
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
    const cursorIgnore = fs.readFileSync(
      path.join(root, ".autopilotignore"),
      "utf8",
    );
    expect(cursorIgnore).toMatch(/^\.cursor\/\*\*/m);

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-who-agy-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expectAllSkills(root, ".agents");
    expectNoSkills(root, ".cursor");
    expectNoSkills(root, ".gemini");
    expectNoSkills(root, ".factory");
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
    const agyIgnore = fs.readFileSync(
      path.join(root, ".autopilotignore"),
      "utf8",
    );
    expect(agyIgnore).toMatch(/\.agents\/skills\/\*\*/);

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-who-gem-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expectAllSkills(root, ".gemini");
    expectNoSkills(root, ".cursor");
    expectNoSkills(root, ".factory");
    expectNoSkills(root, ".agents");
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
    const gemIgnore = fs.readFileSync(
      path.join(root, ".autopilotignore"),
      "utf8",
    );
    expect(gemIgnore).toMatch(/\.gemini\/skills\/\*\*/);

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-who-fac-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expectAllSkills(root, ".factory");
    expectNoSkills(root, ".cursor");
    expectNoSkills(root, ".gemini");
    expectNoSkills(root, ".agents");
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
    const facIgnore = fs.readFileSync(
      path.join(root, ".autopilotignore"),
      "utf8",
    );
    expect(facIgnore).toMatch(/\.factory\/skills\/\*\*/);

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-who-hermes-"));
    const home = withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    for (const name of SKILL_NAMES) {
      expect(
        fs.existsSync(path.join(home, "skills", name, "SKILL.md")),
      ).toBe(true);
    }
    expectNoSkills(root, ".cursor");
    expectNoSkills(root, ".gemini");
    expectNoSkills(root, ".factory");
    expectNoSkills(root, ".agents");
    expect(fs.existsSync(path.join(root, ".hermes"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
  });

  it("Factory skills share body and set disable-model-invocation", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-fac-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const factoryOn = fs.readFileSync(
      path.join(root, ".factory", "skills", "autopilot-on", "SKILL.md"),
      "utf8",
    );
    expect(factoryOn).toMatch(/^disable-model-invocation:\s*true$/m);
    expect(factoryOn).toMatch(/Gate: ON trigger|already planning/i);
    expect(factoryOn).not.toMatch(/^user-invocable:/m);
  });

  it("Hermes skills land under $HERMES_HOME/skills", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-hermes-init-"));
    const home = withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    for (const name of SKILL_NAMES) {
      expect(fs.existsSync(path.join(home, "skills", name, "SKILL.md"))).toBe(
        true,
      );
    }
    expect(fs.existsSync(path.join(root, ".hermes"))).toBe(false);
  });

  it("Hermes symlink skills root fail-closed on init", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-hermes-sym-"));
    const home = withHermesHome();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-out-"));
    try {
      fs.symlinkSync(outside, path.join(home, "skills"));
      const bad = installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toMatch(/symlink/i);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("Gemini/Factory/Antigravity symlink skills root fail-closed on init", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-gem-sym-"));
    const geminiDir = path.join(root, ".gemini");
    fs.mkdirSync(geminiDir, { recursive: true });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-gem-out-"));
    try {
      fs.symlinkSync(outside, path.join(geminiDir, "skills"));
      const bad = installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toMatch(/symlink/i);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    fs.rmSync(root, { recursive: true, force: true });
    root = "";

    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-fac-sym-"));
    const factoryDir = path.join(root, ".factory");
    fs.mkdirSync(factoryDir, { recursive: true });
    const outsideF = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-fac-out-"));
    try {
      fs.symlinkSync(outsideF, path.join(factoryDir, "skills"));
      const bad = installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toMatch(/symlink/i);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(outsideF, { recursive: true, force: true });
    }
    fs.rmSync(root, { recursive: true, force: true });
    root = "";

    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-agy-sym-"));
    const agentsDir = path.join(root, ".agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const outsideA = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-agy-out-"));
    try {
      fs.symlinkSync(outsideA, path.join(agentsDir, "skills"));
      const bad = installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toMatch(/symlink/i);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
    } finally {
      fs.rmSync(outsideA, { recursive: true, force: true });
    }
  });

  it("Codex/Copilot/Grok symlink skills root fail-closed on init", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-codex-sym-"));
    const agentsDir = path.join(root, ".agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const outsideC = fs.mkdtempSync(
      path.join(os.tmpdir(), "ap-skills-codex-out-"),
    );
    try {
      fs.symlinkSync(outsideC, path.join(agentsDir, "skills"));
      const bad = installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toMatch(/symlink/i);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(outsideC, { recursive: true, force: true });
    }
    fs.rmSync(root, { recursive: true, force: true });
    root = "";

    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-copilot-sym-"));
    const githubDir = path.join(root, ".github");
    fs.mkdirSync(githubDir, { recursive: true });
    const outsideP = fs.mkdtempSync(
      path.join(os.tmpdir(), "ap-skills-copilot-out-"),
    );
    try {
      fs.symlinkSync(outsideP, path.join(githubDir, "skills"));
      const bad = installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toMatch(/symlink/i);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(outsideP, { recursive: true, force: true });
    }
    fs.rmSync(root, { recursive: true, force: true });
    root = "";

    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-grok-sym-"));
    const grokDir = path.join(root, ".grok");
    fs.mkdirSync(grokDir, { recursive: true });
    const outsideG = fs.mkdtempSync(
      path.join(os.tmpdir(), "ap-skills-grok-out-"),
    );
    try {
      fs.symlinkSync(outsideG, path.join(grokDir, "skills"));
      const bad = installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error).toMatch(/symlink/i);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(outsideG, { recursive: true, force: true });
    }
  });

  it("Gemini/Factory/Antigravity skills root as a file fail-closed on init", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-gem-file-"));
    const geminiDir = path.join(root, ".gemini");
    fs.mkdirSync(geminiDir, { recursive: true });
    fs.writeFileSync(path.join(geminiDir, "skills"), "not-a-dir\n");
    const badG = installInitYes({
      projectRoot: root,
      platform: "gemini-cli",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(badG.ok).toBe(false);
    if (!badG.ok) expect(badG.error).toMatch(/not a directory/i);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
    fs.rmSync(root, { recursive: true, force: true });
    root = "";

    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-fac-file-"));
    const factoryDir = path.join(root, ".factory");
    fs.mkdirSync(factoryDir, { recursive: true });
    fs.writeFileSync(path.join(factoryDir, "skills"), "not-a-dir\n");
    const badF = installInitYes({
      projectRoot: root,
      platform: "factory-droid",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(badF.ok).toBe(false);
    if (!badF.ok) expect(badF.error).toMatch(/not a directory/i);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
    fs.rmSync(root, { recursive: true, force: true });
    root = "";

    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-agy-file-"));
    const agentsDir = path.join(root, ".agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "skills"), "not-a-dir\n");
    const badA = installInitYes({
      projectRoot: root,
      platform: "antigravity",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(badA.ok).toBe(false);
    if (!badA.ok) expect(badA.error).toMatch(/not a directory/i);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
  });

  it("Gemini skills root as a file fail-closed on uninstall", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-gem-un-file-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.rmSync(path.join(root, ".gemini", "skills"), {
      recursive: true,
      force: true,
    });
    fs.writeFileSync(path.join(root, ".gemini", "skills"), "not-a-dir\n");
    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(false);
    if (!un.ok) expect(un.error).toMatch(/not a directory/i);
  });

  it("Hermes leaf skill symlink soft-skips on uninstall (hooks still strip)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-hermes-leaf-"));
    const home = withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const skillDir = path.join(home, "skills", "autopilot-on");
    fs.rmSync(skillDir, { recursive: true, force: true });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-leaf-out-"));
    try {
      fs.symlinkSync(outside, skillDir);
      const un = uninstallProject({ projectRoot: root, dryRun: false });
      expect(un.ok).toBe(true);
      if (!un.ok) return;
      expect(un.actions.some((a) => /skip \$HERMES_HOME\/skills\/autopilot-on/i.test(a))).toBe(
        true,
      );
      // Sibling Autopilot skills still removed
      expect(fs.existsSync(path.join(home, "skills", "autopilot-run"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(home, "skills", "autopilot-off"))).toBe(
        false,
      );
      // Hooks still stripped from shared config
      const yaml = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
      expect(yaml).not.toMatch(/autopilot-harness-hook/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("Hermes skills root as a file fail-closed on uninstall", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-hermes-file-"));
    const home = withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.rmSync(path.join(home, "skills"), { recursive: true, force: true });
    fs.writeFileSync(path.join(home, "skills"), "not-a-dir\n");
    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(false);
    if (!un.ok) expect(un.error).toMatch(/not a directory/i);
  });

  it("Cursor-only uninstall does not wipe shared Hermes skills", () => {
    const home = withHermesHome();
    const hermesRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "ap-skills-hermes-proj-"),
    );
    expect(
      installInitYes({
        projectRoot: hermesRoot,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      fs.existsSync(path.join(home, "skills", "autopilot-on", "SKILL.md")),
    ).toBe(true);

    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-cursor-un-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(true);
    expect(
      fs.existsSync(path.join(home, "skills", "autopilot-on", "SKILL.md")),
    ).toBe(true);

    // Cleanup hermes project (afterEach only cleans `root`)
    fs.rmSync(hermesRoot, { recursive: true, force: true });
  });

  it("zh-CN locale writes localized skill description under .gemini/skills", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-zh-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "zh-CN",
        force: false,
      }).ok,
    ).toBe(true);
    const skill = fs.readFileSync(
      path.join(root, ".gemini", "skills", "autopilot-on", "SKILL.md"),
      "utf8",
    );
    expect(skill).toMatch(/^name:\s*autopilot-on$/m);
    const zhOn = skillDescriptions("zh-CN")["autopilot-on"];
    expect(skill).toContain(`description: "${zhOn.replace(/"/g, '\\"')}"`);
    expect(zhOn).not.toBe(skillDescriptions("en")["autopilot-on"]);
  });

  it("zh-CN locale localizes Factory, Antigravity, and Hermes skill descriptions", () => {
    const zhOn = skillDescriptions("zh-CN")["autopilot-on"];
    expect(zhOn).not.toBe(skillDescriptions("en")["autopilot-on"]);
    const zhDesc = `description: "${zhOn.replace(/"/g, '\\"')}"`;

    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-zh-fac-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "zh-CN",
        force: false,
      }).ok,
    ).toBe(true);
    const fac = fs.readFileSync(
      path.join(root, ".factory", "skills", "autopilot-on", "SKILL.md"),
      "utf8",
    );
    expect(fac).toContain(zhDesc);
    expect(fac).toMatch(/^disable-model-invocation:\s*true$/m);
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-zh-agy-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "zh-CN",
        force: false,
      }).ok,
    ).toBe(true);
    const agy = fs.readFileSync(
      path.join(root, ".agents", "skills", "autopilot-on", "SKILL.md"),
      "utf8",
    );
    expect(agy).toContain(zhDesc);
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-zh-hermes-"));
    const home = withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "zh-CN",
        force: false,
      }).ok,
    ).toBe(true);
    const hermes = fs.readFileSync(
      path.join(home, "skills", "autopilot-on", "SKILL.md"),
      "utf8",
    );
    expect(hermes).toContain(zhDesc);
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
  });

  it("uninstall strips Autopilot skills per platform; keeps foreign sibling skills", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-un-"));
    const home = withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "gemini-cli", surface: "cli" },
          { id: "factory-droid", surface: "cli" },
          { id: "hermes-agent", surface: "cli" },
          { id: "antigravity", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const foreignGemini = path.join(root, ".gemini", "skills", "other-skill");
    fs.mkdirSync(foreignGemini, { recursive: true });
    fs.writeFileSync(path.join(foreignGemini, "SKILL.md"), "keep\n");
    const foreignFactory = path.join(root, ".factory", "skills", "other-skill");
    fs.mkdirSync(foreignFactory, { recursive: true });
    fs.writeFileSync(path.join(foreignFactory, "SKILL.md"), "keep\n");
    const foreignAgents = path.join(root, ".agents", "skills", "other-skill");
    fs.mkdirSync(foreignAgents, { recursive: true });
    fs.writeFileSync(path.join(foreignAgents, "SKILL.md"), "keep\n");
    const foreignHermes = path.join(home, "skills", "other-skill");
    fs.mkdirSync(foreignHermes, { recursive: true });
    fs.writeFileSync(path.join(foreignHermes, "SKILL.md"), "keep\n");

    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(true);

    for (const name of SKILL_NAMES) {
      expect(
        fs.existsSync(path.join(root, ".gemini", "skills", name)),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(root, ".factory", "skills", name)),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(root, ".agents", "skills", name)),
      ).toBe(false);
      expect(fs.existsSync(path.join(home, "skills", name))).toBe(false);
    }
    expect(fs.existsSync(path.join(foreignGemini, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(foreignFactory, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(foreignAgents, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(foreignHermes, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
  });

  it("upgrade dry-run lists skills refresh for Gemini/Factory/Hermes/Antigravity", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-up-"));
    withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "gemini-cli", surface: "cli" },
          { id: "factory-droid", surface: "cli" },
          { id: "hermes-agent", surface: "cli" },
          { id: "antigravity", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const r = upgradeProject({ projectRoot: root, dryRun: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actions.some((a) => /\.gemini\/skills/i.test(a))).toBe(true);
    expect(r.actions.some((a) => /\.factory\/skills/i.test(a))).toBe(true);
    expect(r.actions.some((a) => /HERMES_HOME\/skills/i.test(a))).toBe(true);
    expect(r.actions.some((a) => /\.agents\/skills/i.test(a))).toBe(true);
  });

  it("upgrade refreshes mutated Gemini/Factory/Hermes/Antigravity skill bodies", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-up-live-"));
    const home = withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "gemini-cli", surface: "cli" },
          { id: "factory-droid", surface: "cli" },
          { id: "hermes-agent", surface: "cli" },
          { id: "antigravity", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const geminiOn = path.join(
      root,
      ".gemini",
      "skills",
      "autopilot-on",
      "SKILL.md",
    );
    const factoryOn = path.join(
      root,
      ".factory",
      "skills",
      "autopilot-on",
      "SKILL.md",
    );
    const agentsOn = path.join(
      root,
      ".agents",
      "skills",
      "autopilot-on",
      "SKILL.md",
    );
    const hermesOn = path.join(home, "skills", "autopilot-on", "SKILL.md");
    fs.writeFileSync(geminiOn, "MUTATED_GEMINI\n");
    fs.writeFileSync(
      factoryOn,
      `---
name: autopilot-on
description: "x"
disable-model-invocation: false
---

MUTATED_FACTORY
`,
    );
    fs.writeFileSync(agentsOn, "MUTATED_AGENTS\n");
    fs.writeFileSync(hermesOn, "MUTATED_HERMES\n");

    const r = upgradeProject({ projectRoot: root, dryRun: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const geminiBody = fs.readFileSync(geminiOn, "utf8");
    const factoryBody = fs.readFileSync(factoryOn, "utf8");
    const agentsBody = fs.readFileSync(agentsOn, "utf8");
    const hermesBody = fs.readFileSync(hermesOn, "utf8");
    expect(geminiBody).not.toMatch(/MUTATED_GEMINI/);
    expect(geminiBody).toMatch(/^name:\s*autopilot-on$/m);
    expect(hermesBody).not.toMatch(/MUTATED_HERMES/);
    expect(hermesBody).toMatch(/^name:\s*autopilot-on$/m);
    expect(agentsBody).not.toMatch(/MUTATED_AGENTS/);
    expect(agentsBody).toMatch(/^name:\s*autopilot-on$/m);
    expect(factoryBody).not.toMatch(/MUTATED_FACTORY/);
    expect(factoryBody).toMatch(/^disable-model-invocation:\s*true$/m);
    expect(factoryBody).not.toMatch(/disable-model-invocation:\s*false/);
    expectNoSkills(root, ".cursor");
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
  });

  it("upgrade merges missing .gemini/skills/**, .factory/skills/**, and .agents/skills/** into .autopilotignore", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-ignore-up-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const ignorePath = path.join(root, ".autopilotignore");
    // Simulate a pre-skills-coinstall ignore file (settings/hooks only).
    fs.writeFileSync(
      ignorePath,
      [
        "# old ignore (pre Gemini/Factory/Antigravity skills patterns)",
        ".gemini/settings.json",
        ".factory/hooks.json",
        ".agents/hooks.json",
        "plans/**",
        "",
      ].join("\n"),
      "utf8",
    );
    const before = fs.readFileSync(ignorePath, "utf8");
    expect(before).not.toMatch(/\.gemini\/skills\/\*\*/);
    expect(before).not.toMatch(/\.factory\/skills\/\*\*/);
    expect(before).not.toMatch(/\.agents\/skills\/\*\*/);

    const r = upgradeProject({ projectRoot: root, dryRun: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = fs.readFileSync(ignorePath, "utf8");
    expect(after).toMatch(/\.gemini\/skills\/\*\*/);
    expect(after).toMatch(/\.factory\/skills\/\*\*/);
    expect(after).toMatch(/\.agents\/skills\/\*\*/);
    expect(after).toMatch(/\.agents\/bin\/\*\*/);
    expectAllSkills(root, ".gemini");
    expectNoSkills(root, ".factory");
    expectNoSkills(root, ".agents");
    expectNoSkills(root, ".cursor");
  });

  it("upgrade restores missing Autopilot skill files for enabled Gemini/Factory/Antigravity/Hermes", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-up-missing-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const geminiOnDir = path.join(root, ".gemini", "skills", "autopilot-on");
    fs.rmSync(geminiOnDir, { recursive: true, force: true });
    expect(fs.existsSync(path.join(geminiOnDir, "SKILL.md"))).toBe(false);

    const r = upgradeProject({ projectRoot: root, dryRun: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expectAllSkills(root, ".gemini");
    const body = fs.readFileSync(path.join(geminiOnDir, "SKILL.md"), "utf8");
    expect(body).toMatch(/^name:\s*autopilot-on$/m);
    expectNoSkills(root, ".cursor");
    expectNoSkills(root, ".factory");
    expectNoSkills(root, ".agents");
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-up-missing-fac-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const factoryOnDir = path.join(root, ".factory", "skills", "autopilot-on");
    fs.rmSync(factoryOnDir, { recursive: true, force: true });
    const facUp = upgradeProject({ projectRoot: root, dryRun: false });
    expect(facUp.ok).toBe(true);
    if (!facUp.ok) return;
    expectAllSkills(root, ".factory");
    const facBody = fs.readFileSync(
      path.join(factoryOnDir, "SKILL.md"),
      "utf8",
    );
    expect(facBody).toMatch(/^name:\s*autopilot-on$/m);
    expect(facBody).toMatch(/^disable-model-invocation:\s*true$/m);
    expectNoSkills(root, ".cursor");
    expectNoSkills(root, ".gemini");
    expectNoSkills(root, ".agents");
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-up-missing-agy-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const agentsOnDir = path.join(root, ".agents", "skills", "autopilot-on");
    fs.rmSync(agentsOnDir, { recursive: true, force: true });
    const agyUp = upgradeProject({ projectRoot: root, dryRun: false });
    expect(agyUp.ok).toBe(true);
    if (!agyUp.ok) return;
    expectAllSkills(root, ".agents");
    const agyBody = fs.readFileSync(
      path.join(agentsOnDir, "SKILL.md"),
      "utf8",
    );
    expect(agyBody).toMatch(/^name:\s*autopilot-on$/m);
    expectNoSkills(root, ".cursor");
    expectNoSkills(root, ".gemini");
    expectNoSkills(root, ".factory");
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-up-missing-hermes-"));
    const home = withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hermesOn = path.join(home, "skills", "autopilot-on", "SKILL.md");
    fs.rmSync(path.dirname(hermesOn), { recursive: true, force: true });
    expect(fs.existsSync(hermesOn)).toBe(false);
    const hermesUp = upgradeProject({ projectRoot: root, dryRun: false });
    expect(hermesUp.ok).toBe(true);
    if (!hermesUp.ok) return;
    for (const name of SKILL_NAMES) {
      expect(
        fs.existsSync(path.join(home, "skills", name, "SKILL.md")),
      ).toBe(true);
    }
    expect(fs.readFileSync(hermesOn, "utf8")).toMatch(/^name:\s*autopilot-on$/m);
    expectNoSkills(root, ".cursor");
    expectNoSkills(root, ".gemini");
    expectNoSkills(root, ".factory");
    expectNoSkills(root, ".agents");
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
  });

  it("upgrade restores missing Autopilot skills for Codex/Copilot/Grok", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-up-missing-codex-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const agentsOn = path.join(root, ".agents", "skills", "autopilot-on");
    fs.rmSync(agentsOn, { recursive: true, force: true });
    expect(fs.existsSync(path.join(agentsOn, "SKILL.md"))).toBe(false);
    const codexUp = upgradeProject({ projectRoot: root, dryRun: false });
    expect(codexUp.ok).toBe(true);
    if (!codexUp.ok) return;
    expectAllSkills(root, ".agents");
    expect(fs.existsSync(path.join(root, ".codex", "skills"))).toBe(false);

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-up-missing-copilot-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const githubOn = path.join(root, ".github", "skills", "autopilot-on");
    fs.rmSync(githubOn, { recursive: true, force: true });
    const copilotUp = upgradeProject({ projectRoot: root, dryRun: false });
    expect(copilotUp.ok).toBe(true);
    if (!copilotUp.ok) return;
    expectAllSkills(root, ".github");

    fs.rmSync(root, { recursive: true, force: true });
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-up-missing-grok-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const grokOn = path.join(root, ".grok", "skills", "autopilot-on");
    fs.rmSync(grokOn, { recursive: true, force: true });
    const grokUp = upgradeProject({ projectRoot: root, dryRun: false });
    expect(grokUp.ok).toBe(true);
    if (!grokUp.ok) return;
    expectAllSkills(root, ".grok");
  });
});
