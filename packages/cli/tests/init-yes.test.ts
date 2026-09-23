import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skillDescription } from "@autopilot-harness/i18n";
import {
  AUTOPILOT_SKILL_NAMES,
  ensureAutopilotIgnore,
  ensureDocsAutopilotPortal,
  installInitYes,
  mergeHooksJson,
  preflightForceRefresh,
} from "../src/init/install.js";
import { MAX_PLATFORM_BINDINGS } from "../src/init/platforms.js";
import {
  autopilotHookCommandLine,
  autopilotStopHasUnlimitedLoop,
  autopilotSubagentStopHasUnlimitedLoop,
  commandHasPlatformStamp,
} from "../src/init/hooks-merge.js";
import { parseInitReviewScope } from "../src/init/wizard-helpers.js";
import { MAX_UNTRUSTED_TEXT_BYTES } from "../src/read-untrusted-file.js";
import * as readUntrusted from "../src/read-untrusted-file.js";
import { runDoctor } from "../src/status-doctor.js";
import { PACKAGE_VERSION } from "../src/init/types.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-init-"));
}

describe("hooks.json merge", () => {
  it("creates minimal Autopilot hooks when missing", () => {
    const merged = mergeHooksJson(null);
    expect(merged.hooks.beforeSubmitPrompt).toHaveLength(1);
    expect(JSON.stringify(merged)).toMatch(/autopilot-harness/);
    expect(JSON.stringify(merged)).toMatch(/--platform cursor/);
    expect(merged.hooks.afterFileEdit).toHaveLength(1);
    expect(merged.hooks.stop).toHaveLength(1);
    expect(merged.hooks.subagentStop).toHaveLength(1);
  });

  it("sets stop loop_limit null so Cursor does not cap Autopilot chains at 5", () => {
    const merged = mergeHooksJson(null);
    const stop = merged.hooks.stop?.find((h) =>
      h.command.includes("autopilot-harness"),
    );
    expect(stop).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(stop, "loop_limit")).toBe(true);
    expect(stop?.loop_limit).toBeNull();
    const submit = merged.hooks.beforeSubmitPrompt?.[0];
    expect(submit && "loop_limit" in submit).toBe(false);
  });

  it("sets subagentStop loop_limit null (arm-only still needs unlimited host loops)", () => {
    const merged = mergeHooksJson(null);
    const sub = merged.hooks.subagentStop?.find((h) =>
      h.command.includes("autopilot-harness"),
    );
    expect(sub).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(sub, "loop_limit")).toBe(true);
    expect(sub?.loop_limit).toBeNull();
    expect(sub?.command).toMatch(/--event subagentStop(?:\s|$)/);
  });

  it("commandHasPlatformStamp matches token boundaries", () => {
    expect(
      commandHasPlatformStamp(
        "node x.mjs --platform cursor --event stop",
        "cursor",
      ),
    ).toBe(true);
    expect(
      commandHasPlatformStamp(
        "node x.mjs --platform cursor-extra --event stop",
        "cursor",
      ),
    ).toBe(false);
    expect(
      commandHasPlatformStamp(
        "node x.mjs --platform claude-code --event Stop",
        "claude-code",
      ),
    ).toBe(true);
    expect(commandHasPlatformStamp("node x.mjs --event stop", "cursor")).toBe(
      false,
    );
  });

  it("autopilotHookCommandLine rejects unsafe tokens / empty", () => {
    expect(() => autopilotHookCommandLine("cursor;rm -rf", "stop")).toThrow(
      /invalid platform or event/i,
    );
    expect(() => autopilotHookCommandLine("", "stop")).toThrow(
      /invalid platform or event/i,
    );
    expect(() => autopilotHookCommandLine("@@@", "stop")).toThrow(
      /invalid platform or event/i,
    );
    expect(autopilotHookCommandLine("cursor", "stop")).toMatch(
      /--platform cursor --event stop/,
    );
  });

  it("replaces legacy Autopilot stop (no loop_limit) with unlimited stop", () => {
    const existing = {
      version: 1,
      hooks: {
        stop: [
          {
            command: "node .autopilot/bin/autopilot-harness-hook.mjs --event stop",
          },
        ],
      },
    };
    const merged = mergeHooksJson(existing);
    const stops = (merged.hooks.stop ?? []).filter((h) =>
      h.command.includes("autopilot-harness"),
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]?.loop_limit).toBeNull();
    // 0.17 upgrade path: also installs subagentStop with loop_limit null.
    const subs = (merged.hooks.subagentStop ?? []).filter((h) =>
      h.command.includes("autopilot-harness"),
    );
    expect(subs).toHaveLength(1);
    expect(subs[0]?.loop_limit).toBeNull();
    expect(subs[0]?.command).toMatch(/--event subagentStop(?:\s|$)/);
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
    expect(
      merged.hooks.stop?.find((h) => h.command.includes("autopilot-harness"))
        ?.loop_limit,
    ).toBeNull();
    // 0.17: merge also installs Autopilot subagentStop alongside preserved user hooks.
    const subs = (merged.hooks.subagentStop ?? []).filter((h) =>
      h.command.includes("autopilot-harness"),
    );
    expect(subs).toHaveLength(1);
    expect(subs[0]?.loop_limit).toBeNull();
  });
});

describe("autopilotStopHasUnlimitedLoop", () => {
  it("is true only for Autopilot stop with own loop_limit null", () => {
    expect(
      autopilotStopHasUnlimitedLoop({
        hooks: {
          stop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event stop",
              loop_limit: null,
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("is false when loop_limit omitted, numeric, or stop missing", () => {
    expect(autopilotStopHasUnlimitedLoop({ hooks: {} })).toBe(false);
    expect(
      autopilotStopHasUnlimitedLoop({
        hooks: {
          stop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event stop",
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      autopilotStopHasUnlimitedLoop({
        hooks: {
          stop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event stop",
              loop_limit: 5,
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      autopilotStopHasUnlimitedLoop({
        hooks: {
          stop: [{ command: "echo other", loop_limit: null }],
        },
      }),
    ).toBe(false);
  });
});

describe("autopilotSubagentStopHasUnlimitedLoop", () => {
  it("is true only for Autopilot subagentStop with own loop_limit null", () => {
    expect(
      autopilotSubagentStopHasUnlimitedLoop({
        hooks: {
          subagentStop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event subagentStop",
              loop_limit: null,
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("is false when loop_limit omitted, numeric, or event missing", () => {
    expect(autopilotSubagentStopHasUnlimitedLoop({ hooks: {} })).toBe(false);
    expect(
      autopilotSubagentStopHasUnlimitedLoop({
        hooks: {
          subagentStop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event subagentStop",
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      autopilotSubagentStopHasUnlimitedLoop({
        hooks: {
          subagentStop: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --event subagentStop",
              loop_limit: 5,
            },
          ],
        },
      }),
    ).toBe(false);
  });
});

describe("init --yes install", () => {
  let root: string;
  afterEach(() => {
    vi.restoreAllMocks();
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects empty projectRoot (does not resolve to cwd)", () => {
    const r = installInitYes({
      projectRoot: "   ",
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/projectRoot must be a non-empty string/);
  });

  it("preflightForceRefresh rejects empty projectRoot", () => {
    const r = preflightForceRefresh("  ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/projectRoot must be a non-empty string/);
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
    expect(fs.existsSync(path.join(root, ".autopilotignore"))).toBe(true);
    expect(fs.readFileSync(path.join(root, ".autopilotignore"), "utf8")).toMatch(
      /\.autopilot\/\*\*/,
    );
    const pin = JSON.parse(
      fs.readFileSync(path.join(root, ".autopilot", "pin.json"), "utf8"),
    );
    expect(pin["autopilot-harness"]).toBe(PACKAGE_VERSION);

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

    for (const skill of AUTOPILOT_SKILL_NAMES) {
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
    const stopAp = hooks.hooks.stop.find((h: { command: string }) =>
      h.command.includes("autopilot-harness"),
    );
    expect(stopAp?.loop_limit).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(stopAp, "loop_limit")).toBe(
      true,
    );
    const subAp = hooks.hooks.subagentStop.find((h: { command: string }) =>
      h.command.includes("autopilot-harness"),
    );
    expect(subAp?.loop_limit).toBeNull();
    expect(subAp?.command).toMatch(/--platform cursor(?:\s|$)/);
    expect(subAp?.command).toMatch(/--event subagentStop(?:\s|$)/);

    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(config).not.toMatch(/^platform:\s*/m);
    expect(config).toMatch(/platforms:/);
    expect(config).toMatch(/id:\s*cursor/);
    expect(config).toMatch(/surface:\s*ide/);
    expect(config).toMatch(/locale:\s*en/);
    expect(config).toMatch(/plans_dir:\s*docs\/autopilot\/plans/);
    expect(config).toMatch(/specs_dir:\s*docs\/autopilot\/specs/);
    expect(config).toMatch(/confirm_rounds:\s*5/);
    expect(config).toMatch(/max_before_pause:\s*0/);
    expect(config).toMatch(/# When enabled[\s\S]*#\s*commands:/);
    expect(config).toMatch(/enabled:\s*false/);
    const ignoreBody = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignoreBody).toMatch(/^docs\/autopilot\/plans\/\*\*$/m);
    expect(ignoreBody).toMatch(/^docs\/autopilot\/specs\/\*\*$/m);
    expect(
      fs.existsSync(path.join(root, "docs", "autopilot", "specs", "README.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, "docs", "autopilot", "README.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, "docs", "autopilot", "plans", "README.md")),
    ).toBe(true);
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

  it("wx EEXIST on raced symlink is not reported as already initialized", () => {
    root = tmpProject();
    const configPath = path.join(root, ".autopilot", "config.yml");
    const outside = path.join(root, "outside-config.yml");
    const realWrite = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      const opts =
        typeof options === "object" && options !== null
          ? (options as { flag?: string })
          : undefined;
      if (String(file) === configPath && opts?.flag === "wx") {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.symlinkSync(outside, configPath);
        const err = new Error("file already exists") as NodeJS.ErrnoException;
        err.code = "EEXIST";
        throw err;
      }
      return realWrite(file, data as never, options as never);
    });

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
      expect(result.error).not.toMatch(/already initialized/i);
    }
  });

  it("rejects unsupported platform surface for claude-code", () => {
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

  it("inits claude-code with settings.json BLOCK_CAP=0 and skills", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platform: "claude-code",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);

    const settings = JSON.parse(
      fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
    ) as {
      env?: Record<string, string>;
      hooks?: Record<string, unknown>;
    };
    expect(settings.env?.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP).toBe("0");
    expect(JSON.stringify(settings.hooks)).toMatch(/UserPromptSubmit/);
    expect(JSON.stringify(settings.hooks)).toMatch(/PostToolUse/);
    expect(JSON.stringify(settings.hooks)).toMatch(/Edit\|Write\|NotebookEdit/);
    expect(JSON.stringify(settings.hooks)).toMatch(/StopFailure/);
    expect(JSON.stringify(settings.hooks)).toMatch(/SubagentStop/);
    expect(JSON.stringify(settings.hooks)).toMatch(/autopilot-harness-hook/);

    expect(
      fs.existsSync(
        path.join(root, ".claude", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    // Claude-only init must not require Cursor hooks.
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(false);

    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(config).toMatch(/claude-code/);
    expect(config).toMatch(/surface:\s*cli/);
  });

  it("inits codex with .codex/hooks.json matcher, no timeout, Autopilot skills under .agents", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platform: "codex",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);

    const hooksPath = path.join(root, ".codex", "hooks.json");
    expect(fs.existsSync(hooksPath)).toBe(true);
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    const json = JSON.stringify(hooks.hooks);
    expect(json).toMatch(/UserPromptSubmit/);
    expect(json).toMatch(/PostToolUse/);
    expect(json).toMatch(/apply_patch\|Edit\|Write\|exec\|js/);
    expect(json).toMatch(/--platform codex/);
    expect(json).toMatch(/--event Stop/);
    expect(json).not.toMatch(/StopFailure/);
    expect(json).not.toMatch(/"timeout"/);
    // Codex Autopilot skills live under shared .agents/skills (not .codex/skills).
    expect(fs.existsSync(path.join(root, ".codex", "skills"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(false);
    // Never touch config.toml hooks representation.
    expect(fs.existsSync(path.join(root, ".codex", "config.toml"))).toBe(false);

    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(config).toMatch(/id:\s*codex/);
    expect(config).toMatch(/surface:\s*cli/);
  });

  it("add-platform codex merges hooks without dropping Cursor hooks", () => {
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

    const add = installInitYes({
      projectRoot: root,
      platform: "codex",
      surface: "cli",
      platforms: [{ id: "codex", surface: "cli" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    });
    expect(add.ok).toBe(true);

    const cursorHooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    );
    expect(
      cursorHooks.hooks.beforeSubmitPrompt.some((h: { command: string }) =>
        h.command.includes("autopilot-harness"),
      ),
    ).toBe(true);

    const codexHooks = JSON.parse(
      fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"),
    );
    expect(JSON.stringify(codexHooks.hooks)).toMatch(/--platform codex/);
    expect(fs.existsSync(path.join(root, ".codex", "skills"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, ".agents", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);

    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(config).toMatch(/id:\s*cursor/);
    expect(config).toMatch(/id:\s*codex/);
  });

  it("claude-only init ignores corrupt leftover .cursor/hooks.json", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cursor", "hooks.json"), "{not-json");
    const result = installInitYes({
      projectRoot: root,
      platform: "claude-code",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(root, ".claude", "settings.json"))).toBe(
      true,
    );
    expect(fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8")).toBe(
      "{not-json",
    );
  });

  it("codex-only init ignores corrupt leftover .cursor/hooks.json", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    fs.writeFileSync(path.join(root, ".cursor", "hooks.json"), "{not-json");
    const result = installInitYes({
      projectRoot: root,
      platform: "codex",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(root, ".codex", "hooks.json"))).toBe(true);
    expect(fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8")).toBe(
      "{not-json",
    );
  });

  it("--force refreshes codex hooks without duplicating Autopilot or dropping foreign", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "codex",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const hooksPath = path.join(root, ".codex", "hooks.json");
    const existing = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      hooks: Record<string, Array<Record<string, unknown>>>;
    };
    existing.hooks.Stop = [
      ...(existing.hooks.Stop ?? []),
      { hooks: [{ command: "echo foreign-codex-stop" }] },
      // Legacy flat Autopilot that force must scrub (not stack).
      {
        command:
          "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
      },
    ];
    fs.writeFileSync(hooksPath, JSON.stringify(existing, null, 2) + "\n");

    const second = installInitYes({
      projectRoot: root,
      platform: "codex",
      surface: "cli",
      locale: "en",
      force: true,
    });
    expect(second.ok).toBe(true);
    const refreshed = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    const stopJson = JSON.stringify(refreshed.hooks?.Stop);
    expect(stopJson).toMatch(/foreign-codex-stop/);
    expect(stopJson).toMatch(/--platform codex/);
    const autopilotStops = stopJson.match(/autopilot-harness-hook\.mjs/g);
    expect(autopilotStops?.length).toBe(1);
    expect(fs.existsSync(path.join(root, ".codex", "skills"))).toBe(false);
  });

  it("cursor-only init ignores corrupt leftover .claude/settings.json", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), "{not-json");
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    expect(
      fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
    ).toBe("{not-json");
  });

  it("claude-only init ignores leftover .cursor/hooks.json symlink", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".cursor"), { recursive: true });
    const outside = path.join(root, "outside-hooks.json");
    fs.writeFileSync(outside, JSON.stringify({ version: 1, hooks: {} }), "utf8");
    fs.symlinkSync(outside, path.join(root, ".cursor", "hooks.json"));
    const result = installInitYes({
      projectRoot: root,
      platform: "claude-code",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(root, ".claude", "settings.json"))).toBe(
      true,
    );
    expect(fs.lstatSync(path.join(root, ".cursor", "hooks.json")).isSymbolicLink()).toBe(
      true,
    );
  });

  it("dual-host init does not write cursor hooks if claude settings go bad mid-init", () => {
    root = tmpProject();
    const claudeDir = path.join(root, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    const claudePath = path.join(claudeDir, "settings.json");
    fs.writeFileSync(claudePath, JSON.stringify({ hooks: {} }), "utf8");

    const orig = readUntrusted.readUntrustedUtf8File;
    let claudeReads = 0;
    const spy = vi
      .spyOn(readUntrusted, "readUntrustedUtf8File")
      .mockImplementation((filePath, maxBytes, label) => {
        if (path.resolve(String(filePath)) === path.resolve(claudePath)) {
          claudeReads += 1;
          // claudePre ok; claudeFresh (2nd) corrupt — before skills / any write.
          if (claudeReads >= 2) return "{not-json";
        }
        return orig(filePath, maxBytes, label);
      });
    try {
      const result = installInitYes({
        projectRoot: root,
        platforms: [
          { id: "cursor", surface: "ide" },
          { id: "claude-code", surface: "cli" },
        ],
        locale: "en",
        force: false,
      });
      expect(result.ok).toBe(false);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(
        false,
      );
      expect(
        fs.existsSync(path.join(root, ".cursor", "skills", "autopilot-on")),
      ).toBe(false);
      expect(
        fs.existsSync(path.join(root, ".claude", "skills", "autopilot-on")),
      ).toBe(false);
      expect(claudeReads).toBeGreaterThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("dual-host init does not write cursor hooks if codex hooks go bad mid-init", () => {
    root = tmpProject();
    const codexDir = path.join(root, ".codex");
    fs.mkdirSync(codexDir, { recursive: true });
    const codexPath = path.join(codexDir, "hooks.json");
    fs.writeFileSync(codexPath, JSON.stringify({ hooks: {} }), "utf8");

    const orig = readUntrusted.readUntrustedUtf8File;
    let codexReads = 0;
    const spy = vi
      .spyOn(readUntrusted, "readUntrustedUtf8File")
      .mockImplementation((filePath, maxBytes, label) => {
        if (path.resolve(String(filePath)) === path.resolve(codexPath)) {
          codexReads += 1;
          // codexPre ok; codexFresh (2nd) corrupt — before skills / any write.
          if (codexReads >= 2) return "{not-json";
        }
        return orig(filePath, maxBytes, label);
      });
    try {
      const result = installInitYes({
        projectRoot: root,
        platforms: [
          { id: "cursor", surface: "ide" },
          { id: "codex", surface: "cli" },
        ],
        locale: "en",
        force: false,
      });
      expect(result.ok).toBe(false);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(
        false,
      );
      expect(
        fs.existsSync(path.join(root, ".cursor", "skills", "autopilot-on")),
      ).toBe(false);
      expect(fs.existsSync(path.join(root, ".codex", "skills"))).toBe(false);
      expect(codexReads).toBeGreaterThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("dual-host final re-read failure after skills still skips both host writes", () => {
    root = tmpProject();
    const claudeDir = path.join(root, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    const claudePath = path.join(claudeDir, "settings.json");
    fs.writeFileSync(claudePath, JSON.stringify({ hooks: {} }), "utf8");

    const orig = readUntrusted.readUntrustedUtf8File;
    let claudeReads = 0;
    const spy = vi
      .spyOn(readUntrusted, "readUntrustedUtf8File")
      .mockImplementation((filePath, maxBytes, label) => {
        if (path.resolve(String(filePath)) === path.resolve(claudePath)) {
          claudeReads += 1;
          // pre + fresh ok; final re-read after skills (3rd) corrupt.
          if (claudeReads >= 3) return "{not-json";
        }
        return orig(filePath, maxBytes, label);
      });
    try {
      const result = installInitYes({
        projectRoot: root,
        platforms: [
          { id: "cursor", surface: "ide" },
          { id: "claude-code", surface: "cli" },
        ],
        locale: "en",
        force: false,
      });
      expect(result.ok).toBe(false);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(root, ".claude", "settings.json"))).toBe(
        true,
      );
      expect(
        fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
      ).toMatch(/\{\s*"hooks"\s*:\s*\{\s*\}\s*\}/);
      // Skills may already exist; host settings must not be partially written.
      expect(claudeReads).toBeGreaterThanOrEqual(3);
    } finally {
      spy.mockRestore();
    }
  });

  it("force refresh with non-installable claude surface does not require settings.json", () => {
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
    fs.writeFileSync(
      configPath,
      `platforms:
  - id: cursor
    surface: ide
  - id: claude-code
    surface: ide
platform: cursor
surface: ide
locale: en
plans_dir: plans
`,
      "utf8",
    );
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), "{not-json");
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: true,
    });
    expect(result.ok).toBe(true);
    expect(
      fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
    ).toBe("{not-json");
  });

  it("add-platform claude-code merges settings without dropping Cursor hooks", () => {
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

    const add = installInitYes({
      projectRoot: root,
      platform: "claude-code",
      surface: "cli",
      platforms: [{ id: "claude-code", surface: "cli" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    });
    expect(add.ok).toBe(true);

    const hooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    );
    expect(
      hooks.hooks.beforeSubmitPrompt.some((h: { command: string }) =>
        h.command.includes("autopilot-harness"),
      ),
    ).toBe(true);

    const settings = JSON.parse(
      fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP).toBe("0");
    expect(
      fs.existsSync(
        path.join(root, ".claude", "skills", "autopilot-run", "SKILL.md"),
      ),
    ).toBe(true);

    const config = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(config).toMatch(/id:\s*cursor/);
    expect(config).toMatch(/id:\s*claude-code/);
  });

  it("rejects mergePlatforms before init", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      platforms: [{ id: "cursor", surface: "ide" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/before init|--add-platform/i);
    }
  });

  it("mergePlatforms fails closed on corrupt config without rewriting", () => {
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
    const broken = "platform: [unterminated\n";
    fs.writeFileSync(configPath, broken, "utf8");
    const second = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      platforms: [{ id: "cursor", surface: "ide" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toMatch(/Cannot update platforms in config\.yml/i);
    }
    expect(fs.readFileSync(configPath, "utf8")).toBe(broken);
  });

  it("mergePlatforms fails closed at capacity without dropping existing hosts", () => {
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
    const lines = ["platforms:"];
    for (let i = 0; i < MAX_PLATFORM_BINDINGS; i++) {
      lines.push(`  - id: host${i}`);
      lines.push(`    surface: ide`);
    }
    lines.push("platform: host0");
    lines.push("surface: ide");
    lines.push("locale: en");
    const full = `${lines.join("\n")}\n`;
    fs.writeFileSync(configPath, full, "utf8");
    const second = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      platforms: [{ id: "cursor", surface: "ide" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toMatch(/at capacity/i);
    }
    expect(fs.readFileSync(configPath, "utf8")).toBe(full);
  });

  it("mergePlatforms refuses over-cap platforms lists without truncating", () => {
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
    const lines = ["platforms:"];
    lines.push("  - id: cursor");
    lines.push("    surface: ide");
    for (let i = 0; i < MAX_PLATFORM_BINDINGS; i++) {
      lines.push(`  - id: host${i}`);
      lines.push(`    surface: ide`);
    }
    lines.push("platform: cursor");
    lines.push("surface: ide");
    lines.push("locale: en");
    const oversized = `${lines.join("\n")}\n`;
    fs.writeFileSync(configPath, oversized, "utf8");
    // Idempotent add of an already-present installable id must not rewrite+truncate.
    const second = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      platforms: [{ id: "cursor", surface: "ide" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toMatch(/exceeds cap|Cannot update platforms/i);
    }
    expect(fs.readFileSync(configPath, "utf8")).toBe(oversized);
  });

  it("refuses over-cap requested platforms without silent truncate", () => {
    root = tmpProject();
    const many = Array.from({ length: MAX_PLATFORM_BINDINGS + 1 }, (_, i) => ({
      id: i === 0 ? "cursor" : `host${i}`,
      surface: "ide",
    }));
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      platforms: many,
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exceeds cap/i);
    }
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });

  it("mergePlatforms re-reads config before commit (keeps concurrent list edits)", () => {
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

    // During merge, rewrite config after the early validate snapshot would have
    // been taken — commit path must re-read so this declaration is preserved.
    const origRead = readUntrusted.readUntrustedUtf8File;
    let configReads = 0;
    const spy = vi
      .spyOn(readUntrusted, "readUntrustedUtf8File")
      .mockImplementation((filePath, maxBytes, label) => {
        const abs = path.resolve(String(filePath));
        if (abs === path.resolve(configPath)) {
          configReads += 1;
          // Reads before commit: locale resolve + early merge validate.
          // Commit re-read must pick up a concurrent platforms edit.
          if (configReads <= 2) {
            return origRead(filePath, maxBytes, label);
          }
          return `platforms:
  - id: cursor
    surface: ide
  - id: claude-code
    surface: cli
platform: cursor
surface: ide
locale: en
`;
        }
        return origRead(filePath, maxBytes, label);
      });
    try {
      const second = installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        platforms: [{ id: "cursor", surface: "ide" }],
        mergePlatforms: true,
        locale: "en",
        force: true,
      });
      expect(second.ok).toBe(true);
      expect(configReads).toBeGreaterThanOrEqual(2);
      const config = fs.readFileSync(configPath, "utf8");
      expect(config).toMatch(/claude-code/);
      expect(config).toMatch(/id:\s*cursor/);
    } finally {
      spy.mockRestore();
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

  it("refuses to overwrite corrupt .claude/settings.json", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), "{not-json");
    const result = installInitYes({
      projectRoot: root,
      platform: "claude-code",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not valid json/i);
    }
    expect(
      fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
    ).toBe("{not-json");
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });

  it("refuses to overwrite corrupt .codex/hooks.json", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(root, ".codex", "hooks.json"), "{not-json");
    const result = installInitYes({
      projectRoot: root,
      platform: "codex",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not valid json/i);
    }
    expect(fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8")).toBe(
      "{not-json",
    );
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });

  it("refuses when .codex/hooks.json is a symlink", () => {
    root = tmpProject();
    const codexDir = path.join(root, ".codex");
    fs.mkdirSync(codexDir, { recursive: true });
    const hooksPath = path.join(codexDir, "hooks.json");
    const outside = path.join(root, "outside-codex-hooks.json");
    fs.writeFileSync(outside, JSON.stringify({ hooks: {} }), "utf8");
    fs.symlinkSync(outside, hooksPath);
    const result = installInitYes({
      projectRoot: root,
      platform: "codex",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/symlink/i);
    expect(fs.lstatSync(hooksPath).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });

  it("refuses when hooks.json is a symlink", () => {
    root = tmpProject();
    const cursorDir = path.join(root, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    const hooksPath = path.join(cursorDir, "hooks.json");
    const outside = path.join(root, "outside-hooks.json");
    fs.writeFileSync(
      outside,
      JSON.stringify({ version: 1, hooks: {} }),
      "utf8",
    );
    fs.symlinkSync(outside, hooksPath);
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/symlink/i);
    expect(fs.readFileSync(outside, "utf8")).toMatch(/"version"\s*:\s*1/);
  });

  it("refuses when hooks.json is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    const cursorDir = path.join(root, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    const hooksPath = path.join(cursorDir, "hooks.json");
    fs.symlinkSync(path.join(root, "missing-hooks.json"), hooksPath);
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/symlink/i);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });

  it("refuses when plansDir is a dangling symlink (not treated as missing)", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, "docs", "autopilot"), { recursive: true });
    fs.symlinkSync(
      path.join(root, "missing-plans"),
      path.join(root, "docs", "autopilot", "plans"),
    );
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/symlink|plansDir/i);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });

  it("refuses when plansDir is a regular file (not a directory)", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, "docs", "autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "autopilot", "plans"),
      "not-a-dir\n",
      "utf8",
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
      expect(result.error).toMatch(/not a directory|plansDir/i);
    }
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });

  it("refuses when an intermediate plansDir segment is a symlink (no mkdir escape)", () => {
    root = tmpProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ah-plans-esc-"));
    try {
      fs.symlinkSync(outside, path.join(root, "docs"));
      const result = installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        plansDir: "docs/plans",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/symlink/i);
      expect(fs.existsSync(path.join(outside, "plans"))).toBe(false);
      expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses when .autopilot parent chain would escape via symlink after mkdir", () => {
    root = tmpProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ah-ap-esc-"));
    try {
      // Pre-create .autopilot as a pointing symlink so mkdirRealDirSync
      // assertNotSymlink / realpath check fails closed before writes.
      fs.symlinkSync(outside, path.join(root, ".autopilot"));
      const result = installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/symlink/i);
      expect(fs.existsSync(path.join(outside, "config.yml"))).toBe(false);
      expect(fs.existsSync(path.join(outside, "pin.json"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses when config.yml path is a directory", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".autopilot", "config.yml"), {
      recursive: true,
    });
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
  });

  it("refuses when hooks.json is too large", () => {
    root = tmpProject();
    const cursorDir = path.join(root, ".cursor");
    fs.mkdirSync(cursorDir, { recursive: true });
    const hooksPath = path.join(cursorDir, "hooks.json");
    // Cap is 1_000_000; write slightly over to fail closed before parse.
    fs.writeFileSync(hooksPath, "x".repeat(1_000_001), "utf8");
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large|Cannot read/i);
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

  it("--force refreshes hook; strips legacy platform/surface but keeps other keys", () => {
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
      "platform: cursor\nsurface: ide\nlocale: zh-CN\n# user-edit\n",
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
    expect(kept).toMatch(/platforms:/);
    expect(kept).toMatch(/id:\s*cursor/);
    expect(kept).not.toMatch(/^platform:\s*/m);
    expect(kept).not.toMatch(/^surface:\s*/m);
    expect(
      fs.existsSync(
        path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs"),
      ),
    ).toBe(true);
    // Skills follow config.yml locale, not the CLI --locale flag.
    const skill = fs.readFileSync(
      path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain(skillDescription("zh-CN", "autopilot-on"));
  });

  it("--force leaves modern config.yml untouched when no legacy scalars", () => {
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
    const before = `platforms:
  - id: cursor
    surface: ide
locale: zh-CN
# user-edit
`;
    fs.writeFileSync(configPath, before, "utf8");
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: true,
      }).ok,
    ).toBe(true);
    expect(fs.readFileSync(configPath, "utf8")).toBe(before);
  });

  it("fresh --yes defaults review.scope to project", () => {
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
    const yaml = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(yaml).toMatch(/scope:\s*project/);
    expect(yaml).not.toMatch(/scope:\s*executing_only/);
  });

  it("honors reviewScope executing_only on fresh init", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        reviewScope: "executing_only",
      }).ok,
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(root, ".autopilot", "config.yml"), "utf8"),
    ).toMatch(/scope:\s*executing_only/);
  });

  it("--force does not rewrite existing review.scope", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        reviewScope: "executing_only",
      }).ok,
    ).toBe(true);
    const configPath = path.join(root, ".autopilot", "config.yml");
    const before = fs.readFileSync(configPath, "utf8");
    expect(before).toMatch(/scope:\s*executing_only/);
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: true,
        reviewScope: "project",
      }).ok,
    ).toBe(true);
    expect(fs.readFileSync(configPath, "utf8")).toBe(before);
  });

  it("init with custom plansDir covers it in .autopilotignore", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        plansDir: "work/plans",
      }).ok,
    ).toBe(true);
    const ignore = fs.readFileSync(
      path.join(root, ".autopilotignore"),
      "utf8",
    );
    expect(ignore).toMatch(/^work\/plans\/\*\*$/m);
    expect(
      fs.readFileSync(path.join(root, ".autopilot", "config.yml"), "utf8"),
    ).toMatch(/plans_dir:\s*work\/plans/);
  });

  it("force refresh merges configured plans_dir into .autopilotignore", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
        plansDir: "work/plans",
      }).ok,
    ).toBe(true);
    // Simulate older ignore that only had default plans/**
    fs.writeFileSync(
      path.join(root, ".autopilotignore"),
      "plans/**\n.autopilot/**\n",
      "utf8",
    );
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: true,
        // Intentionally omit plansDir — must read from config.yml
      }).ok,
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(root, ".autopilotignore"), "utf8"),
    ).toMatch(/^work\/plans\/\*\*$/m);
  });
});

describe("parseInitReviewScope", () => {
  it("defaults blank/omitted to project and rejects unknown values", () => {
    expect(parseInitReviewScope(undefined)).toEqual({
      ok: true,
      value: "project",
    });
    expect(parseInitReviewScope("")).toEqual({ ok: true, value: "project" });
    expect(parseInitReviewScope("project")).toEqual({
      ok: true,
      value: "project",
    });
    expect(parseInitReviewScope("executing_only")).toEqual({
      ok: true,
      value: "executing_only",
    });
    expect(parseInitReviewScope("PROJECT")).toEqual({
      ok: true,
      value: "project",
    });
    expect(parseInitReviewScope("all")).toEqual({
      ok: true,
      value: "project",
    });
    expect(parseInitReviewScope("always")).toEqual({
      ok: true,
      value: "project",
    });
    expect(parseInitReviewScope("bogus").ok).toBe(false);
  });
});

describe("ensureAutopilotIgnore merge", () => {
  let root = "";
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  const templatesRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../templates",
  );

  it("does not re-add patterns the user commented out", () => {
    root = tmpProject();
    fs.writeFileSync(
      path.join(root, ".autopilotignore"),
      "plans/**\n# *.png\n",
      "utf8",
    );
    const rel = ensureAutopilotIgnore(root, templatesRoot);
    expect(rel).toBe(".autopilotignore");
    const body = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(body).toMatch(/# \*\.png/);
    // Active *.png must not appear as a non-comment merged line.
    const activePng = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l === "*.png");
    expect(activePng).toHaveLength(0);
    expect(body).toMatch(/\.autopilot\/\*\*/);
  });

  it("skips merge when existing ignore is present but unreadable", () => {
    root = tmpProject();
    const dest = path.join(root, ".autopilotignore");
    fs.writeFileSync(dest, "plans/**\n" + "x".repeat(2_000_000), "utf8");
    const before = fs.readFileSync(dest, "utf8");
    const rel = ensureAutopilotIgnore(root, templatesRoot);
    expect(rel).toBeNull();
    expect(fs.readFileSync(dest, "utf8")).toBe(before);
  });

  it("skips merge when existing ignore is a symlink (does not abort)", () => {
    root = tmpProject();
    const dest = path.join(root, ".autopilotignore");
    const target = path.join(root, "ignore-target");
    fs.writeFileSync(target, "plans/**\n", "utf8");
    fs.symlinkSync(target, dest);
    const rel = ensureAutopilotIgnore(root, templatesRoot);
    expect(rel).toBeNull();
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toBe("plans/**\n");
  });

  it("skips merge when appending defaults would exceed the size cap", () => {
    root = tmpProject();
    const dest = path.join(root, ".autopilotignore");
    // Pad with a comment (not an active glob) so parse would stay cheap if
    // runtime ever loaded this fixture; stay just under the read cap so merge
    // appendix would push past MAX and must be skipped.
    const header = "custom-only/**\n#";
    const fillerLen =
      MAX_UNTRUSTED_TEXT_BYTES - Buffer.byteLength(header + "\n", "utf8") - 40;
    const prefix = header + "y".repeat(fillerLen) + "\n";
    fs.writeFileSync(dest, prefix, "utf8");
    const before = fs.readFileSync(dest, "utf8");
    expect(Buffer.byteLength(before, "utf8")).toBeLessThanOrEqual(
      MAX_UNTRUSTED_TEXT_BYTES,
    );
    expect(Buffer.byteLength(before, "utf8")).toBeGreaterThan(
      MAX_UNTRUSTED_TEXT_BYTES - 100,
    );
    const rel = ensureAutopilotIgnore(root, templatesRoot);
    expect(rel).toBeNull();
    expect(fs.readFileSync(dest, "utf8")).toBe(before);
  });

  it("fresh write includes custom plansDir/**", () => {
    root = tmpProject();
    const rel = ensureAutopilotIgnore(root, templatesRoot, "work/plans");
    expect(rel).toBe(".autopilotignore");
    const body = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(body).toMatch(/^plans\/\*\*$/m);
    expect(body).toMatch(/^work\/plans\/\*\*$/m);
    expect(body).toMatch(/^docs\/autopilot\/specs\/\*\*$/m);
  });

  it("merges custom plansDir/** into existing ignore", () => {
    root = tmpProject();
    fs.writeFileSync(
      path.join(root, ".autopilotignore"),
      "plans/**\n.autopilot/**\n",
      "utf8",
    );
    const rel = ensureAutopilotIgnore(root, templatesRoot, "docs/plans");
    expect(rel).toBe(".autopilotignore");
    const body = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(body).toMatch(/^docs\/plans\/\*\*$/m);
  });

  it("does not re-add custom plansDir when user commented it out", () => {
    root = tmpProject();
    fs.writeFileSync(
      path.join(root, ".autopilotignore"),
      "plans/**\n# work/plans/**\n",
      "utf8",
    );
    ensureAutopilotIgnore(root, templatesRoot, "work/plans");
    // May still merge other template lines, but must not activate work/plans/**
    const body = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    const active = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l === "work/plans/**");
    expect(active).toHaveLength(0);
    expect(body).toMatch(/#\s*work\/plans\/\*\*/);
  });

  it("invalid plansDir falls back to default plans path without injecting raw input", () => {
    root = tmpProject();
    const rel = ensureAutopilotIgnore(root, templatesRoot, "../escape");
    expect(rel).toBe(".autopilotignore");
    const body = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(body).toMatch(/^docs\/autopilot\/plans\/\*\*$/m);
    expect(body).not.toMatch(/\.\.\/escape/);
  });

  it("blank specsDir falls back to default specs path (not plans/)", () => {
    root = tmpProject();
    const rel = ensureAutopilotIgnore(root, templatesRoot, "work/plans", "  ");
    expect(rel).toBe(".autopilotignore");
    const body = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(body).toMatch(/^work\/plans\/\*\*$/m);
    expect(body).toMatch(/^docs\/autopilot\/specs\/\*\*$/m);
    // Blank must not be treated as core's empty→"plans" fail-open.
    expect(body).not.toMatch(/# artifacts\.specs_dir \(plans\)/);
  });

  it("blank specsDir near size cap slim-merge still covers default specs/**", () => {
    root = tmpProject();
    const dest = path.join(root, ".autopilotignore");
    const header = "custom-only/**\n";
    const slimTail =
      "\n# --- merged artifacts.plans_dir/specs_dir (upgrade/init) ---\nwork/plans/**\ndocs/autopilot/specs/**\n";
    const fillerLen =
      MAX_UNTRUSTED_TEXT_BYTES -
      Buffer.byteLength(header, "utf8") -
      Buffer.byteLength(slimTail, "utf8") -
      20;
    fs.writeFileSync(dest, header + "z".repeat(Math.max(fillerLen, 1)) + "\n", "utf8");
    const rel = ensureAutopilotIgnore(root, templatesRoot, "work/plans", "\t");
    expect(rel).toBe(".autopilotignore");
    const body = fs.readFileSync(dest, "utf8");
    expect(body).toMatch(/^work\/plans\/\*\*$/m);
    expect(body).toMatch(/^docs\/autopilot\/specs\/\*\*$/m);
    expect(body).not.toMatch(
      /# --- merged artifacts\.plans_dir\/specs_dir \(upgrade\/init\) ---\nwork\/plans\/\*\*\nplans\/\*\*/,
    );
  });

  it("near size cap still merges plansDir/** when full template merge cannot fit", () => {
    root = tmpProject();
    const dest = path.join(root, ".autopilotignore");
    // Large existing file with room for short plansDir + specsDir slim lines only.
    const header = "custom-only/**\n";
    const slimTail =
      "\n# --- merged artifacts.plans_dir/specs_dir (upgrade/init) ---\nwork/plans/**\ndocs/autopilot/specs/**\n";
    const fillerLen =
      MAX_UNTRUSTED_TEXT_BYTES -
      Buffer.byteLength(header, "utf8") -
      Buffer.byteLength(slimTail, "utf8") -
      20;
    fs.writeFileSync(dest, header + "z".repeat(Math.max(fillerLen, 1)) + "\n", "utf8");
    const beforeLen = Buffer.byteLength(fs.readFileSync(dest), "utf8");
    expect(beforeLen).toBeLessThanOrEqual(MAX_UNTRUSTED_TEXT_BYTES);
    const rel = ensureAutopilotIgnore(root, templatesRoot, "work/plans");
    expect(rel).toBe(".autopilotignore");
    const body = fs.readFileSync(dest, "utf8");
    expect(body).toMatch(/^work\/plans\/\*\*$/m);
    expect(body).toMatch(/^docs\/autopilot\/specs\/\*\*$/m);
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(
      MAX_UNTRUSTED_TEXT_BYTES,
    );
  });

  it("near size cap prefers plansDir alone when both slim lines cannot fit", () => {
    root = tmpProject();
    const dest = path.join(root, ".autopilotignore");
    const header = "custom-only/**\n";
    const bothTail =
      "\n# --- merged artifacts.plans_dir/specs_dir (upgrade/init) ---\nwork/plans/**\ndocs/autopilot/specs/**\n";
    const plansOnlyTail =
      "\n# --- merged artifacts.plans_dir/specs_dir (upgrade/init) ---\nwork/plans/**\n";
    // Room for plans-only slim write, but not plans+specs together.
    const fillerLen =
      MAX_UNTRUSTED_TEXT_BYTES -
      Buffer.byteLength(header, "utf8") -
      Buffer.byteLength(plansOnlyTail, "utf8") -
      5;
    fs.writeFileSync(dest, header + "z".repeat(Math.max(fillerLen, 1)) + "\n", "utf8");
    const before = Buffer.byteLength(fs.readFileSync(dest), "utf8");
    expect(before + Buffer.byteLength(bothTail, "utf8")).toBeGreaterThan(
      MAX_UNTRUSTED_TEXT_BYTES,
    );
    const rel = ensureAutopilotIgnore(root, templatesRoot, "work/plans");
    expect(rel).toBe(".autopilotignore");
    const body = fs.readFileSync(dest, "utf8");
    expect(body).toMatch(/^work\/plans\/\*\*$/m);
    expect(body).not.toMatch(/^docs\/autopilot\/specs\/\*\*$/m);
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(
      MAX_UNTRUSTED_TEXT_BYTES,
    );
  });
});

describe("ensureDocsAutopilotPortal", () => {
  let root = "";
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("refuses empty projectRoot", () => {
    expect(() =>
      ensureDocsAutopilotPortal("", "docs/autopilot/plans", "docs/autopilot/specs"),
    ).toThrow(/projectRoot must be a non-empty string/);
  });

  it("writes portal + specs README once (idempotent)", () => {
    root = tmpProject();
    const first = ensureDocsAutopilotPortal(
      root,
      "docs/autopilot/plans",
      "docs/autopilot/specs",
    );
    expect(first).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/docs[/\\]autopilot[/\\]README\.md$/),
        expect.stringMatching(/docs[/\\]autopilot[/\\]specs[/\\]README\.md$/),
      ]),
    );
    const second = ensureDocsAutopilotPortal(
      root,
      "docs/autopilot/plans",
      "docs/autopilot/specs",
    );
    expect(second).toEqual([]);
  });
});
