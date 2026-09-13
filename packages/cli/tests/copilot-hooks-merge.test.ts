import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COPILOT_AUTOPILOT_EVENTS,
  COPILOT_HOOK_TIMEOUT_SEC,
  COPILOT_HOOKS_REL_PATH,
  COPILOT_POST_TOOL_USE_MATCHER,
  copilotAutopilotHasSmallTimeout,
  copilotHooksContainAutopilot,
  copilotHooksHavePlatformStamp,
  hasCompleteCopilotAutopilotHooks,
  mergeCopilotHooks,
  stripAutopilotCopilotHooks,
  summarizeCopilotAutopilotHooks,
  validateCopilotHooksShape,
} from "../src/init/copilot-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { uninstallProject } from "../src/uninstall.js";
import {
  formatHostActivationTips,
  formatPostInstallOutro,
} from "../src/init/wizard-helpers.js";

describe("copilot hooks merge", () => {
  it("creates four camelCase events with dual OS fields, stamp, timeout ≥120", () => {
    const merged = mergeCopilotHooks(null);
    expect(merged.version).toBe(1);
    expect(hasCompleteCopilotAutopilotHooks(merged)).toBe(true);
    expect(copilotHooksHavePlatformStamp(merged)).toBe(true);
    expect(copilotAutopilotHasSmallTimeout(merged)).toBe(false);
    expect(COPILOT_HOOK_TIMEOUT_SEC).toBe(120);
    expect(COPILOT_HOOKS_REL_PATH).toBe(
      ".github/hooks/autopilot-harness.json",
    );
    expect(COPILOT_POST_TOOL_USE_MATCHER).toBe("edit|create");

    for (const event of COPILOT_AUTOPILOT_EVENTS) {
      const handlers = merged.hooks?.[event];
      expect(Array.isArray(handlers)).toBe(true);
      expect(handlers).toHaveLength(1);
      const h = handlers![0]!;
      expect(h.type).toBe("command");
      expect(h.bash).toBe(h.powershell);
      expect(h.bash).toMatch(/autopilot-harness-hook\.mjs/);
      expect(h.bash).toMatch(/--platform copilot-cli/);
      expect(h.bash).toMatch(new RegExp(`--event ${event}`));
      expect(h.timeoutSec).toBe(COPILOT_HOOK_TIMEOUT_SEC);
      if (event === "postToolUse") {
        expect(h.matcher).toBe(COPILOT_POST_TOOL_USE_MATCHER);
      } else {
        expect(h.matcher).toBeUndefined();
      }
    }
  });

  it("preserves foreign hooks and replaces Autopilot entries", () => {
    const existing = {
      version: 9,
      hooks: {
        agentStop: [
          {
            type: "command",
            bash: "echo foreign-stop",
            powershell: "echo foreign-stop",
          },
          {
            type: "command",
            bash: "node .autopilot/bin/autopilot-harness-hook.mjs --event agentStop",
            powershell:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event agentStop",
            timeoutSec: 30,
          },
        ],
        preToolUse: [
          {
            type: "command",
            bash: "echo foreign-pre",
            powershell: "echo foreign-pre",
          },
        ],
      },
    };
    const merged = mergeCopilotHooks(existing);
    expect(merged.version).toBe(1);
    expect(JSON.stringify(merged.hooks?.preToolUse)).toMatch(/foreign-pre/);
    const stopJson = JSON.stringify(merged.hooks?.agentStop);
    expect(stopJson).toMatch(/foreign-stop/);
    expect(stopJson).toMatch(/--platform copilot-cli/);
    expect(stopJson).not.toMatch(/timeoutSec":30/);
    const { duplicates } = summarizeCopilotAutopilotHooks(merged);
    expect(duplicates).toBe(0);
    expect(hasCompleteCopilotAutopilotHooks(merged)).toBe(true);
  });

  it("strips Autopilot fingerprint and keeps foreign", () => {
    const merged = mergeCopilotHooks({
      hooks: {
        userPromptSubmitted: [
          {
            type: "command",
            bash: "echo keep",
            powershell: "echo keep",
          },
        ],
      },
    });
    expect(copilotHooksContainAutopilot(merged)).toBe(true);
    const stripped = stripAutopilotCopilotHooks(merged);
    expect(copilotHooksContainAutopilot(stripped)).toBe(false);
    expect(JSON.stringify(stripped.hooks?.userPromptSubmitted)).toMatch(
      /echo keep/,
    );
    expect(stripped.hooks?.agentStop).toBeUndefined();
  });

  it("validateCopilotHooksShape rejects unsafe / bad shapes", () => {
    expect(validateCopilotHooksShape({})).toBeNull();
    expect(
      validateCopilotHooksShape({ hooks: { agentStop: "nope" as unknown as [] } }),
    ).toMatch(/array/);
    expect(
      validateCopilotHooksShape({
        hooks: {
          agentStop: [{ timeoutSec: Number.NaN }],
        },
      }),
    ).toMatch(/timeoutSec/);
  });

  it("detects missing platform stamp and small timeout", () => {
    const merged = mergeCopilotHooks(null);
    const bad = {
      ...merged,
      hooks: {
        ...merged.hooks,
        agentStop: [
          {
            type: "command",
            bash: "node .autopilot/bin/autopilot-harness-hook.mjs --event agentStop",
            powershell:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event agentStop",
            timeoutSec: 30,
          },
        ],
      },
    };
    expect(copilotHooksHavePlatformStamp(bad)).toBe(false);
    expect(copilotAutopilotHasSmallTimeout(bad)).toBe(true);
  });

  it("stamp check fails when only one OS field lacks --platform", () => {
    const merged = mergeCopilotHooks(null);
    const asymmetric = {
      ...merged,
      hooks: {
        ...merged.hooks,
        agentStop: [
          {
            type: "command",
            bash:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform copilot-cli --event agentStop",
            powershell:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event agentStop",
            timeoutSec: 120,
          },
        ],
      },
    };
    expect(copilotHooksHavePlatformStamp(asymmetric)).toBe(false);
  });
});

describe("copilot init wiring", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("init --platform copilot-cli writes dual-OS hooks and skip skills", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-init-"));
    const r = installInitYes({
      projectRoot: root,
      platform: "copilot-cli",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(true);

    const hooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    expect(fs.existsSync(hooksPath)).toBe(true);
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(hasCompleteCopilotAutopilotHooks(file)).toBe(true);
    expect(copilotHooksHavePlatformStamp(file)).toBe(true);
    expect(file.hooks.postToolUse[0].matcher).toBe("edit|create");
    expect(file.hooks.postToolUse[0].bash).toBe(
      file.hooks.postToolUse[0].powershell,
    );

    expect(fs.existsSync(path.join(root, ".cursor", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.github\/hooks\/\*\*/);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*copilot-cli/);
    expect(cfg).toMatch(/match:\s*line_start/);
    // Do not clamp confirm_rounds for Copilot (unlike Kimi default 1).
    expect(cfg).not.toMatch(/confirm_rounds:\s*1\b/);

    expect(formatHostActivationTips("copilot-cli").join("\n")).toMatch(
      /\.github\/hooks\/autopilot-harness\.json/,
    );
    expect(formatPostInstallOutro("copilot-cli")).toMatch(/triggers\.on/);

    // Quickstart markdown must not split `.github/hooks/...` when wrapping `/hooks`.
    const qs = fs.readFileSync(
      path.join(root, "docs", "autopilot", "quickstart.md"),
      "utf8",
    );
    expect(qs).toMatch(/`\.github\/hooks\/autopilot-harness\.json`/);
    expect(qs).not.toMatch(/\.github`\/hooks`\//);
  });

  it("add-platform copilot-cli keeps Cursor hooks and wires Copilot file", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-add-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const add = installInitYes({
      projectRoot: root,
      platform: "copilot-cli",
      surface: "cli",
      locale: "en",
      force: true,
      mergePlatforms: true,
    });
    expect(add.ok).toBe(true);

    expect(
      fs.existsSync(path.join(root, ".cursor", "hooks.json")),
    ).toBe(true);
    const hooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    expect(fs.existsSync(hooksPath)).toBe(true);
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(hasCompleteCopilotAutopilotHooks(file)).toBe(true);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*copilot-cli/);
  });

  it("fingerprint uninstall strips Autopilot Copilot hooks and keeps foreign", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-un-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    const before = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    before.hooks.agentStop.push({
      type: "command",
      bash: "echo foreign-keep",
      powershell: "echo foreign-keep",
    });
    fs.writeFileSync(hooksPath, JSON.stringify(before, null, 2) + "\n");

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);

    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(copilotHooksContainAutopilot(after)).toBe(false);
    expect(JSON.stringify(after.hooks?.agentStop)).toMatch(/foreign-keep/);
    expect(fs.existsSync(path.join(root, ".github"))).toBe(true);
  });

  it("init fails closed on corrupt Copilot hooks JSON", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-badjson-"));
    const hooksPath = path.join(
      root,
      ".github",
      "hooks",
      "autopilot-harness.json",
    );
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, "{not-json\n", "utf8");

    const r = installInitYes({
      projectRoot: root,
      platform: "copilot-cli",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/autopilot-harness\.json/i);
      expect(r.error).toMatch(/valid JSON|JSON/i);
    }
  });

  it("init fails closed when .github is a symlink", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-initsym-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-out-"));
    fs.symlinkSync(outside, path.join(root, ".github"));

    const r = installInitYes({
      projectRoot: root,
      platform: "copilot-cli",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.github/i);
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("Copilot-only uninstall fails closed when .github is a symlink", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-unsym-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "copilot-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-want-"));
    const hooksDir = path.join(outside, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hooks = fs.readFileSync(
      path.join(root, ".github", "hooks", "autopilot-harness.json"),
      "utf8",
    );
    fs.writeFileSync(path.join(hooksDir, "autopilot-harness.json"), hooks);
    fs.rmSync(path.join(root, ".github"), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, ".github"));

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.github/i);
    expect(
      JSON.stringify(
        JSON.parse(
          fs.readFileSync(
            path.join(outside, "hooks", "autopilot-harness.json"),
            "utf8",
          ),
        ),
      ),
    ).toMatch(/autopilot-harness-hook\.mjs/);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("Cursor-only uninstall soft-skips Autopilot Copilot hooks under symlinked .github", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-soft-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-link-"));
    const hooksDir = path.join(outside, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, "autopilot-harness.json"),
      JSON.stringify(
        {
          version: 1,
          hooks: {
            agentStop: [
              {
                type: "command",
                bash: "node .autopilot/bin/autopilot-harness-hook.mjs --platform copilot-cli --event agentStop",
                powershell:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --platform copilot-cli --event agentStop",
                timeoutSec: 120,
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
    );
    fs.symlinkSync(outside, path.join(root, ".github"));

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.actions.some((a) =>
        /skip \.github\/hooks\/autopilot-harness\.json/i.test(a),
      ),
    ).toBe(true);
    expect(
      JSON.stringify(
        JSON.parse(
          fs.readFileSync(
            path.join(outside, "hooks", "autopilot-harness.json"),
            "utf8",
          ),
        ),
      ),
    ).toMatch(/autopilot-harness-hook\.mjs/);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("force refresh merges .github/hooks/** into existing .autopilotignore", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-ignore-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const ignorePath = path.join(root, ".autopilotignore");
    const withoutGithub = fs
      .readFileSync(ignorePath, "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.includes(".github/hooks"))
      .join("\n");
    fs.writeFileSync(ignorePath, withoutGithub.endsWith("\n") ? withoutGithub : withoutGithub + "\n");

    const add = installInitYes({
      projectRoot: root,
      platform: "copilot-cli",
      surface: "cli",
      locale: "en",
      force: true,
      mergePlatforms: true,
    });
    expect(add.ok).toBe(true);
    expect(fs.readFileSync(ignorePath, "utf8")).toMatch(/\.github\/hooks\/\*\*/);
  });
});
