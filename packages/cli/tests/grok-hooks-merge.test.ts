import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAutopilotCommand } from "../src/init/hooks-merge.js";
import {
  GROK_AUTOPILOT_EVENTS,
  GROK_HOOK_TIMEOUT_SEC,
  GROK_HOOKS_REL_PATH,
  GROK_POST_TOOL_USE_MATCHER,
  grokAutopilotHasOmittedOrSmallTimeout,
  grokHooksContainAutopilot,
  grokHooksFileIsVacant,
  grokHooksHavePlatformStamp,
  hasCompleteGrokAutopilotHooks,
  mergeGrokHooks,
  stripAutopilotGrokHooks,
  summarizeGrokAutopilotHooks,
  validateGrokHooksShape,
} from "../src/init/grok-hooks-merge.js";
import { AUTOPILOT_SKILL_NAMES, installInitYes } from "../src/init/install.js";
import { uninstallProject } from "../src/uninstall.js";
import {
  formatHostActivationTips,
  formatPostInstallOutro,
} from "../src/init/wizard-helpers.js";

describe("grok hooks merge", () => {
  it("creates UPS/PostToolUse/Stop with stamp, timeout 120, matcher only on PostToolUse", () => {
    const merged = mergeGrokHooks(null);
    expect(hasCompleteGrokAutopilotHooks(merged)).toBe(true);
    expect(grokHooksHavePlatformStamp(merged)).toBe(true);
    expect(grokAutopilotHasOmittedOrSmallTimeout(merged)).toBe(false);
    expect(GROK_HOOK_TIMEOUT_SEC).toBe(120);
    expect(GROK_HOOKS_REL_PATH).toBe(".grok/hooks/autopilot-harness.json");
    expect(GROK_POST_TOOL_USE_MATCHER).toMatch(/search_replace/);
    expect(JSON.stringify(merged.hooks)).not.toMatch(/StopFailure/);

    for (const event of GROK_AUTOPILOT_EVENTS) {
      const groups = merged.hooks?.[event];
      expect(Array.isArray(groups)).toBe(true);
      expect(groups).toHaveLength(1);
      const g = groups![0]!;
      expect(Array.isArray(g.hooks)).toBe(true);
      expect(g.hooks).toHaveLength(1);
      const h = g.hooks![0]!;
      expect(h.type).toBe("command");
      expect(h.command).toMatch(/autopilot-harness-hook\.mjs/);
      expect(h.command).toMatch(/--platform grok-build/);
      expect(h.command).toMatch(new RegExp(`--event ${event}`));
      expect(h.timeout).toBe(GROK_HOOK_TIMEOUT_SEC);
      if (event === "PostToolUse") {
        expect(g.matcher).toBe(GROK_POST_TOOL_USE_MATCHER);
      } else {
        expect(g.matcher).toBeUndefined();
      }
    }
  });

  it("preserves foreign hooks and replaces Autopilot entries", () => {
    const existing = {
      description: "keep-me",
      hooks: {
        Stop: [
          {
            hooks: [
              { type: "command", command: "echo foreign-stop" },
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
                timeout: 30,
              },
            ],
          },
        ],
        SessionStart: [
          {
            hooks: [{ type: "command", command: "echo session" }],
          },
        ],
      },
    };
    const merged = mergeGrokHooks(existing);
    expect(merged.description).toBe("keep-me");
    expect(JSON.stringify(merged.hooks?.SessionStart)).toMatch(/echo session/);
    const stopJson = JSON.stringify(merged.hooks?.Stop);
    expect(stopJson).toMatch(/foreign-stop/);
    expect(stopJson).toMatch(/--platform grok-build/);
    expect(stopJson).not.toMatch(/"timeout":30/);
    const { duplicates } = summarizeGrokAutopilotHooks(merged);
    expect(duplicates).toBe(0);
    expect(hasCompleteGrokAutopilotHooks(merged)).toBe(true);
  });

  it("force refresh drops legacy flat Autopilot command groups (no stack)", () => {
    const existing = {
      hooks: {
        Stop: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
            timeout: 30,
          },
          { command: "echo foreign-flat" },
        ],
      },
    };
    const merged = mergeGrokHooks(existing);
    const stop = merged.hooks?.Stop ?? [];
    const json = JSON.stringify(stop);
    expect(json).toMatch(/echo foreign-flat/);
    expect(json).toMatch(/--platform grok-build/);
    const { duplicates } = summarizeGrokAutopilotHooks(merged);
    expect(duplicates).toBe(0);
    expect(hasCompleteGrokAutopilotHooks(merged)).toBe(true);
    expect(
      stop.some(
        (g) =>
          typeof g.command === "string" &&
          g.command.includes("autopilot-harness-hook.mjs") &&
          !Array.isArray(g.hooks),
      ),
    ).toBe(false);
  });

  it("strips Autopilot fingerprint; vacant when only Autopilot remains", () => {
    const merged = mergeGrokHooks(null);
    expect(grokHooksContainAutopilot(merged)).toBe(true);
    expect(grokHooksFileIsVacant(merged)).toBe(false);
    const stripped = stripAutopilotGrokHooks(merged);
    expect(grokHooksContainAutopilot(stripped)).toBe(false);
    expect(grokHooksFileIsVacant(stripped)).toBe(true);

    const withForeign = mergeGrokHooks({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [{ type: "command", command: "echo keep" }],
          },
        ],
      },
    });
    const kept = stripAutopilotGrokHooks(withForeign);
    expect(grokHooksContainAutopilot(kept)).toBe(false);
    expect(grokHooksFileIsVacant(kept)).toBe(false);
    expect(JSON.stringify(kept.hooks?.UserPromptSubmit)).toMatch(/echo keep/);
  });

  it("preserves foreign matcher when nested Autopilot is the only handler", () => {
    const existing = {
      hooks: {
        PostToolUse: [
          {
            matcher: "foreign-tools",
            hooks: [
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --platform grok-build --event PostToolUse",
                timeout: 120,
              },
            ],
          },
        ],
      },
    };
    const stripped = stripAutopilotGrokHooks(existing);
    expect(grokHooksContainAutopilot(stripped)).toBe(false);
    expect(grokHooksFileIsVacant(stripped)).toBe(false);
    expect(stripped.hooks?.PostToolUse?.[0]?.matcher).toBe("foreign-tools");
    expect(stripped.hooks?.PostToolUse?.[0]?.hooks).toEqual([]);

    const merged = mergeGrokHooks(existing);
    expect(JSON.stringify(merged.hooks?.PostToolUse)).toMatch(/foreign-tools/);
    expect(hasCompleteGrokAutopilotHooks(merged)).toBe(true);
  });

  it("validateGrokHooksShape rejects unsafe / bad shapes", () => {
    expect(validateGrokHooksShape({})).toBeNull();
    expect(
      validateGrokHooksShape({ hooks: { Stop: "nope" as unknown as [] } }),
    ).toMatch(/array/);
    expect(
      validateGrokHooksShape({
        hooks: {
          Stop: [{ timeout: Number.NaN }],
        },
      }),
    ).toMatch(/timeout/);
  });

  it("detects missing platform stamp and omitted/small timeout", () => {
    const merged = mergeGrokHooks(null);
    const bad = {
      ...merged,
      hooks: {
        ...merged.hooks,
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
                timeout: 30,
              },
            ],
          },
        ],
      },
    };
    expect(grokHooksHavePlatformStamp(bad)).toBe(false);
    expect(grokAutopilotHasOmittedOrSmallTimeout(bad)).toBe(true);

    const omitted = {
      ...merged,
      hooks: {
        ...merged.hooks,
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --platform grok-build --event Stop",
              },
            ],
          },
        ],
      },
    };
    expect(grokAutopilotHasOmittedOrSmallTimeout(omitted)).toBe(true);
  });

  it("strips top-level Autopilot command on mixed groups; keeps foreign", () => {
    const merged = mergeGrokHooks({
      hooks: {
        Stop: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
            timeout: 30,
            type: "command",
            hooks: [{ type: "command", command: "echo nested-foreign" }],
          },
          {
            command: "echo top-foreign",
            timeout: 45,
            hooks: [
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
              },
            ],
          },
        ],
      },
    });
    const stop = merged.hooks?.Stop ?? [];
    const stopJson = JSON.stringify(stop);
    expect(stopJson).toMatch(/echo nested-foreign/);
    expect(stopJson).toMatch(/echo top-foreign/);
    expect(stopJson).toMatch(/--platform grok-build/);
    const foreignFlat = stop.find((g) => g.command === "echo top-foreign");
    expect(foreignFlat?.timeout).toBe(45);
    for (const g of stop) {
      if (
        Array.isArray(g.hooks) &&
        g.hooks.some((h) => h.command === "echo nested-foreign")
      ) {
        expect(isAutopilotCommand(g.command)).toBe(false);
        expect(g.timeout).toBeUndefined();
        expect(g.type).toBeUndefined();
      }
    }
  });
});

describe("grok init wiring", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("init --platform grok-build writes Codex-shaped hooks and .grok skills", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-init-"));
    const r = installInitYes({
      projectRoot: root,
      platform: "grok-build",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(true);

    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    expect(fs.existsSync(hooksPath)).toBe(true);
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(hasCompleteGrokAutopilotHooks(file)).toBe(true);
    expect(grokHooksHavePlatformStamp(file)).toBe(true);
    expect(file.hooks.PostToolUse[0].matcher).toBe(GROK_POST_TOOL_USE_MATCHER);
    expect(file.hooks.UserPromptSubmit[0].matcher).toBeUndefined();
    expect(file.hooks.Stop[0].matcher).toBeUndefined();
    expect(file.hooks.Stop[0].hooks[0].timeout).toBe(120);

    expect(fs.existsSync(path.join(root, ".cursor", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "skills"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, ".grok", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.readFileSync(
        path.join(root, ".grok", "skills", "autopilot-on", "SKILL.md"),
        "utf8",
      ),
    ).toMatch(/^disable-model-invocation:\s*true$/m);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.grok\/hooks\/\*\*/);
    expect(ignore).toMatch(/\.grok\/skills\/\*\*/);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*grok-build/);
    expect(cfg).toMatch(/match:\s*line_start/);
    expect(cfg).not.toMatch(/confirm_rounds:\s*1\b/);

    expect(formatHostActivationTips("grok-build").join("\n")).toMatch(
      /\.grok\/hooks\/autopilot-harness\.json/,
    );
    expect(formatHostActivationTips("grok-build").join("\n")).toMatch(
      /\.grok\/skills\/autopilot-\*/,
    );
    expect(formatHostActivationTips("grok-build").join("\n")).not.toMatch(
      /no Autopilot skills/,
    );
    expect(formatPostInstallOutro("grok-build")).toMatch(/hooks-trust|--trust/);

    const qs = fs.readFileSync(
      path.join(root, "docs", "autopilot", "quickstart.md"),
      "utf8",
    );
    expect(qs).toMatch(/`\.grok\/hooks\/autopilot-harness\.json`/);
    expect(qs).toMatch(/`\/hooks-trust`/);
    expect(qs).not.toMatch(/\.grok`\/hooks`\//);
  });

  it("add-platform grok-build keeps Cursor hooks and wires Grok file", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-add-"));
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
      platform: "grok-build",
      surface: "cli",
      locale: "en",
      force: true,
      mergePlatforms: true,
    });
    expect(add.ok).toBe(true);

    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    expect(fs.existsSync(hooksPath)).toBe(true);
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(hasCompleteGrokAutopilotHooks(file)).toBe(true);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*grok-build/);
    for (const name of AUTOPILOT_SKILL_NAMES) {
      expect(
        fs.existsSync(path.join(root, ".grok", "skills", name, "SKILL.md")),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(root, ".cursor", "skills", name, "SKILL.md")),
      ).toBe(true);
    }
  });

  it("fingerprint uninstall unlinks vacant Grok hooks file; keeps siblings", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-un-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hooksDir = path.join(root, ".grok", "hooks");
    const hooksPath = path.join(hooksDir, "autopilot-harness.json");
    const sibling = path.join(hooksDir, "other.json");
    fs.writeFileSync(sibling, '{"ok":true}\n');

    const dry = uninstallProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(true);
    if (dry.ok) {
      expect(
        dry.actions.some((a) =>
          /unlink empty \.grok\/hooks\/autopilot-harness\.json/i.test(a),
        ),
      ).toBe(true);
    }
    expect(fs.existsSync(hooksPath)).toBe(true);

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(hooksPath)).toBe(false);
    expect(fs.existsSync(sibling)).toBe(true);
    expect(fs.existsSync(path.join(root, ".grok"))).toBe(true);
    if (r.ok) {
      expect(
        r.actions.some((a) => /unlink empty \.grok\/hooks\/autopilot-harness\.json/i.test(a)),
      ).toBe(true);
    }
  });

  it("fingerprint uninstall strips Autopilot and keeps foreign Grok hooks", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-unkeep-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    const before = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    before.hooks.Stop.push({
      hooks: [{ type: "command", command: "echo foreign-keep" }],
    });
    fs.writeFileSync(hooksPath, JSON.stringify(before, null, 2) + "\n");

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);

    expect(fs.existsSync(hooksPath)).toBe(true);
    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(grokHooksContainAutopilot(after)).toBe(false);
    expect(JSON.stringify(after.hooks?.Stop)).toMatch(/foreign-keep/);
  });

  it("init fails closed on corrupt Grok hooks JSON", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-badjson-"));
    const hooksPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, "{not-json\n", "utf8");

    const r = installInitYes({
      projectRoot: root,
      platform: "grok-build",
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

  it("init fails closed when .grok is a symlink", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-initsym-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-out-"));
    fs.symlinkSync(outside, path.join(root, ".grok"));

    const r = installInitYes({
      projectRoot: root,
      platform: "grok-build",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.grok/i);
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("Grok-only uninstall fails closed when .grok is a symlink", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-unsym-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "grok-build",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-want-"));
    const hooksDir = path.join(outside, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    const hooks = fs.readFileSync(
      path.join(root, ".grok", "hooks", "autopilot-harness.json"),
      "utf8",
    );
    fs.writeFileSync(path.join(hooksDir, "autopilot-harness.json"), hooks);
    fs.rmSync(path.join(root, ".grok"), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(root, ".grok"));

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.grok/i);
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

  it("Cursor-only uninstall soft-skips Autopilot Grok hooks under symlinked .grok", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-soft-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-link-"));
    const hooksDir = path.join(outside, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(hooksDir, "autopilot-harness.json"),
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command:
                      "node .autopilot/bin/autopilot-harness-hook.mjs --platform grok-build --event Stop",
                    timeout: 120,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
    );
    fs.symlinkSync(outside, path.join(root, ".grok"));

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.actions.some((a) =>
        /skip \.grok\/hooks\/autopilot-harness\.json/i.test(a),
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

  it("force refresh merges .grok/hooks/** into existing .autopilotignore", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-grok-ignore-"));
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
    const withoutGrok = fs
      .readFileSync(ignorePath, "utf8")
      .split(/\r?\n/)
      .filter((l) => !l.includes(".grok/hooks"))
      .join("\n");
    fs.writeFileSync(
      ignorePath,
      withoutGrok.endsWith("\n") ? withoutGrok : withoutGrok + "\n",
    );

    const add = installInitYes({
      projectRoot: root,
      platform: "grok-build",
      surface: "cli",
      locale: "en",
      force: true,
      mergePlatforms: true,
    });
    expect(add.ok).toBe(true);
    expect(fs.readFileSync(ignorePath, "utf8")).toMatch(/\.grok\/hooks\/\*\*/);
  });
});
