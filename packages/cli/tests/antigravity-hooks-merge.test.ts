import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_AUTOPILOT_EVENTS,
  ANTIGRAVITY_HOOK_BLOCK_NAME,
  ANTIGRAVITY_HOOK_TIMEOUT_SEC,
  ANTIGRAVITY_HOOKS_REL_PATH,
  ANTIGRAVITY_LEGACY_AGENT_DIR,
  ANTIGRAVITY_POST_TOOL_USE_MATCHER,
  antigravityAutopilotHasOmittedOrSmallTimeout,
  antigravityHooksContainAutopilot,
  antigravityHooksFileIsVacant,
  antigravityHooksHavePlatformStamp,
  antigravityHooksUseRelativeCommand,
  antigravityHooksUseShimCommand,
  antigravityAutopilotHasExpectedPostMatcher,
  hasCompleteAntigravityAutopilotHooks,
  mergeAntigravityHooks,
  stripAutopilotAntigravityHooks,
  summarizeAntigravityAutopilotHooks,
  validateAntigravityHooksShape,
} from "../src/init/antigravity-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { uninstallProject } from "../src/uninstall.js";
import {
  formatHostActivationTips,
  formatPostInstallOutro,
} from "../src/init/wizard-helpers.js";

describe("antigravity hooks merge", () => {
  it("creates named autopilot-harness block with PreInvocation/PostToolUse/Stop", () => {
    const merged = mergeAntigravityHooks(null);
    expect(hasCompleteAntigravityAutopilotHooks(merged)).toBe(true);
    expect(antigravityHooksHavePlatformStamp(merged)).toBe(true);
    expect(antigravityAutopilotHasExpectedPostMatcher(merged)).toBe(true);
    expect(antigravityAutopilotHasOmittedOrSmallTimeout(merged)).toBe(false);
    expect(antigravityHooksUseRelativeCommand(merged)).toBe(true);
    expect(ANTIGRAVITY_HOOK_TIMEOUT_SEC).toBe(120);
    expect(ANTIGRAVITY_HOOKS_REL_PATH).toBe(".agents/hooks.json");
    expect(ANTIGRAVITY_HOOK_BLOCK_NAME).toBe("autopilot-harness");
    expect(ANTIGRAVITY_POST_TOOL_USE_MATCHER).toBe(
      "write_to_file|replace_file_content|multi_replace_file_content",
    );
    expect(ANTIGRAVITY_LEGACY_AGENT_DIR).toBe(".agent");

    const block = merged[ANTIGRAVITY_HOOK_BLOCK_NAME] as Record<
      string,
      unknown
    >;
    expect(block.enabled).toBe(true);

    for (const event of ANTIGRAVITY_AUTOPILOT_EVENTS) {
      const entries = block[event] as Array<{
        matcher?: string;
        hooks?: Array<{ type?: string; command?: string; timeout?: number }>;
        type?: string;
        command?: string;
        timeout?: number;
      }>;
      expect(Array.isArray(entries)).toBe(true);
      expect(entries).toHaveLength(1);
      const g = entries[0]!;
      if (event === "PostToolUse") {
        expect(g.matcher).toBe(ANTIGRAVITY_POST_TOOL_USE_MATCHER);
        expect(Array.isArray(g.hooks)).toBe(true);
        expect(g.hooks).toHaveLength(1);
        const h = g.hooks![0]!;
        expect(h.type).toBe("command");
        expect(h.command).toMatch(/node \.agents\/bin\/autopilot-harness-hook\.mjs/);
        expect(h.command).toMatch(/--platform antigravity/);
        expect(h.command).toMatch(/--event PostToolUse/);
        expect(h.timeout).toBe(120);
        expect(g.command).toBeUndefined();
      } else {
        expect(g.matcher).toBeUndefined();
        expect(g.type).toBe("command");
        expect(g.command).toMatch(/node \.agents\/bin\/autopilot-harness-hook\.mjs/);
        expect(g.command).toMatch(/--platform antigravity/);
        expect(g.command).toMatch(new RegExp(`--event ${event}`));
        expect(g.timeout).toBe(120);
      }
    }
  });

  it("rewrites legacy .autopilot/bin commands to .agents/bin shim on merge", () => {
    const legacy = {
      "autopilot-harness": {
        enabled: true,
        PreInvocation: [
          {
            type: "command",
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform antigravity --event PreInvocation",
            timeout: 120,
          },
        ],
        PostToolUse: [
          {
            matcher: ANTIGRAVITY_POST_TOOL_USE_MATCHER,
            hooks: [
              {
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --platform antigravity --event PostToolUse",
                timeout: 120,
              },
            ],
          },
        ],
        Stop: [
          {
            type: "command",
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform antigravity --event Stop",
            timeout: 120,
          },
        ],
      },
    };
    expect(antigravityHooksUseRelativeCommand(legacy)).toBe(true);
    const merged = mergeAntigravityHooks(legacy);
    expect(antigravityHooksUseShimCommand(merged)).toBe(true);
    expect(antigravityHooksUseRelativeCommand(merged)).toBe(true);
    const json = JSON.stringify(merged);
    expect(json).toMatch(/node \.agents\/bin\/autopilot-harness-hook\.mjs/);
    expect(json).not.toMatch(/node \.autopilot\/bin\/autopilot-harness-hook\.mjs/);
    expect(json).not.toMatch(/\.\.\/\.autopilot/);
  });

  it("rejects bare ../.autopilot relative command for doctor gate", () => {
    const bad = mergeAntigravityHooks(null);
    const block = bad[ANTIGRAVITY_HOOK_BLOCK_NAME] as {
      Stop: Array<{ command?: string }>;
    };
    block.Stop[0]!.command =
      "node ../.autopilot/bin/autopilot-harness-hook.mjs --platform antigravity --event Stop";
    expect(antigravityHooksUseRelativeCommand(bad)).toBe(false);
  });

  it("treats wrong/missing PostToolUse matcher as incomplete", () => {
    const good = mergeAntigravityHooks(null);
    expect(antigravityAutopilotHasExpectedPostMatcher(good)).toBe(true);
    const block = good[ANTIGRAVITY_HOOK_BLOCK_NAME] as {
      PostToolUse: Array<{ matcher?: string; hooks?: unknown[] }>;
    };
    block.PostToolUse[0]!.matcher = "run_command";
    expect(antigravityAutopilotHasExpectedPostMatcher(good)).toBe(false);
    expect(hasCompleteAntigravityAutopilotHooks(good)).toBe(false);
    delete block.PostToolUse[0]!.matcher;
    expect(antigravityAutopilotHasExpectedPostMatcher(good)).toBe(false);
  });

  it("treats missing --platform stamp as incomplete", () => {
    const good = mergeAntigravityHooks(null);
    expect(antigravityHooksHavePlatformStamp(good)).toBe(true);
    const block = good[ANTIGRAVITY_HOOK_BLOCK_NAME] as {
      Stop: Array<{ command?: string }>;
      PostToolUse: Array<{ hooks?: Array<{ command?: string }> }>;
    };
    block.Stop[0]!.command =
      "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop";
    block.PostToolUse[0]!.hooks![0]!.command =
      "node .autopilot/bin/autopilot-harness-hook.mjs --event PostToolUse";
    expect(antigravityHooksHavePlatformStamp(good)).toBe(false);
    expect(hasCompleteAntigravityAutopilotHooks(good)).toBe(false);
  });

  it("preserves foreign named blocks; replaces Autopilot handlers", () => {
    const existing = {
      "my-linter-hook": {
        PostToolUse: [
          {
            matcher: "run_command",
            hooks: [{ type: "command", command: "echo lint" }],
          },
        ],
      },
      "autopilot-harness": {
        enabled: false,
        Stop: [
          {
            type: "command",
            command: "echo foreign-stop",
          },
          {
            type: "command",
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
            timeout: 30,
          },
        ],
      },
    };
    const merged = mergeAntigravityHooks(existing);
    expect(JSON.stringify(merged["my-linter-hook"])).toMatch(/echo lint/);
    const block = merged[ANTIGRAVITY_HOOK_BLOCK_NAME] as {
      enabled?: boolean;
      Stop?: unknown;
    };
    expect(block.enabled).toBe(true);
    const stopJson = JSON.stringify(block.Stop);
    expect(stopJson).toMatch(/foreign-stop/);
    expect(stopJson).toMatch(/--platform antigravity/);
    expect(stopJson).not.toMatch(/"timeout":30/);
    const { duplicates } = summarizeAntigravityAutopilotHooks(merged);
    expect(duplicates).toBe(0);
    expect(hasCompleteAntigravityAutopilotHooks(merged)).toBe(true);
  });

  it("merge scrubs Autopilot under a wrong named block (no double-fire)", () => {
    const existing = {
      "wrong-name": {
        Stop: [
          {
            type: "command",
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform antigravity --event Stop",
            timeout: 120,
          },
        ],
      },
    };
    const merged = mergeAntigravityHooks(existing);
    expect(antigravityHooksContainAutopilot(merged)).toBe(true);
    expect(hasCompleteAntigravityAutopilotHooks(merged)).toBe(true);
    // Wrong block no longer carries Autopilot; canonical block owns Stop.
    expect(JSON.stringify(merged["wrong-name"] ?? {})).not.toMatch(
      /autopilot-harness-hook/,
    );
    const block = merged[ANTIGRAVITY_HOOK_BLOCK_NAME] as {
      Stop: Array<{ command?: string }>;
    };
    expect(block.Stop.some((h) =>
      typeof h.command === "string" &&
      h.command.includes("autopilot-harness-hook.mjs") &&
      h.command.includes("--platform antigravity"),
    )).toBe(true);
  });

  it("strip drops malformed Autopilot nests (hooks as object) under foreign blocks", () => {
    const existing = {
      "stray": {
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
    expect(antigravityHooksContainAutopilot(existing)).toBe(true);
    const stripped = stripAutopilotAntigravityHooks(existing);
    expect(antigravityHooksContainAutopilot(stripped)).toBe(false);
  });

  it("rejects malformed hooks object under Autopilot block (fail-closed)", () => {
    const bad = {
      "autopilot-harness": {
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
    expect(validateAntigravityHooksShape(bad)).toMatch(/hooks must be an array/);
    expect(() => stripAutopilotAntigravityHooks(bad)).toThrow(/hooks must be an array/);
  });

  it("rejects Autopilot block with non-array events (fail-closed)", () => {
    const bad = {
      "autopilot-harness": {
        Stop: { command: "node .autopilot/bin/autopilot-harness-hook.mjs" },
      },
    };
    expect(validateAntigravityHooksShape(bad)).toMatch(/must be an array/);
    expect(() => mergeAntigravityHooks(bad)).toThrow(/must be an array/);
  });

  it("strips Autopilot fingerprint; vacant when only Autopilot remains", () => {
    const merged = mergeAntigravityHooks(null);
    expect(antigravityHooksContainAutopilot(merged)).toBe(true);
    expect(antigravityHooksFileIsVacant(merged)).toBe(false);
    const stripped = stripAutopilotAntigravityHooks(merged);
    expect(antigravityHooksContainAutopilot(stripped)).toBe(false);
    expect(antigravityHooksFileIsVacant(stripped)).toBe(true);
    expect(stripped[ANTIGRAVITY_HOOK_BLOCK_NAME]).toBeUndefined();

    const withForeign = mergeAntigravityHooks({
      "keep-me": {
        PreInvocation: [
          { type: "command", command: "echo keep" },
        ],
      },
    });
    const kept = stripAutopilotAntigravityHooks(withForeign);
    expect(antigravityHooksContainAutopilot(kept)).toBe(false);
    expect(antigravityHooksFileIsVacant(kept)).toBe(false);
    expect(JSON.stringify(kept["keep-me"])).toMatch(/echo keep/);
  });

  it("strips Autopilot from foreign named blocks; enabled-only foreign is not vacant", () => {
    const existing = {
      "stray-autopilot": {
        Stop: [
          {
            type: "command",
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform antigravity --event Stop",
            timeout: 120,
          },
        ],
      },
      "enabled-only": { enabled: false },
    };
    expect(antigravityHooksContainAutopilot(existing)).toBe(true);
    const stripped = stripAutopilotAntigravityHooks(existing);
    expect(antigravityHooksContainAutopilot(stripped)).toBe(false);
    expect(stripped["enabled-only"]).toEqual({ enabled: false });
    expect(antigravityHooksFileIsVacant(stripped)).toBe(false);
    // Autopilot-only foreign shell removed after scrub.
    expect(stripped["stray-autopilot"]).toBeUndefined();
  });

  it("Autopilot-only under wrong block name strips to vacant", () => {
    const existing = {
      "wrong-name": {
        PreInvocation: [
          {
            type: "command",
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform antigravity --event PreInvocation",
            timeout: 120,
          },
        ],
      },
    };
    const stripped = stripAutopilotAntigravityHooks(existing);
    expect(antigravityHooksContainAutopilot(stripped)).toBe(false);
    expect(antigravityHooksFileIsVacant(stripped)).toBe(true);
    expect(Object.keys(stripped)).toHaveLength(0);
  });

  it("strip drops non-array Autopilot event values under foreign blocks", () => {
    const existing = {
      stray: {
        Stop: {
          type: "command",
          command:
            "node .autopilot/bin/autopilot-harness-hook.mjs --platform antigravity --event Stop",
        },
      },
    };
    expect(antigravityHooksContainAutopilot(existing)).toBe(true);
    const stripped = stripAutopilotAntigravityHooks(existing);
    expect(antigravityHooksContainAutopilot(stripped)).toBe(false);
    expect(antigravityHooksFileIsVacant(stripped)).toBe(true);
  });

  it("force refresh drops legacy Autopilot handlers (no stack)", () => {
    const existing = {
      "autopilot-harness": {
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
    const merged = mergeAntigravityHooks(existing);
    const block = merged[ANTIGRAVITY_HOOK_BLOCK_NAME] as {
      Stop: Array<{ command?: string }>;
    };
    const json = JSON.stringify(block.Stop);
    expect(json).toMatch(/echo foreign-flat/);
    expect(json).toMatch(/--platform antigravity/);
    const { duplicates } = summarizeAntigravityAutopilotHooks(merged);
    expect(duplicates).toBe(0);
    expect(hasCompleteAntigravityAutopilotHooks(merged)).toBe(true);
  });
});

describe("antigravity init wiring", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("init --platform antigravity writes named hooks + skills + ignore; no .agent/", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-ag-init-"));
    const r = installInitYes({
      projectRoot: root,
      platform: "antigravity",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(true);

    const hooksPath = path.join(root, ".agents", "hooks.json");
    expect(fs.existsSync(hooksPath)).toBe(true);
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(hasCompleteAntigravityAutopilotHooks(file)).toBe(true);
    expect(antigravityHooksHavePlatformStamp(file)).toBe(true);
    expect(antigravityHooksUseRelativeCommand(file)).toBe(true);

    const block = file[ANTIGRAVITY_HOOK_BLOCK_NAME];
    expect(block.enabled).toBe(true);
    expect(block.PostToolUse[0].matcher).toBe(ANTIGRAVITY_POST_TOOL_USE_MATCHER);
    expect(block.PreInvocation[0].matcher).toBeUndefined();
    expect(block.Stop[0].timeout).toBe(120);
    expect(block.Stop[0].command).toMatch(/node \.agents\/bin\//);
    expect(
      fs.existsSync(
        path.join(root, ".agents", "bin", "autopilot-harness-hook.mjs"),
      ),
    ).toBe(true);

    for (const name of [
      "autopilot-on",
      "autopilot-run",
      "autopilot-off",
      "autopilot-resume",
      "autopilot-replan",
    ]) {
      expect(
        fs.existsSync(path.join(root, ".agents", "skills", name, "SKILL.md")),
      ).toBe(true);
    }
    expect(fs.existsSync(path.join(root, ".agent"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".cursor", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.agents\/hooks\.json/);
    expect(ignore).toMatch(/\.agents\/bin\/\*\*/);
    expect(ignore).toMatch(/\.agents\/skills\/\*\*/);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*antigravity/);
    expect(cfg).toMatch(/confirm_rounds:\s*5\b/);

    expect(formatHostActivationTips("antigravity").join("\n")).toMatch(
      /\.agents\/hooks\.json/,
    );
    expect(formatHostActivationTips("antigravity").join("\n")).toMatch(
      /auto-attach|Auto-attach/i,
    );
    expect(formatHostActivationTips("antigravity").join("\n")).toMatch(
      /--add-dir|loaded 0|mount the project workspace/i,
    );
    expect(formatPostInstallOutro("antigravity")).toMatch(/reload|session/i);
    expect(formatPostInstallOutro("antigravity")).toMatch(
      /--add-dir|mount the project workspace/i,
    );

    const qs = fs.readFileSync(
      path.join(root, "docs", "autopilot", "quickstart.md"),
      "utf8",
    );
    expect(qs).toMatch(/`\.agents\/hooks\.json`/);
    expect(qs).toMatch(/`\.agents\/skills`/);
    expect(qs).toMatch(/does not write `\.agent\/`/);
    expect(qs).toMatch(/`--add-dir`|mount the project workspace/i);
    // Longer-first wrap must not split `.agents/skills/autopilot-*` if present.
    expect(qs).not.toMatch(/`\.agents\/skills`\/autopilot/);
  });

  it("add-platform antigravity keeps Cursor hooks and wires .agents", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-ag-add-"));
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
      platform: "antigravity",
      surface: "cli",
      locale: "en",
      force: true,
      mergePlatforms: true,
    });
    expect(add.ok).toBe(true);

    expect(fs.readFileSync(cursorHooks, "utf8")).toBe(beforeCursor);
    const agentsPath = path.join(root, ".agents", "hooks.json");
    expect(fs.existsSync(agentsPath)).toBe(true);
    const file = JSON.parse(fs.readFileSync(agentsPath, "utf8"));
    expect(hasCompleteAntigravityAutopilotHooks(file)).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".agents", "bin", "autopilot-harness-hook.mjs"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".agents", "skills", "autopilot-on", "SKILL.md")),
    ).toBe(true);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*antigravity/);
  });

  it("uninstall strips Autopilot but keeps foreign blocks + skills siblings; vacant unlinks", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-ag-un-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "antigravity",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const agentsDir = path.join(root, ".agents");
    const hooksPath = path.join(agentsDir, "hooks.json");
    const sibling = path.join(agentsDir, "other.json");
    fs.writeFileSync(sibling, '{"keep":true}\n', "utf8");

    const existing = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    existing["foreign-block"] = {
      PreInvocation: [{ type: "command", command: "echo keep-pre" }],
    };
    fs.writeFileSync(hooksPath, JSON.stringify(existing, null, 2) + "\n");

    const un = uninstallProject({ projectRoot: root });
    expect(un.ok).toBe(true);
    expect(fs.existsSync(sibling)).toBe(true);
    expect(JSON.parse(fs.readFileSync(sibling, "utf8")).keep).toBe(true);
    expect(fs.existsSync(hooksPath)).toBe(true);
    expect(
      fs.existsSync(
        path.join(agentsDir, "bin", "autopilot-harness-hook.mjs"),
      ),
    ).toBe(false);
    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    expect(antigravityHooksContainAutopilot(after)).toBe(false);
    expect(JSON.stringify(after["foreign-block"])).toMatch(/echo keep-pre/);
    expect(
      fs.existsSync(path.join(agentsDir, "skills", "autopilot-on")),
    ).toBe(false);

    fs.writeFileSync(
      hooksPath,
      JSON.stringify(mergeAntigravityHooks(null), null, 2) + "\n",
    );
    const un2 = uninstallProject({ projectRoot: root });
    expect(un2.ok).toBe(true);
    expect(fs.existsSync(hooksPath)).toBe(false);
    expect(fs.existsSync(sibling)).toBe(true);
  });

  it("symlink .agents/hooks.json fail-closed on init", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-ag-sym-"));
    const agentsDir = path.join(root, ".agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    const target = path.join(root, "outside-hooks.json");
    fs.writeFileSync(target, "{}\n", "utf8");
    fs.symlinkSync(target, path.join(agentsDir, "hooks.json"));

    const r = installInitYes({
      projectRoot: root,
      platform: "antigravity",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/symlink/i);
  });
});
