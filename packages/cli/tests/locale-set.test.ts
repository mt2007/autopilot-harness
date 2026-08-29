import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installInitYes } from "../src/init/install.js";
import { setProjectLocale } from "../src/locale-set.js";
import { skillDescription, stockTriggers } from "@autopilot-harness/i18n";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-locale-"));
}

describe("locale set", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses when .cursor is a symlink", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cursor-out-"));
    const cursorPath = path.join(root, ".cursor");
    fs.rmSync(cursorPath, { recursive: true, force: true });
    fs.symlinkSync(outside, cursorPath);

    const before = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/symlink/i);
    expect(
      fs.readFileSync(path.join(root, ".autopilot", "config.yml"), "utf8"),
    ).toBe(before);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("refuses when config.yml is a symlink", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    const outside = path.join(root, "outside-config.yml");
    fs.renameSync(configPath, outside);
    fs.symlinkSync(outside, configPath);
    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Cannot read config\.yml|symlink/i);
    expect(fs.readFileSync(outside, "utf8")).toMatch(/locale:\s*en/);
  });

  it("refuses when config.yml is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    fs.rmSync(configPath, { force: true });
    fs.symlinkSync(path.join(root, "missing-config.yml"), configPath);
    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/symlink/i);
      expect(r.error).not.toMatch(/not initialized/i);
    }
  });

  it("fails when projectRoot is empty", () => {
    const r = setProjectLocale({ projectRoot: "  ", locale: "zh-CN" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/projectRoot/i);
  });

  it("accepts locale with leading BOM", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const r = setProjectLocale({
      projectRoot: root,
      locale: "\uFEFFzh-CN",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.locale).toBe("zh-CN");
  });

  it("fails when project is not initialized", () => {
    root = tmpProject();
    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not initialized/i);
  });

  it("rejects unsupported locale", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const r = setProjectLocale({ projectRoot: root, locale: "fr" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsupported locale/i);
  });

  it("switches en → zh-CN: config, skills, stock triggers", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);

    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previousLocale).toBe("en");
    expect(r.locale).toBe("zh-CN");
    expect(r.triggersUpdated.length).toBeGreaterThan(0);
    expect(r.triggersPreserved).toEqual([]);

    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(config).toMatch(/locale:\s*zh-CN/);
    expect(config).toMatch(/开启自动驾驶/);

    const skill = fs.readFileSync(
      path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain(skillDescription("zh-CN", "autopilot-on"));

    // Never touches plans/
    const planMarker = path.join(root, "plans", "keep-me", "plan.md");
    fs.mkdirSync(path.dirname(planMarker), { recursive: true });
    fs.writeFileSync(planMarker, "UNTOUCHED\n", "utf8");
    const again = setProjectLocale({ projectRoot: root, locale: "en" });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.locale).toBe("en");
    expect(again.previousLocale).toBe("zh-CN");
    expect(fs.readFileSync(planMarker, "utf8")).toBe("UNTOUCHED\n");
    expect(
      fs.readFileSync(path.join(root, ".autopilot", "config.yml"), "utf8"),
    ).toMatch(/locale:\s*en/);
    expect(
      fs.readFileSync(
        path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
        "utf8",
      ),
    ).toContain(skillDescription("en", "autopilot-on"));
  });

  it("trims locale argument whitespace", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const r = setProjectLocale({ projectRoot: root, locale: "  zh-CN  " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.locale).toBe("zh-CN");
  });

  it("preserves customized triggers", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);

    const configPath = path.join(root, ".autopilot", "config.yml");
    let config = fs.readFileSync(configPath, "utf8");
    config = config.replace(
      /on:\s*\[[^\]]*\]/,
      'on: ["CUSTOM ON PHRASE"]',
    );
    fs.writeFileSync(configPath, config, "utf8");

    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.triggersPreserved).toContain("on");
    expect(r.triggersUpdated).not.toContain("on");

    const after = fs.readFileSync(configPath, "utf8");
    expect(after).toMatch(/CUSTOM ON PHRASE/);
    expect(after).toMatch(/locale:\s*zh-CN/);
    // other stock keys still flip
    expect(after).toMatch(/开始执行/);
  });

  it("migrates legacy en stock triggers (pre-i18n single phrases)", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    let config = fs.readFileSync(configPath, "utf8");
    // Simulate early init defaults before i18n grew "Enable autopilot"
    config = config.replace(/on:\s*\[[^\]]*\]/, 'on: ["Autopilot ON"]');
    config = config.replace(/run:\s*\[[^\]]*\]/, 'run: ["Autopilot RUN"]');
    fs.writeFileSync(configPath, config, "utf8");

    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.triggersUpdated).toEqual(
      expect.arrayContaining(["on", "run"]),
    );
    const after = fs.readFileSync(configPath, "utf8");
    expect(after).toMatch(/开启自动驾驶/);
    expect(after).toMatch(/开始执行/);
  });

  it("preserves YAML comments when setting locale", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    let config = fs.readFileSync(configPath, "utf8");
    config = config.replace(
      "locale: en",
      "locale: en\n# keep-this-comment",
    );
    fs.writeFileSync(configPath, config, "utf8");

    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(true);
    const after = fs.readFileSync(configPath, "utf8");
    expect(after).toMatch(/keep-this-comment/);
    expect(after).toMatch(/locale:\s*zh-CN/);
  });

  it("fails closed on YAML document errors without mutating", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    // Tab indentation is invalid in YAML
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "platform: cursor\n\tlocale: en\n",
      "utf8",
    );
    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/YAML error/i);
    expect(
      fs.readFileSync(path.join(root, ".autopilot", "config.yml"), "utf8"),
    ).toMatch(/\tlocale/);
  });

  it("fills missing trigger keys with stock for next locale", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    let config = fs.readFileSync(configPath, "utf8");
    config = config.replace(/\n\s*replan:\s*\[[^\]]*\]/, "");
    fs.writeFileSync(configPath, config, "utf8");

    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.triggersUpdated).toContain("replan");
    const after = fs.readFileSync(configPath, "utf8");
    expect(after).toMatch(/修改方案/);
  });

  it("migrates other-locale stock when config.locale is missing", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "zh-CN",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    let config = fs.readFileSync(configPath, "utf8");
    // Drop locale key → previousLocale falls back to en, triggers stay zh-CN stock
    config = config.replace(/^locale:\s*zh-CN\n/m, "");
    fs.writeFileSync(configPath, config, "utf8");

    const r = setProjectLocale({ projectRoot: root, locale: "en" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.previousLocale).toBe("en");
    expect(r.triggersUpdated).toEqual(
      expect.arrayContaining(["on", "run", "off"]),
    );
    const after = fs.readFileSync(configPath, "utf8");
    expect(after).toMatch(/locale:\s*en/);
    expect(after).toMatch(/Enable autopilot/);
    expect(after).not.toMatch(/开启自动驾驶/);
  });

  it("preserves triggers.match and other non-stock keys", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    let config = fs.readFileSync(configPath, "utf8");
    config = config.replace(
      "match: line_start",
      "match: line_start\n  custom_meta: keep-me",
    );
    fs.writeFileSync(configPath, config, "utf8");

    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(true);
    const after = fs.readFileSync(configPath, "utf8");
    expect(after).toMatch(/match:\s*line_start/);
    expect(after).toMatch(/custom_meta:\s*keep-me/);
  });

  it("installs stock triggers when triggers map is missing", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    let config = fs.readFileSync(configPath, "utf8");
    config = config.replace(/\ntriggers:[\s\S]*?(?=\nsecurity:)/, "\n");
    fs.writeFileSync(configPath, config, "utf8");
    expect(fs.readFileSync(configPath, "utf8")).not.toMatch(/^triggers:/m);

    const r = setProjectLocale({ projectRoot: root, locale: "zh-CN" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.triggersUpdated).toEqual(
      expect.arrayContaining(["on", "run", "off", "resume", "replan"]),
    );
    const after = fs.readFileSync(configPath, "utf8");
    expect(after).toMatch(/triggers:/);
    expect(after).toMatch(/match:\s*line_start/);
    expect(after).toMatch(/开启自动驾驶/);
  });

  it("idempotent same-locale does not claim stock triggers updated", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);

    const r = setProjectLocale({ projectRoot: root, locale: "en" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.locale).toBe("en");
    expect(r.previousLocale).toBe("en");
    expect(r.triggersUpdated).toEqual([]);
    expect(r.triggersPreserved).toEqual([]);
  });

  it("init --locale zh-CN writes i18n skill description", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "zh-CN",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const skill = fs.readFileSync(
      path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain(skillDescription("zh-CN", "autopilot-on"));
    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    const stock = stockTriggers("zh-CN");
    expect(config).toContain(stock.on[1]!);
  });
});
