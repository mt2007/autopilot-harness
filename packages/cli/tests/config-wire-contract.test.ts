/**
 * config-wire checklist contract matrix — bilingual stock, empty-on fallback,
 * custom phrases + plans_dir load, init/--scope, upgrade scope, custom dir ignore.
 * Port RUN/bind also covered in packages/core/tests/config-wire-ports.test.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TRIGGERS,
  loadProjectHookConfig,
  StateStore,
} from "@autopilot-harness/core";
import { stockTriggers } from "@autopilot-harness/i18n";
import { handleBeforeSubmitPrompt } from "../../ports/cursor/src/index.js";
import { installInitYes } from "../src/init/install.js";
import { parseInitReviewScope } from "../src/init/wizard-helpers.js";
import { upgradeProject } from "../src/upgrade.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-config-wire-contract-"));
}

function writeConfig(root: string, body: string): void {
  fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
  fs.writeFileSync(path.join(root, ".autopilot", "config.yml"), body, "utf8");
}

/** Non-comment YAML `scope:` values (review.scope contract). */
function yamlScopeValues(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*scope:\s*(\S+)/gm)].map((m) => m[1]!);
}

describe("config-wire contract matrix", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function root(): string {
    const r = tmpProject();
    roots.push(r);
    return r;
  }

  it("bilingual stockTriggers match DEFAULT_TRIGGERS for en and zh-CN", () => {
    for (const loc of ["en", "zh-CN"] as const) {
      const stock = stockTriggers(loc);
      for (const key of [
        "on",
        "run",
        "off",
        "resume",
        "replan",
        "resume_review",
      ] as const) {
        expect(stock[key], `${loc}.${key}`).toEqual(DEFAULT_TRIGGERS[key]);
      }
      expect(stock.on).toEqual(
        expect.arrayContaining([
          "Autopilot ON",
          "Enable autopilot",
          "开启自动驾驶",
        ]),
      );
    }
  });

  it("fresh init seeds bilingual stock triggers and scope project", () => {
    const projectRoot = root();
    expect(
      installInitYes({
        projectRoot,
        platform: "cursor",
        surface: "ide",
        locale: "zh-CN",
        force: false,
      }).ok,
    ).toBe(true);
    const yaml = fs.readFileSync(
      path.join(projectRoot, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(yamlScopeValues(yaml)).toEqual(["project"]);
    const cfg = loadProjectHookConfig(projectRoot);
    expect(cfg.triggers.on).toEqual(DEFAULT_TRIGGERS.on);
    expect(cfg.triggers.run).toEqual(DEFAULT_TRIGGERS.run);
    expect(cfg.triggers.off).toEqual(DEFAULT_TRIGGERS.off);
    expect(cfg.triggers.resume).toEqual(DEFAULT_TRIGGERS.resume);
    expect(cfg.triggers.replan).toEqual(DEFAULT_TRIGGERS.replan);
    expect(cfg.triggers.resume_review).toEqual(DEFAULT_TRIGGERS.resume_review);
  });

  it("empty on falls back; whitespace-only on falls back; custom run kept", () => {
    const projectRoot = root();
    writeConfig(
      projectRoot,
      `
triggers:
  on: []
  run:
    - Keep RUN
`,
    );
    const emptyOn = loadProjectHookConfig(projectRoot);
    expect(emptyOn.triggers.on).toEqual(DEFAULT_TRIGGERS.on);
    expect(emptyOn.triggers.run).toEqual(["Keep RUN"]);

    const tab = "\t";
    writeConfig(
      projectRoot,
      `
triggers:
  on:
    - "   "
    - "${tab}"
  run:
    - Keep RUN
`,
    );
    const wsOn = loadProjectHookConfig(projectRoot);
    expect(wsOn.triggers.on).toEqual(DEFAULT_TRIGGERS.on);
    expect(wsOn.triggers.run).toEqual(["Keep RUN"]);
  });

  it("custom phrases and plans_dir load from YAML", () => {
    const projectRoot = root();
    writeConfig(
      projectRoot,
      `
artifacts:
  plans_dir: work/plans
triggers:
  on:
    - Custom Wire ON
    - 自定义接线
  run:
    - Custom Wire RUN
`,
    );
    const cfg = loadProjectHookConfig(projectRoot);
    expect(cfg.plansDir).toBe("work/plans");
    expect(cfg.triggers.on).toEqual(["Custom Wire ON", "自定义接线"]);
    expect(cfg.triggers.run).toEqual(["Custom Wire RUN"]);
    expect(cfg.triggers.off).toEqual(DEFAULT_TRIGGERS.off);
  });

  it("Cursor RUN honors YAML plans_dir (single track → executing)", () => {
    const projectRoot = root();
    writeConfig(
      projectRoot,
      `
artifacts:
  plans_dir: work/plans
`,
    );
    const dir = path.join(projectRoot, "work", "plans", "solo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "plan.md"), "# solo\n");
    fs.writeFileSync(path.join(dir, "checklist.md"), "- [ ] a — A\n");

    const store = StateStore.openMemory(projectRoot);
    try {
      const out = handleBeforeSubmitPrompt(
        store,
        { conversation_id: "wire-run", prompt: "Autopilot RUN" },
        projectRoot,
      );
      expect(out).toEqual({ continue: true });
      const session = store.getSession("wire-run");
      expect(session?.phase).toBe("executing");
      expect(session?.track_id).toBe("solo");
      expect(session?.armed).toBe(1);
    } finally {
      store.close();
    }
  });

  it("parseInitReviewScope defaults project; aliases; rejects bogus", () => {
    expect(parseInitReviewScope(undefined)).toEqual({
      ok: true,
      value: "project",
    });
    expect(parseInitReviewScope(null)).toEqual({ ok: true, value: "project" });
    expect(parseInitReviewScope("")).toEqual({ ok: true, value: "project" });
    expect(parseInitReviewScope("  ")).toEqual({ ok: true, value: "project" });
    expect(parseInitReviewScope("project")).toEqual({
      ok: true,
      value: "project",
    });
    expect(parseInitReviewScope("always")).toEqual({
      ok: true,
      value: "project",
    });
    expect(parseInitReviewScope("all")).toEqual({ ok: true, value: "project" });
    expect(parseInitReviewScope("PROJECT")).toEqual({
      ok: true,
      value: "project",
    });
    expect(parseInitReviewScope("Executing_Only")).toEqual({
      ok: true,
      value: "executing_only",
    });
    expect(parseInitReviewScope("executing_only")).toEqual({
      ok: true,
      value: "executing_only",
    });
    expect(parseInitReviewScope("bogus").ok).toBe(false);
  });

  it("init reviewScope executing_only; upgrade does not rewrite existing scope", () => {
    const projectRoot = root();
    expect(
      installInitYes({
        projectRoot,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        reviewScope: "executing_only",
      }).ok,
    ).toBe(true);
    const configPath = path.join(projectRoot, ".autopilot", "config.yml");
    expect(yamlScopeValues(fs.readFileSync(configPath, "utf8"))).toEqual([
      "executing_only",
    ]);

    const up = upgradeProject({
      projectRoot,
      packageVersion: "0.1.0",
    });
    expect(up.ok).toBe(true);
    expect(yamlScopeValues(fs.readFileSync(configPath, "utf8"))).toEqual([
      "executing_only",
    ]);
  });

  it("custom plansDir is covered in .autopilotignore on fresh init", () => {
    const projectRoot = root();
    expect(
      installInitYes({
        projectRoot,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        plansDir: "work/plans",
      }).ok,
    ).toBe(true);
    const ignore = fs.readFileSync(
      path.join(projectRoot, ".autopilotignore"),
      "utf8",
    );
    expect(ignore).toMatch(/^work\/plans\/\*\*$/m);
    expect(
      fs.readFileSync(path.join(projectRoot, ".autopilot", "config.yml"), "utf8"),
    ).toMatch(/^\s*plans_dir:\s*work\/plans\s*$/m);
  });
});
