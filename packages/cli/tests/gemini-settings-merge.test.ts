import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GEMINI_AFTER_TOOL_MATCHER,
  GEMINI_AUTOPILOT_EVENTS,
  GEMINI_HOOK_NAME_PREFIX,
  GEMINI_HOOK_TIMEOUT_MS,
  GEMINI_SETTINGS_REL_PATH,
  GEMINI_WILDCARD_MATCHER,
  geminiAutopilotHasSmallTimeout,
  geminiHooksHavePlatformStamp,
  geminiSettingsContainAutopilot,
  geminiSettingsHaveForeignContent,
  geminiSettingsFileIsVacant,
  hasCompleteGeminiAutopilotHooks,
  mergeGeminiSettings,
  stripAutopilotGeminiSettings,
  summarizeGeminiAutopilotHooks,
  validateGeminiSettingsShape,
  geminiHooksConfigEnabledIsFalse,
  geminiAutopilotNamesInHooksConfigDisabled,
} from "../src/init/gemini-settings-merge.js";
import { installInitYes } from "../src/init/install.js";
import { uninstallProject } from "../src/uninstall.js";
import {
  formatHostActivationTips,
  formatPostInstallOutro,
  writeQuickstart,
} from "../src/init/wizard-helpers.js";

describe("gemini settings merge", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates BeforeAgent/AfterTool/AfterAgent with name, stamp, timeout 120000, matchers", () => {
    const merged = mergeGeminiSettings(null);
    expect(hasCompleteGeminiAutopilotHooks(merged)).toBe(true);
    expect(geminiHooksHavePlatformStamp(merged)).toBe(true);
    expect(geminiAutopilotHasSmallTimeout(merged)).toBe(false);
    expect(GEMINI_HOOK_TIMEOUT_MS).toBe(120_000);
    expect(GEMINI_SETTINGS_REL_PATH).toBe(".gemini/settings.json");
    expect(GEMINI_AFTER_TOOL_MATCHER).toBe("write_file|replace");
    expect(JSON.stringify(merged.hooks)).not.toMatch(/StopFailure/);

    for (const event of GEMINI_AUTOPILOT_EVENTS) {
      const groups = merged.hooks?.[event];
      expect(Array.isArray(groups)).toBe(true);
      expect(groups).toHaveLength(1);
      const g = groups![0]!;
      expect(Array.isArray(g.hooks)).toBe(true);
      expect(g.hooks).toHaveLength(1);
      const h = g.hooks![0]!;
      expect(h.name).toBe(`${GEMINI_HOOK_NAME_PREFIX}-${event}`);
      expect(h.type).toBe("command");
      expect(h.command).toMatch(/autopilot-harness-hook\.mjs/);
      expect(h.command).toMatch(/--platform gemini-cli/);
      expect(h.command).toMatch(new RegExp(`--event ${event}`));
      expect(h.timeout).toBe(GEMINI_HOOK_TIMEOUT_MS);
      if (event === "AfterTool") {
        expect(g.matcher).toBe(GEMINI_AFTER_TOOL_MATCHER);
      } else {
        expect(g.matcher).toBe(GEMINI_WILDCARD_MATCHER);
      }
    }
  });

  it("preserves foreign hooks, hooksConfig, general; does not rewrite hooksConfig", () => {
    const existing = {
      general: { preferredEditor: "vscode" },
      hooksConfig: { enabled: true, disabled: ["other-hook"] },
      mcpServers: { demo: { command: "echo" } },
      hooks: {
        AfterAgent: [
          {
            matcher: "*",
            hooks: [
              { name: "foreign", type: "command", command: "echo foreign" },
              {
                name: "autopilot-harness-AfterAgent",
                type: "command",
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --platform gemini-cli --event AfterAgent",
                timeout: 1000,
              },
            ],
          },
        ],
        SessionStart: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "echo session" }],
          },
        ],
      },
    };
    const hooksConfigBefore = JSON.stringify(existing.hooksConfig);
    const merged = mergeGeminiSettings(existing);
    expect(merged.general).toEqual(existing.general);
    expect(JSON.stringify(merged.hooksConfig)).toBe(hooksConfigBefore);
    expect(merged.mcpServers).toEqual(existing.mcpServers);
    expect(merged.hooks?.SessionStart).toEqual(existing.hooks.SessionStart);
    const after = merged.hooks?.AfterAgent as Array<{
      hooks: Array<{ name?: string; command?: string; timeout?: number }>;
    }>;
    expect(after.some((g) => g.hooks.some((h) => h.command === "echo foreign"))).toBe(
      true,
    );
    const ap = after
      .flatMap((g) => g.hooks)
      .filter((h) => h.name?.startsWith("autopilot-harness-"));
    expect(ap).toHaveLength(1);
    expect(ap[0]!.timeout).toBe(GEMINI_HOOK_TIMEOUT_MS);
  });

  it("merge is idempotent (no duplicate Autopilot handlers)", () => {
    const once = mergeGeminiSettings(null);
    const twice = mergeGeminiSettings(once);
    expect(hasCompleteGeminiAutopilotHooks(twice)).toBe(true);
    expect(summarizeGeminiAutopilotHooks(twice).duplicates).toBe(0);
    for (const event of GEMINI_AUTOPILOT_EVENTS) {
      const groups = twice.hooks?.[event] as Array<{
        hooks?: Array<{ name?: string }>;
      }>;
      const ap = (groups ?? [])
        .flatMap((g) => g.hooks ?? [])
        .filter((h) => h.name?.startsWith("autopilot-harness-"));
      expect(ap).toHaveLength(1);
    }
    const withForeign = mergeGeminiSettings({
      hooks: {
        AfterAgent: [
          {
            matcher: "*",
            hooks: [{ name: "keep", type: "command", command: "echo keep" }],
          },
        ],
      },
    });
    const again = mergeGeminiSettings(withForeign);
    expect(summarizeGeminiAutopilotHooks(again).duplicates).toBe(0);
    const after = again.hooks?.AfterAgent as Array<{
      hooks: Array<{ command?: string }>;
    }>;
    expect(after.some((g) => g.hooks.some((h) => h.command === "echo keep"))).toBe(
      true,
    );
  });

  it("rejects flat handlers and unsafe keys (fail-closed)", () => {
    expect(
      validateGeminiSettingsShape({
        hooks: {
          BeforeAgent: [
            {
              type: "command",
              command: "echo flat",
            } as never,
          ],
        },
      }),
    ).toMatch(/nested matcher groups/i);

    expect(
      validateGeminiSettingsShape({
        hooks: {
          BeforeAgent: [
            {
              type: "command",
              command: "echo disguised",
              hooks: [],
            } as never,
          ],
        },
      }),
    ).toMatch(/nested matcher groups/i);

    expect(
      validateGeminiSettingsShape({
        hooks: {
          BeforeAgent: [
            {
              command: 1,
              hooks: [{ type: "command", command: "echo ok" }],
            } as never,
          ],
        },
      }),
    ).toMatch(/nested matcher groups/i);

    expect(
      validateGeminiSettingsShape({
        hooks: {
          BeforeAgent: [
            {
              matcher: "*",
              hooks: [{ constructor: 1, command: "echo" } as never],
            },
          ],
        },
      }),
    ).toMatch(/not allowed/i);

    expect(() =>
      mergeGeminiSettings({
        hooks: {
          BeforeAgent: [{ type: "command", command: "echo flat" } as never],
        },
      }),
    ).toThrow(/nested/i);

    expect(
      validateGeminiSettingsShape({ constructor: 1 } as never),
    ).toMatch(/not allowed/i);
  });

  it("strip removes name+command fingerprints; foreign content kept", () => {
    const merged = mergeGeminiSettings({
      hooksConfig: { enabled: false },
      hooks: {
        BeforeAgent: [
          {
            matcher: "*",
            hooks: [{ name: "keep", type: "command", command: "echo keep" }],
          },
        ],
      },
    });
    expect(geminiSettingsContainAutopilot(merged)).toBe(true);
    const stripped = stripAutopilotGeminiSettings(merged);
    expect(geminiSettingsContainAutopilot(stripped)).toBe(false);
    expect(geminiSettingsHaveForeignContent(stripped)).toBe(true);
    expect(geminiSettingsFileIsVacant(stripped)).toBe(false);
    expect(stripped.hooksConfig).toEqual({ enabled: false });
    expect(summarizeGeminiAutopilotHooks(stripped).missingEvents).toEqual([
      ...GEMINI_AUTOPILOT_EVENTS,
    ]);
  });

  it("vacant treats empty/null hooks as unlinkable; foreign hooks keep file", () => {
    expect(geminiSettingsFileIsVacant(null)).toBe(true);
    expect(geminiSettingsFileIsVacant({})).toBe(true);
    expect(geminiSettingsFileIsVacant({ hooks: null })).toBe(true);
    expect(geminiSettingsFileIsVacant({ hooks: {} })).toBe(true);
    expect(geminiSettingsHaveForeignContent({ hooks: {} })).toBe(false);
    expect(
      geminiSettingsFileIsVacant({
        hooks: {
          SessionStart: [
            { matcher: "*", hooks: [{ type: "command", command: "echo" }] },
          ],
        },
      }),
    ).toBe(false);
    const onlyAp = stripAutopilotGeminiSettings(mergeGeminiSettings(null));
    expect(geminiSettingsFileIsVacant(onlyAp)).toBe(true);
    expect(geminiSettingsHaveForeignContent(onlyAp)).toBe(false);
  });

  it("init --platform gemini-cli writes settings + skills + ignore", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-gem-init-"));
    const result = installInitYes({
      projectRoot: root,
      platform: "gemini-cli",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);
    const settingsPath = path.join(root, ".gemini", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(hasCompleteGeminiAutopilotHooks(settings)).toBe(true);
    expect(geminiHooksHavePlatformStamp(settings)).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".gemini", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.gemini\/settings\.json/);
    expect(ignore).toMatch(/\.gemini\/skills\/\*\*/);
  });

  it("init symlink settings.json fail-closed", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-gem-sym-"));
    const geminiDir = path.join(root, ".gemini");
    fs.mkdirSync(geminiDir, { recursive: true });
    const target = path.join(root, "outside-settings.json");
    fs.writeFileSync(target, "{}\n");
    fs.symlinkSync(target, path.join(geminiDir, "settings.json"));
    const result = installInitYes({
      projectRoot: root,
      platform: "gemini-cli",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/symlink/i);
  });

  it("add-platform gemini-cli keeps Cursor; uninstall strips but keeps foreign settings", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-gem-add-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: true,
        mergePlatforms: true,
      }).ok,
    ).toBe(true);
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    const settingsPath = path.join(root, ".gemini", "settings.json");
    const before = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    before.hooksConfig = { enabled: true };
    before.hooks.SessionStart = [
      { matcher: "*", hooks: [{ type: "command", command: "echo keep" }] },
    ];
    fs.writeFileSync(settingsPath, JSON.stringify(before, null, 2) + "\n");

    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(true);
    expect(fs.existsSync(settingsPath)).toBe(true);
    const after = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(geminiSettingsContainAutopilot(after)).toBe(false);
    expect(after.hooksConfig).toEqual({ enabled: true });
    expect(after.hooks?.SessionStart).toBeTruthy();
  });

  it("wizard tips mention re-trust, hooks panel, folder trust, skills reload", () => {
    expect(formatPostInstallOutro("gemini-cli")).toMatch(/folder trust/i);
    expect(formatPostInstallOutro("gemini-cli")).toMatch(/\/hooks panel/);
    expect(formatPostInstallOutro("gemini-cli")).toMatch(/\.gemini\/skills/);
    const tips = formatHostActivationTips("gemini-cli").join("\n");
    expect(tips).toMatch(/re-trust|\/hooks panel|folder trust/i);
    expect(tips).toMatch(/120000/);
    expect(tips).toMatch(/\.gemini\/skills/);
    expect(tips).toMatch(/\/skills reload/);
  });

  it("writeQuickstart wraps /hooks panel without mangling via generic /hooks", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-gem-qs-"));
    const rel = writeQuickstart(root, "en", "plans", "gemini-cli");
    expect(rel).toBeTruthy();
    const body = fs.readFileSync(path.join(root, rel!), "utf8");
    expect(body).toContain("`/hooks panel`");
    expect(body).not.toMatch(/``\/hooks` panel`/);
    expect(body).toMatch(/`\.gemini\/skills`/);
    expect(body).not.toMatch(/`\.gemini`\s*\/\s*`skills`/);
    expect(body).toContain("`/skills reload`");
  });

  it("uninstall unlinks settings when only Autopilot content remains", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-gem-unlink-"));
    expect(
      installInitYes({
        projectRoot: root,
        platform: "gemini-cli",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const settingsPath = path.join(root, ".gemini", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".gemini", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(true);
    expect(fs.existsSync(settingsPath)).toBe(false);
    expect(fs.existsSync(path.join(root, ".gemini", "skills", "autopilot-on"))).toBe(
      false,
    );
  });

  it("detects hooksConfig.enabled===false and Autopilot names in disabled", () => {
    const base = mergeGeminiSettings(null);
    expect(geminiHooksConfigEnabledIsFalse(base)).toBe(false);
    expect(geminiAutopilotNamesInHooksConfigDisabled(base)).toEqual([]);

    const disabledFalse = {
      ...base,
      hooksConfig: { enabled: false, disabled: ["other"] },
    };
    expect(geminiHooksConfigEnabledIsFalse(disabledFalse)).toBe(true);
    expect(geminiAutopilotNamesInHooksConfigDisabled(disabledFalse)).toEqual(
      [],
    );

    const named = {
      ...base,
      hooksConfig: {
        enabled: true,
        disabled: [
          "autopilot-harness-AfterAgent",
          "keep-me",
          "autopilot-harness-custom",
        ],
      },
    };
    expect(geminiAutopilotNamesInHooksConfigDisabled(named)).toEqual([
      "autopilot-harness-AfterAgent",
    ]);

    const legacyMap = {
      ...base,
      hooksConfig: {
        disabled: {
          "autopilot-harness-BeforeAgent": true,
          "foreign-hook": true,
          "autopilot-harness-AfterTool": false,
          "autopilot-harness-legacy-Stop": true,
        },
      },
    };
    expect(geminiAutopilotNamesInHooksConfigDisabled(legacyMap)).toEqual([
      "autopilot-harness-BeforeAgent",
    ]);

    const legacyHooksDisabled = {
      ...base,
      hooks: {
        ...(base.hooks as object),
        disabled: ["autopilot-harness-AfterTool", "keep-me"],
      },
    };
    expect(
      geminiAutopilotNamesInHooksConfigDisabled(legacyHooksDisabled),
    ).toEqual(["autopilot-harness-AfterTool"]);
    expect(validateGeminiSettingsShape(legacyHooksDisabled)).toBeNull();

    const mergedLegacy = mergeGeminiSettings(legacyHooksDisabled);
    expect(mergedLegacy.hooks?.disabled).toEqual([
      "autopilot-harness-AfterTool",
      "keep-me",
    ]);
    // Merge must not alias the caller's disabled list.
    (legacyHooksDisabled.hooks as { disabled: string[] }).disabled.push("mut");
    expect(mergedLegacy.hooks?.disabled).toEqual([
      "autopilot-harness-AfterTool",
      "keep-me",
    ]);

    const strippedLegacy = stripAutopilotGeminiSettings(mergedLegacy);
    expect(geminiSettingsContainAutopilot(strippedLegacy)).toBe(false);
    expect(strippedLegacy.hooks?.disabled).toEqual([
      "autopilot-harness-AfterTool",
      "keep-me",
    ]);
    expect(geminiSettingsFileIsVacant(strippedLegacy)).toBe(false);
    (mergedLegacy.hooks as { disabled: string[] }).disabled.push("mut2");
    expect(strippedLegacy.hooks?.disabled).toEqual([
      "autopilot-harness-AfterTool",
      "keep-me",
    ]);
  });
});
