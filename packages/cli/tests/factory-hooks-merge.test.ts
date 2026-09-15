import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FACTORY_AUTOPILOT_EVENTS,
  FACTORY_HOOK_TIMEOUT_SEC,
  FACTORY_HOOKS_REL_PATH,
  FACTORY_POST_TOOL_USE_MATCHER,
  factoryAutopilotHasOmittedOrSmallTimeout,
  factoryHooksContainAutopilot,
  factoryHooksFileIsVacant,
  factoryHooksHavePlatformStamp,
  factoryHooksUseProjectDirEnv,
  hasCompleteFactoryAutopilotHooks,
  mergeFactoryHooks,
  readFactorySettingsFlags,
  stripAutopilotFactoryHooks,
  summarizeFactoryAutopilotHooks,
  validateFactoryHooksShape,
} from "../src/init/factory-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { uninstallProject } from "../src/uninstall.js";
import {
  formatHostActivationTips,
  formatPostInstallOutro,
} from "../src/init/wizard-helpers.js";

describe("factory hooks merge", () => {
  it("creates UPS/PostToolUse/Stop at top level with stamp, timeout 120, $FACTORY_PROJECT_DIR", () => {
    const merged = mergeFactoryHooks(null);
    expect(hasCompleteFactoryAutopilotHooks(merged)).toBe(true);
    expect(factoryHooksHavePlatformStamp(merged)).toBe(true);
    expect(factoryAutopilotHasOmittedOrSmallTimeout(merged)).toBe(false);
    expect(factoryHooksUseProjectDirEnv(merged)).toBe(true);
    expect(FACTORY_HOOK_TIMEOUT_SEC).toBe(120);
    expect(FACTORY_HOOKS_REL_PATH).toBe(".factory/hooks.json");
    expect(FACTORY_POST_TOOL_USE_MATCHER).toBe("Create|Edit|ApplyPatch");
    expect(merged.hooks).toBeUndefined();

    for (const event of FACTORY_AUTOPILOT_EVENTS) {
      const groups = merged[event];
      expect(Array.isArray(groups)).toBe(true);
      expect(groups).toHaveLength(1);
      const g = (groups as { matcher?: string; hooks?: Array<{ type?: string; command?: string; timeout?: number }> })[0]!;
      expect(Array.isArray(g.hooks)).toBe(true);
      expect(g.hooks).toHaveLength(1);
      const h = g.hooks![0]!;
      expect(h.type).toBe("command");
      expect(h.command).toMatch(/autopilot-harness-hook\.mjs/);
      expect(h.command).toMatch(/\$FACTORY_PROJECT_DIR/);
      expect(h.command).toMatch(/--platform factory-droid/);
      expect(h.command).toMatch(new RegExp(`--event ${event}`));
      expect(h.timeout).toBe(FACTORY_HOOK_TIMEOUT_SEC);
      if (event === "PostToolUse") {
        expect(g.matcher).toBe(FACTORY_POST_TOOL_USE_MATCHER);
      } else {
        expect(g.matcher).toBeUndefined();
      }
    }
  });

  it("preserves foreign top-level events and metadata; replaces Autopilot", () => {
    const existing = {
      description: "keep-me",
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
    };
    const merged = mergeFactoryHooks(existing);
    expect(merged.description).toBe("keep-me");
    expect(JSON.stringify(merged.SessionStart)).toMatch(/echo session/);
    const stopJson = JSON.stringify(merged.Stop);
    expect(stopJson).toMatch(/foreign-stop/);
    expect(stopJson).toMatch(/--platform factory-droid/);
    expect(stopJson).toMatch(/\$FACTORY_PROJECT_DIR/);
    expect(stopJson).not.toMatch(/"timeout":30/);
    const { duplicates } = summarizeFactoryAutopilotHooks(merged);
    expect(duplicates).toBe(0);
    expect(hasCompleteFactoryAutopilotHooks(merged)).toBe(true);
  });

  it("rejects Autopilot under nested hooks wrap (fail-closed)", () => {
    const wrapped = {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --platform factory-droid --event Stop",
              },
            ],
          },
        ],
      },
    };
    expect(validateFactoryHooksShape(wrapped)).toMatch(/top-level event keys/);
    expect(() => mergeFactoryHooks(wrapped)).toThrow(/top-level event keys/);
  });

  it("rejects Autopilot under nested hooks as flat handler or bare string", () => {
    const flat = {
      hooks: {
        Stop: {
          type: "command",
          command:
            "node .autopilot/bin/autopilot-harness-hook.mjs --platform factory-droid --event Stop",
        },
      },
    };
    expect(validateFactoryHooksShape(flat)).toMatch(/top-level event keys/);
    expect(factoryHooksContainAutopilot(flat)).toBe(true);

    const bare = {
      hooks: {
        Stop: "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
      },
    };
    expect(validateFactoryHooksShape(bare)).toMatch(/top-level event keys/);
    expect(factoryHooksContainAutopilot(bare)).toBe(true);
  });

  it("rejects Autopilot when nested group.hooks is a malformed object", () => {
    const malformed = {
      hooks: {
        Stop: [
          {
            hooks: {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
            },
          },
        ],
      },
    };
    expect(validateFactoryHooksShape(malformed)).toMatch(/top-level event keys/);
    expect(factoryHooksContainAutopilot(malformed)).toBe(true);
  });

  it("rejects null matcher groups in foreign top-level arrays (fail-closed)", () => {
    const hostile = { SessionStart: [null] };
    expect(validateFactoryHooksShape(hostile as never)).toMatch(
      /non-object matcher group/,
    );
    expect(() => mergeFactoryHooks(hostile as never)).toThrow(
      /non-object matcher group/,
    );
  });

  it("rejects non-array Autopilot event keys", () => {
    expect(validateFactoryHooksShape({ Stop: "nope" } as never)).toMatch(
      /must be an array/,
    );
  });

  it("rejects stranded Autopilot flat under non-event top-level keys", () => {
    const flat = {
      leftover: {
        command:
          "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
      },
    };
    expect(validateFactoryHooksShape(flat)).toMatch(
      /must be under a top-level event array/,
    );
    expect(factoryHooksContainAutopilot(flat)).toBe(true);
  });

  it("does not treat description text mentioning the hook filename as Autopilot", () => {
    const meta = {
      description:
        "See autopilot-harness-hook.mjs docs; not an installed hook command.",
    };
    expect(validateFactoryHooksShape(meta)).toBeNull();
    expect(factoryHooksContainAutopilot(meta)).toBe(false);
    const merged = mergeFactoryHooks(meta);
    expect(merged.description).toBe(meta.description);
    expect(hasCompleteFactoryAutopilotHooks(merged)).toBe(true);
  });

  it("does not treat prose under nested hooks bag values as Autopilot", () => {
    const prose = {
      hooks: {
        Stop: "See autopilot-harness-hook.mjs in the docs (not a command).",
      },
    };
    expect(validateFactoryHooksShape(prose)).toBeNull();
    expect(factoryHooksContainAutopilot(prose)).toBe(false);
  });

  it("still rejects nested bare Autopilot command-line strings", () => {
    const bareCmd = {
      hooks: {
        Stop:
          'node "$FACTORY_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --event Stop',
      },
    };
    expect(validateFactoryHooksShape(bareCmd)).toMatch(/top-level event keys/);
    expect(factoryHooksContainAutopilot(bareCmd)).toBe(true);
  });

  it("drops empty foreign arrays after scrubbing Autopilot-only leftovers", () => {
    const merged = mergeFactoryHooks({
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event SessionStart",
            },
          ],
        },
      ],
    });
    expect(merged.SessionStart).toBeUndefined();
    expect(hasCompleteFactoryAutopilotHooks(merged)).toBe(true);
  });

  it("allows nested hooks wrap without Autopilot (foreign shape)", () => {
    const foreignWrap = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo only-foreign" }] }],
      },
    };
    expect(validateFactoryHooksShape(foreignWrap)).toBeNull();
    const merged = mergeFactoryHooks(foreignWrap);
    expect(JSON.stringify(merged.hooks)).toMatch(/echo only-foreign/);
    expect(hasCompleteFactoryAutopilotHooks(merged)).toBe(true);
    expect(Array.isArray(merged.Stop)).toBe(true);
  });

  it("strips Autopilot fingerprint; vacant when only Autopilot remains", () => {
    const merged = mergeFactoryHooks(null);
    expect(factoryHooksContainAutopilot(merged)).toBe(true);
    expect(factoryHooksFileIsVacant(merged)).toBe(false);
    const stripped = stripAutopilotFactoryHooks(merged);
    expect(factoryHooksContainAutopilot(stripped)).toBe(false);
    expect(factoryHooksFileIsVacant(stripped)).toBe(true);

    const withForeign = mergeFactoryHooks({
      UserPromptSubmit: [
        {
          hooks: [{ type: "command", command: "echo keep" }],
        },
      ],
    });
    const kept = stripAutopilotFactoryHooks(withForeign);
    expect(factoryHooksContainAutopilot(kept)).toBe(false);
    expect(factoryHooksFileIsVacant(kept)).toBe(false);
    expect(JSON.stringify(kept.UserPromptSubmit)).toMatch(/echo keep/);
  });

  it("force refresh drops legacy flat Autopilot command groups (no stack)", () => {
    const existing = {
      Stop: [
        {
          command:
            "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
          timeout: 30,
        },
        { command: "echo foreign-flat" },
      ],
    };
    const merged = mergeFactoryHooks(existing);
    const stop = (merged.Stop ?? []) as Array<{
      command?: string;
      hooks?: unknown;
    }>;
    const json = JSON.stringify(stop);
    expect(json).toMatch(/echo foreign-flat/);
    expect(json).toMatch(/--platform factory-droid/);
    const { duplicates } = summarizeFactoryAutopilotHooks(merged);
    expect(duplicates).toBe(0);
    expect(hasCompleteFactoryAutopilotHooks(merged)).toBe(true);
    expect(
      stop.some(
        (g) =>
          typeof g.command === "string" &&
          g.command.includes("autopilot-harness-hook.mjs") &&
          !Array.isArray(g.hooks),
      ),
    ).toBe(false);
  });

  it("readFactorySettingsFlags detects hooksDisabled / org / nested Autopilot", () => {
    const flags = readFactorySettingsFlags({
      hooksDisabled: true,
      allowManagedHooksOnly: true,
      hooks: {
        Stop: [
          {
            hooks: [
              {
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
              },
            ],
          },
        ],
      },
    });
    expect(flags.hooksDisabled).toBe(true);
    expect(flags.allowManagedHooksOnly).toBe(true);
    expect(flags.hooksContainAutopilot).toBe(true);
    expect(readFactorySettingsFlags(null).hooksDisabled).toBe(false);
  });
});

describe("factory init wiring", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("init --platform factory-droid writes top-level hooks + ignore; no skills; no rounds clamp", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-factory-init-"));
    const r = installInitYes({
      projectRoot: root,
      platform: "factory-droid",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(true);

    const hooksPath = path.join(root, ".factory", "hooks.json");
    expect(fs.existsSync(hooksPath)).toBe(true);
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(hasCompleteFactoryAutopilotHooks(file)).toBe(true);
    expect(factoryHooksHavePlatformStamp(file)).toBe(true);
    expect(factoryHooksUseProjectDirEnv(file)).toBe(true);
    expect(file.hooks).toBeUndefined();
    expect(file.PostToolUse[0].matcher).toBe(FACTORY_POST_TOOL_USE_MATCHER);
    expect(file.UserPromptSubmit[0].matcher).toBeUndefined();
    expect(file.Stop[0].matcher).toBeUndefined();
    expect(file.Stop[0].hooks[0].timeout).toBe(120);
    expect(file.Stop[0].hooks[0].command).toMatch(/\$FACTORY_PROJECT_DIR/);

    expect(fs.existsSync(path.join(root, ".cursor", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.factory\/hooks\.json/);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*factory-droid/);
    expect(cfg).toMatch(/match:\s*line_start/);
    expect(cfg).not.toMatch(/confirm_rounds:\s*1\b/);
    expect(cfg).toMatch(/confirm_rounds:\s*5\b/);

    expect(formatHostActivationTips("factory-droid").join("\n")).toMatch(
      /\.factory\/hooks\.json/,
    );
    expect(formatHostActivationTips("factory-droid").join("\n")).toMatch(
      /\$FACTORY_PROJECT_DIR|FACTORY_PROJECT_DIR/,
    );
    expect(formatPostInstallOutro("factory-droid")).toMatch(/\/hooks/);
    expect(formatPostInstallOutro("factory-droid")).toMatch(
      /reload|snapshot|new session/i,
    );

    const qs = fs.readFileSync(
      path.join(root, "docs", "autopilot", "quickstart.md"),
      "utf8",
    );
    expect(qs).toMatch(/`\.factory\/hooks\.json`/);
    expect(qs).toMatch(/`\$FACTORY_PROJECT_DIR`/);
    expect(qs).toMatch(/`\/hooks`/);
    expect(qs).not.toMatch(/\.factory`\/hooks`/);
  });

  it("add-platform factory-droid keeps Cursor hooks and wires Factory file", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-factory-add-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const cursorHooks = path.join(root, ".cursor", "hooks.json");
    expect(fs.existsSync(cursorHooks)).toBe(true);
    const beforeCursor = fs.readFileSync(cursorHooks, "utf8");

    const add = installInitYes({
      projectRoot: root,
      platform: "factory-droid",
      surface: "cli",
      locale: "en",
      force: true,
      mergePlatforms: true,
    });
    expect(add.ok).toBe(true);

    expect(fs.readFileSync(cursorHooks, "utf8")).toBe(beforeCursor);
    const factoryPath = path.join(root, ".factory", "hooks.json");
    expect(fs.existsSync(factoryPath)).toBe(true);
    const file = JSON.parse(fs.readFileSync(factoryPath, "utf8"));
    expect(hasCompleteFactoryAutopilotHooks(file)).toBe(true);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*factory-droid/);
  });

  it("uninstall strips Autopilot but keeps foreign hooks + .factory siblings; vacant unlinks", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-factory-un-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "factory-droid",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const factoryDir = path.join(root, ".factory");
    const hooksPath = path.join(factoryDir, "hooks.json");
    const sibling = path.join(factoryDir, "other.json");
    fs.writeFileSync(sibling, '{"keep":true}\n', "utf8");

    const existing = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    existing.UserPromptSubmit.push({
      hooks: [{ type: "command", command: "echo keep-ups" }],
    });
    fs.writeFileSync(hooksPath, JSON.stringify(existing, null, 2) + "\n");

    const un = uninstallProject({ projectRoot: root });
    expect(un.ok).toBe(true);
    expect(fs.existsSync(sibling)).toBe(true);
    expect(JSON.parse(fs.readFileSync(sibling, "utf8")).keep).toBe(true);
    expect(fs.existsSync(hooksPath)).toBe(true);
    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(factoryHooksContainAutopilot(after)).toBe(false);
    expect(JSON.stringify(after.UserPromptSubmit)).toMatch(/echo keep-ups/);

    // Vacant after second strip of foreign-free Autopilot-only reinstall.
    fs.writeFileSync(
      hooksPath,
      JSON.stringify(mergeFactoryHooks(null), null, 2) + "\n",
    );
    const un2 = uninstallProject({ projectRoot: root });
    expect(un2.ok).toBe(true);
    expect(fs.existsSync(hooksPath)).toBe(false);
    expect(fs.existsSync(sibling)).toBe(true);
  });

  it("symlink .factory/hooks.json fail-closed on init", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-factory-sym-"));
    const factoryDir = path.join(root, ".factory");
    fs.mkdirSync(factoryDir, { recursive: true });
    const target = path.join(root, "outside-hooks.json");
    fs.writeFileSync(target, "{}\n", "utf8");
    fs.symlinkSync(target, path.join(factoryDir, "hooks.json"));

    const r = installInitYes({
      projectRoot: root,
      platform: "factory-droid",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/symlink/i);
  });

  it("init fail-closed when existing hooks.json has Autopilot under nested wrap", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-factory-wrap-"));
    const factoryDir = path.join(root, ".factory");
    const hooksPath = path.join(factoryDir, "hooks.json");
    fs.mkdirSync(factoryDir, { recursive: true });
    const nestedOnly = {
      hooks: {
        Stop: [
          {
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
    };
    fs.writeFileSync(
      hooksPath,
      JSON.stringify(nestedOnly, null, 2) + "\n",
      "utf8",
    );

    const r = installInitYes({
      projectRoot: root,
      platform: "factory-droid",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/top-level event keys/);
    // Preflight refuses before config.yml / hooks rewrite (dir mkdir alone is OK).
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(after.hooks?.Stop).toBeTruthy();
    expect(after.Stop).toBeUndefined();
  });
});
