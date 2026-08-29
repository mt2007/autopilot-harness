import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installInitYes, mergeHooksJson } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-init-"));
}

describe("hooks.json merge", () => {
  it("creates minimal Autopilot hooks when missing", () => {
    const merged = mergeHooksJson(null);
    expect(merged.hooks.beforeSubmitPrompt).toHaveLength(1);
    expect(JSON.stringify(merged)).toMatch(/autopilot-harness/);
    expect(merged.hooks.afterFileEdit).toHaveLength(1);
    expect(merged.hooks.stop).toHaveLength(1);
  });

  it("preserves user hooks and replaces Autopilot entries", () => {
    const existing = {
      version: 1,
      hooks: {
        beforeSubmitPrompt: [
          { command: "echo user-hook" },
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event beforeSubmitPrompt",
          },
        ],
        stop: [{ command: "echo other-stop" }],
      },
    };
    const merged = mergeHooksJson(existing);
    const submit = merged.hooks.beforeSubmitPrompt ?? [];
    expect(submit.some((h) => h.command.includes("echo user-hook"))).toBe(true);
    expect(
      submit.filter((h) => h.command.includes("autopilot-harness")),
    ).toHaveLength(1);
    expect(merged.hooks.stop?.some((h) => h.command.includes("other-stop"))).toBe(
      true,
    );
    expect(
      merged.hooks.stop?.some((h) => h.command.includes("autopilot-harness")),
    ).toBe(true);
  });
});

describe("init --yes install", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes config, pin, hook, skills, workflows and merges hooks", () => {
    root = tmpProject();
    // pre-existing user hook
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".cursor", "hooks.json"),
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: "echo keep-me" }],
        },
      }),
    );

    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);

    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      true,
    );
    const pin = JSON.parse(
      fs.readFileSync(path.join(root, ".autopilot", "pin.json"), "utf8"),
    );
    expect(pin["autopilot-harness"]).toBe("0.1.0");

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    expect(fs.existsSync(hook)).toBe(true);
    expect(fs.readFileSync(hook, "utf8")).toMatch(/autopilot-harness/);
    expect(
      fs.existsSync(
        path.join(root, ".autopilot", "bin", "vendor", "runtime.mjs"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          root,
          ".autopilot",
          "bin",
          "vendor",
          "migrations",
          "001_initial.sql",
        ),
      ),
    ).toBe(true);

    for (const skill of [
      "autopilot-on",
      "autopilot-run",
      "autopilot-off",
      "autopilot-resume",
      "autopilot-replan",
    ]) {
      expect(
        fs.existsSync(path.join(root, ".cursor", "skills", skill, "SKILL.md")),
      ).toBe(true);
    }

    expect(
      fs.existsSync(
        path.join(root, "docs", "autopilot", "workflows", "autopilot-planning.md"),
      ),
    ).toBe(true);

    const hooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    );
    expect(
      hooks.hooks.beforeSubmitPrompt.some((h: { command: string }) =>
        h.command.includes("keep-me"),
      ),
    ).toBe(true);
    expect(
      hooks.hooks.beforeSubmitPrompt.some((h: { command: string }) =>
        h.command.includes("autopilot-harness"),
      ),
    ).toBe(true);

    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(config).toMatch(/platform:\s*cursor/);
    expect(config).toMatch(/locale:\s*en/);
    expect(config).toMatch(/confirm_rounds:\s*5/);
    expect(config).toMatch(/enabled:\s*false/);
  });

  it("refuses existing .autopilot without --force", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(path.join(root, ".autopilot", "config.yml"), "platform: x\n");
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already initialized/i);
    }
  });

  it("rejects unsupported platform", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platform: "claude-code",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/unsupported/i);
    }
  });

  it("refuses to overwrite corrupt hooks.json", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cursor", "hooks.json"), "{not-json");
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not valid json/i);
    }
    expect(fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8")).toBe(
      "{not-json",
    );
  });

  it("refuses non-array hook event values without wiping", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    const hooksPath = path.join(root, ".cursor", "hooks.json");
    fs.writeFileSync(
      hooksPath,
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: { command: "echo singular" },
        },
      }),
    );
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/must be an array/i);
    }
    const kept = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(kept.hooks.beforeSubmitPrompt.command).toBe("echo singular");
  });

  it("doctor fails when Autopilot hooks are missing", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".autopilot", "bin"), { recursive: true });
    fs.writeFileSync(path.join(root, ".autopilot", "config.yml"), "platform: cursor\n");
    fs.writeFileSync(
      path.join(root, ".autopilot", "pin.json"),
      JSON.stringify({ "autopilot-harness": "0.1.0" }),
    );
    fs.writeFileSync(
      path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs"),
      "// marker autopilot-harness\n",
    );
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".cursor", "hooks.json"),
      JSON.stringify({ version: 1, hooks: { beforeSubmitPrompt: [] } }),
    );
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/missing Autopilot/i);
  });

  it("doctor WARNs on duplicate Autopilot hooks without FAIL", () => {
    root = tmpProject();
    const installed = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(installed.ok).toBe(true);
    const hooksPath = path.join(root, ".cursor", "hooks.json");
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    hooks.hooks.beforeSubmitPrompt.push({
      command:
        "node .autopilot/bin/autopilot-harness-hook.mjs --event beforeSubmitPrompt",
    });
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2));
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    expect(lines.join("\n")).toMatch(/duplicate/i);
    expect(lines.join("\n")).not.toMatch(/FAIL.*missing Autopilot/i);
  });

  it("--force refreshes hook but keeps existing config.yml", () => {
    root = tmpProject();
    const first = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(first.ok).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    fs.writeFileSync(
      configPath,
      "platform: cursor\nlocale: zh-CN\n# user-edit\n",
    );

    const second = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: true,
    });
    expect(second.ok).toBe(true);
    const kept = fs.readFileSync(configPath, "utf8");
    expect(kept).toMatch(/user-edit/);
    expect(kept).toMatch(/locale: zh-CN/);
    expect(
      fs.existsSync(
        path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs"),
      ),
    ).toBe(true);
  });
});
