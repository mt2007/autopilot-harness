import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HERMES_AUTOPILOT_EVENTS,
  HERMES_HOOK_TIMEOUT_SEC,
  HERMES_MAX_VERIFY_NUDGES,
  HERMES_POST_TOOL_MATCHER,
  ensureHermesMaxVerifyNudges,
  formatHermesConfigYaml,
  hasCompleteHermesAutopilotHooks,
  hermesAutopilotHasOmittedOrSmallTimeout,
  hermesConfigHasVerifyNudgeFloor,
  hermesConfigYamlContainsAutopilot,
  hermesConfigYamlPath,
  hermesHooksContainAutopilot,
  hermesHooksHavePlatformStamp,
  mergeHermesConfig,
  mergeHermesConfigYaml,
  parseHermesConfigYaml,
  resolveHermesHome,
  stripAutopilotHermesConfigYaml,
  stripAutopilotHermesHooks,
} from "../src/init/hermes-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import {
  formatHostActivationTips,
  formatPostInstallOutro,
} from "../src/init/wizard-helpers.js";

describe("hermes hooks merge", () => {
  let root = "";
  let hermesHome = "";
  const prevHome = process.env.HERMES_HOME;

  afterEach(() => {
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
      root = "";
    }
    if (hermesHome) {
      fs.rmSync(hermesHome, { recursive: true, force: true });
      hermesHome = "";
    }
    if (prevHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = prevHome;
  });

  it("creates pre_llm_call/post_tool_call/pre_verify with stamp, timeout 120, relative command, nudge 32", () => {
    const merged = mergeHermesConfig(null);
    expect(hasCompleteHermesAutopilotHooks(merged)).toBe(true);
    expect(hermesHooksHavePlatformStamp(merged)).toBe(true);
    expect(hermesAutopilotHasOmittedOrSmallTimeout(merged)).toBe(false);
    expect(hermesConfigHasVerifyNudgeFloor(merged)).toBe(true);
    expect(HERMES_HOOK_TIMEOUT_SEC).toBe(120);
    expect(HERMES_MAX_VERIFY_NUDGES).toBe(32);
    expect(HERMES_POST_TOOL_MATCHER).toBe("write_file|patch");
    expect(merged.hooks_auto_accept).toBeUndefined();

    for (const event of HERMES_AUTOPILOT_EVENTS) {
      const entries = merged.hooks![event] as Array<{
        command?: string;
        timeout?: number;
        matcher?: string;
      }>;
      expect(Array.isArray(entries)).toBe(true);
      expect(entries).toHaveLength(1);
      const h = entries[0]!;
      expect(h.command).toBe(
        `node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event ${event}`,
      );
      expect(h.command).not.toMatch(/\$HERMES_HOME|\$\{|~\//);
      expect(h.timeout).toBe(HERMES_HOOK_TIMEOUT_SEC);
      if (event === "post_tool_call") {
        expect(h.matcher).toBe(HERMES_POST_TOOL_MATCHER);
      } else {
        expect(h.matcher).toBeUndefined();
      }
    }
  });

  it("preserves sibling top-level keys + reserved hooks subsections; replaces Autopilot", () => {
    const existing = parseHermesConfigYaml(`
model:
  default: keep-me
agent:
  max_verify_nudges: 3
  verify_guidance: do-not-touch
hooks_auto_accept: true
hooks:
  output_spill:
    enabled: true
  outbound:
    url: https://example.invalid/hook
  pre_llm_call:
    - command: echo foreign-pre
      timeout: 5
    - command: node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call
      timeout: 30
  pre_tool_call:
    - command: echo keep-pre-tool
`);
    const merged = mergeHermesConfig(existing);
    expect(merged.model).toEqual({ default: "keep-me" });
    expect(merged.hooks_auto_accept).toBe(true);
    expect((merged.agent as { verify_guidance?: string }).verify_guidance).toBe(
      "do-not-touch",
    );
    expect((merged.agent as { max_verify_nudges?: number }).max_verify_nudges).toBe(
      32,
    );
    expect(merged.hooks!.output_spill).toEqual({ enabled: true });
    expect(merged.hooks!.outbound).toEqual({
      url: "https://example.invalid/hook",
    });
    const pre = merged.hooks!.pre_llm_call as unknown[];
    expect(pre).toHaveLength(2);
    expect(
      (pre[0] as { command: string }).command,
    ).toBe("echo foreign-pre");
    expect(hermesHooksHavePlatformStamp(merged)).toBe(true);
    expect(
      ((merged.hooks!.pre_tool_call as unknown[])[0] as { command: string })
        .command,
    ).toBe("echo keep-pre-tool");
  });

  it("raises nudge when missing/low; does not lower higher user value", () => {
    const low = ensureHermesMaxVerifyNudges({
      agent: { max_verify_nudges: 3 },
    });
    expect(
      (low.agent as { max_verify_nudges: number }).max_verify_nudges,
    ).toBe(32);
    const high = ensureHermesMaxVerifyNudges({
      agent: { max_verify_nudges: 64, verify_guidance: "x" },
    });
    expect(
      (high.agent as { max_verify_nudges: number }).max_verify_nudges,
    ).toBe(64);
    expect((high.agent as { verify_guidance: string }).verify_guidance).toBe(
      "x",
    );
    // YAML may load numbers as strings — do not clobber a higher string value.
    const highStr = ensureHermesMaxVerifyNudges({
      agent: { max_verify_nudges: "64" },
    });
    expect(
      (highStr.agent as { max_verify_nudges: number }).max_verify_nudges,
    ).toBe(64);
    const lowStr = ensureHermesMaxVerifyNudges({
      agent: { max_verify_nudges: "10" },
    });
    expect(
      (lowStr.agent as { max_verify_nudges: number }).max_verify_nudges,
    ).toBe(32);
  });

  it("strip drops null event slots; format ends with newline", () => {
    const stripped = stripAutopilotHermesHooks({
      hooks: {
        pre_llm_call: null,
        post_tool_call: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event post_tool_call",
          },
        ],
      },
    });
    expect(stripped.hooks).toBeUndefined();
    const yaml = formatHermesConfigYaml(mergeHermesConfig(null));
    expect(yaml.endsWith("\n")).toBe(true);
  });

  it("merge drops null entries inside event lists and keeps foreign hooks", () => {
    const merged = mergeHermesConfig({
      hooks: {
        pre_llm_call: [
          null,
          { command: "echo keep-foreign", timeout: 5 },
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call",
            timeout: 30,
          },
        ],
      },
    });
    const pre = merged.hooks!.pre_llm_call as Array<{ command?: string } | null>;
    expect(pre.every((e) => e != null && typeof e === "object")).toBe(true);
    expect(pre).toHaveLength(2);
    expect(pre[0]!.command).toBe("echo keep-foreign");
    expect(pre[1]!.command).toMatch(/--platform hermes-agent/);
  });

  it("merge restores missing post_tool_call matcher on Autopilot refresh", () => {
    const merged = mergeHermesConfig({
      hooks: {
        post_tool_call: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event post_tool_call",
            timeout: 120,
          },
        ],
      },
    });
    const post = merged.hooks!.post_tool_call as Array<{ matcher?: string }>;
    expect(post).toHaveLength(1);
    expect(post[0]!.matcher).toBe(HERMES_POST_TOOL_MATCHER);
    expect(hermesHooksHavePlatformStamp(merged)).toBe(true);
  });

  it("stripAutopilotHermesConfigYaml keeps siblings/reserved; does not invent agent", () => {
    const stripped = stripAutopilotHermesConfigYaml(`
model:
  default: keep
hooks:
  output_spill:
    enabled: true
  pre_llm_call:
    - command: node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call
      timeout: 120
`);
    const p = parseHermesConfigYaml(stripped);
    expect(p.model).toEqual({ default: "keep" });
    expect(p.hooks!.output_spill).toEqual({ enabled: true });
    expect(p.hooks!.pre_llm_call).toBeUndefined();
    expect(p.agent).toBeUndefined();
  });

  it("strip removes Autopilot and drops empty event lists", () => {
    const merged = mergeHermesConfig(null);
    const stripped = stripAutopilotHermesHooks(merged);
    expect(hermesHooksContainAutopilot(stripped)).toBe(false);
    expect(stripped.hooks).toBeUndefined();
  });

  it("resolveHermesHome prefers HERMES_HOME; never cli-config.yaml", () => {
    hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-home-"));
    process.env.HERMES_HOME = hermesHome;
    expect(resolveHermesHome()).toBe(path.resolve(hermesHome));
    expect(hermesConfigYamlPath()).toBe(path.join(hermesHome, "config.yaml"));
    expect(hermesConfigYamlPath()).not.toMatch(/cli-config/);
  });

  it("init --platform hermes-agent writes $HERMES_HOME/config.yaml; no rounds clamp", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-init-"));
    hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-inithome-"));
    process.env.HERMES_HOME = hermesHome;

    const r = installInitYes({
      projectRoot: root,
      platform: "hermes-agent",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(true);
    const yamlPath = hermesConfigYamlPath(hermesHome);
    expect(fs.existsSync(yamlPath)).toBe(true);
    const cfg = parseHermesConfigYaml(fs.readFileSync(yamlPath, "utf8"));
    expect(hasCompleteHermesAutopilotHooks(cfg)).toBe(true);
    expect(hermesHooksHavePlatformStamp(cfg)).toBe(true);
    expect(hermesConfigHasVerifyNudgeFloor(cfg)).toBe(true);
    expect(cfg.hooks_auto_accept).toBeUndefined();
    const projectCfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(projectCfg).toMatch(/confirm_rounds:\s*5/);
    expect(projectCfg).not.toMatch(/confirm_rounds:\s*1/);
    expect(formatPostInstallOutro("hermes-agent")).toMatch(/HERMES_HOME|hermes hooks doctor/i);
    expect(formatHostActivationTips("hermes-agent").join("\n")).toMatch(
      /max_verify_nudges|hermes hooks doctor/i,
    );
    const qs = fs.readFileSync(
      path.join(root, "docs", "autopilot", "quickstart.md"),
      "utf8",
    );
    expect(qs).toMatch(/Autopilot ON|triggers\.on/i);
    // Markdown wraps must not split cli-config.yaml / $HERMES_HOME/config.yaml.
    expect(qs).toMatch(/`\$HERMES_HOME\/config\.yaml`/);
    expect(qs).toMatch(/`cli-config\.yaml`/);
    expect(qs).toMatch(/`agent\.max_verify_nudges`/);
    expect(qs).not.toMatch(/agent\.`max_verify_nudges`/);
    expect(qs).not.toMatch(/`cli-`/);
    expect(qs).not.toMatch(/`\$HERMES_HOME`\s*\/\s*`config\.yaml`/);
  });

  it("add-platform hermes-agent keeps Cursor hooks and wires Hermes config", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-add-"));
    hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-addhome-"));
    process.env.HERMES_HOME = hermesHome;

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
      platform: "hermes-agent",
      surface: "cli",
      platforms: [{ id: "hermes-agent", surface: "cli" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    });
    expect(add.ok).toBe(true);
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    const cfg = parseHermesConfigYaml(
      fs.readFileSync(hermesConfigYamlPath(hermesHome), "utf8"),
    );
    expect(hermesHooksHavePlatformStamp(cfg)).toBe(true);
    const projectCfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(projectCfg).toMatch(/id:\s*cursor/);
    expect(projectCfg).toMatch(/id:\s*hermes-agent/);
  });

  it("--force refreshes Hermes yaml without stacking or dropping foreign hooks", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-force-"));
    hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-forcehome-"));
    process.env.HERMES_HOME = hermesHome;

    expect(
      installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const yamlPath = hermesConfigYamlPath(hermesHome);
    const seeded = mergeHermesConfig(
      parseHermesConfigYaml(fs.readFileSync(yamlPath, "utf8")),
    );
    const hooks = seeded.hooks as Record<string, unknown>;
    hooks.pre_llm_call = [
      ...(hooks.pre_llm_call as unknown[]),
      { command: "echo foreign-hermes-keep", timeout: 5 },
    ];
    fs.writeFileSync(yamlPath, formatHermesConfigYaml(seeded), "utf8");

    const refreshed = installInitYes({
      projectRoot: root,
      platform: "hermes-agent",
      surface: "cli",
      locale: "en",
      force: true,
    });
    expect(refreshed.ok).toBe(true);
    const cfg = parseHermesConfigYaml(fs.readFileSync(yamlPath, "utf8"));
    const pre = cfg.hooks!.pre_llm_call as Array<{ command: string }>;
    expect(pre.some((e) => e.command === "echo foreign-hermes-keep")).toBe(
      true,
    );
    expect(
      pre.filter((e) => e.command.includes("autopilot-harness-hook.mjs")),
    ).toHaveLength(1);
    expect(hermesHooksHavePlatformStamp(cfg)).toBe(true);
    expect(hermesAutopilotHasOmittedOrSmallTimeout(cfg)).toBe(false);
  });

  it("symlink config.yaml fail-closed on init", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-sym-"));
    hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-symhome-"));
    process.env.HERMES_HOME = hermesHome;
    const target = path.join(hermesHome, "elsewhere.yaml");
    fs.writeFileSync(target, "model: x\n", "utf8");
    fs.symlinkSync(target, hermesConfigYamlPath(hermesHome));

    const r = installInitYes({
      projectRoot: root,
      platform: "hermes-agent",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/symlink/i);
    }
  });

  it("mergeHermesConfigYaml round-trips empty + hostile shape refuse", () => {
    const yaml = mergeHermesConfigYaml("");
    expect(yaml).toMatch(/pre_llm_call/);
    expect(yaml).toMatch(/max_verify_nudges:\s*32/);
    expect(() =>
      mergeHermesConfigYaml("hooks:\n  pre_llm_call: not-a-list\n"),
    ).toThrow(/must be a list/i);
    expect(() => mergeHermesConfig(new Map() as never)).toThrow(/mapping/i);
    expect(() =>
      mergeHermesConfig({ hooks: new Map() as never }),
    ).toThrow(/hooks.*mapping/i);
  });

  it("timeout numeric strings are not treated as omitted/small", () => {
    const file = {
      hooks: {
        pre_llm_call: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call",
            timeout: "120",
          },
        ],
        post_tool_call: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event post_tool_call",
            timeout: 120,
            matcher: HERMES_POST_TOOL_MATCHER,
          },
        ],
        pre_verify: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_verify",
            timeout: 120,
          },
        ],
      },
    };
    expect(hermesAutopilotHasOmittedOrSmallTimeout(file)).toBe(false);
  });

  it("desynced --event under wrong YAML key is incomplete / unstamped", () => {
    const desynced = {
      hooks: {
        pre_llm_call: [
          {
            // List key says pre_llm_call but argv stamps pre_verify.
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_verify",
            timeout: 120,
          },
        ],
        post_tool_call: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event post_tool_call",
            timeout: 120,
            matcher: HERMES_POST_TOOL_MATCHER,
          },
        ],
        pre_verify: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_verify",
            timeout: 120,
          },
        ],
      },
    };
    expect(hasCompleteHermesAutopilotHooks(desynced)).toBe(false);
    expect(hermesHooksHavePlatformStamp(desynced)).toBe(false);
    expect(hermesHooksContainAutopilot(desynced)).toBe(true);
    const fixed = mergeHermesConfig(desynced);
    expect(hasCompleteHermesAutopilotHooks(fixed)).toBe(true);
    expect(hermesHooksHavePlatformStamp(fixed)).toBe(true);
  });

  it("post_tool_call without Autopilot matcher is incomplete", () => {
    const noMatcher = {
      hooks: {
        pre_llm_call: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call",
            timeout: 120,
          },
        ],
        post_tool_call: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event post_tool_call",
            timeout: 120,
          },
        ],
        pre_verify: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_verify",
            timeout: 120,
          },
        ],
      },
    };
    expect(hasCompleteHermesAutopilotHooks(noMatcher)).toBe(false);
    const fixed = mergeHermesConfig(noMatcher);
    expect(hasCompleteHermesAutopilotHooks(fixed)).toBe(true);
    const posts = fixed.hooks!.post_tool_call as Array<{ matcher?: string }>;
    expect(posts[0]!.matcher).toBe(HERMES_POST_TOOL_MATCHER);
  });

  it("wrong --platform does not count as complete Hermes wiring", () => {
    const wrongPlatform = {
      hooks: {
        pre_llm_call: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event pre_llm_call",
            timeout: 120,
          },
        ],
        post_tool_call: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event post_tool_call",
            timeout: 120,
            matcher: HERMES_POST_TOOL_MATCHER,
          },
        ],
        pre_verify: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event pre_verify",
            timeout: 120,
          },
        ],
      },
    };
    expect(hasCompleteHermesAutopilotHooks(wrongPlatform)).toBe(false);
    expect(hermesHooksHavePlatformStamp(wrongPlatform)).toBe(false);
    expect(hermesHooksContainAutopilot(wrongPlatform)).toBe(true);
    const fixed = mergeHermesConfig(wrongPlatform);
    expect(hasCompleteHermesAutopilotHooks(fixed)).toBe(true);
    expect(hermesHooksHavePlatformStamp(fixed)).toBe(true);
  });

  it("rejects non-string matcher / non-scalar timeout on validate", () => {
    expect(() =>
      mergeHermesConfig({
        hooks: {
          post_tool_call: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event post_tool_call",
              matcher: ["write_file", "patch"],
              timeout: 120,
            },
          ],
        },
      }),
    ).toThrow(/non-string matcher/i);
    expect(() =>
      mergeHermesConfig({
        hooks: {
          pre_llm_call: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call",
              timeout: { sec: 120 },
            },
          ],
        },
      }),
    ).toThrow(/non-number\/non-string timeout/i);
    expect(() =>
      mergeHermesConfig({
        hooks: {
          pre_llm_call: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call",
              timeout: Number.NaN,
            },
          ],
        },
      }),
    ).toThrow(/non-finite timeout/i);
    expect(() =>
      mergeHermesConfig({
        hooks: {
          pre_verify: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_verify",
              timeout: 120,
              fail_closed: "yes",
            },
          ],
        },
      }),
    ).toThrow(/non-boolean fail_closed/i);
    expect(() =>
      mergeHermesConfig({
        hooks: {
          pre_llm_call: [
            {
              command:
                "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call",
              timeout: "not-a-number",
            },
          ],
        },
      }),
    ).toThrow(/non-numeric timeout string/i);
  });

  it("wrong-platform leftover beside complete Hermes wiring is incomplete", () => {
    const mixed = mergeHermesConfig(null);
    const pre = mixed.hooks!.pre_llm_call as unknown[];
    pre.push({
      command:
        "node .autopilot/bin/autopilot-harness-hook.mjs --platform cursor --event pre_llm_call",
      timeout: 120,
    });
    expect(hasCompleteHermesAutopilotHooks(mixed)).toBe(false);
    expect(hermesHooksHavePlatformStamp(mixed)).toBe(false);
    const fixed = mergeHermesConfig(mixed);
    expect(hasCompleteHermesAutopilotHooks(fixed)).toBe(true);
    expect(hermesHooksHavePlatformStamp(fixed)).toBe(true);
    expect(
      (fixed.hooks!.pre_llm_call as unknown[]).filter((e) =>
        JSON.stringify(e).includes("--platform cursor"),
      ),
    ).toHaveLength(0);
  });

  it("Autopilot under a foreign event key is unstamped / incomplete", () => {
    const stray = mergeHermesConfig(null);
    stray.hooks = {
      ...(stray.hooks as Record<string, unknown>),
      on_session_start: [
        {
          command:
            "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call",
          timeout: 120,
        },
      ],
    };
    expect(hermesHooksHavePlatformStamp(stray)).toBe(false);
    expect(hasCompleteHermesAutopilotHooks(stray)).toBe(false);
    expect(hermesHooksContainAutopilot(stray)).toBe(true);
    const fixed = mergeHermesConfig(stray);
    expect(hermesHooksHavePlatformStamp(fixed)).toBe(true);
    expect(hasCompleteHermesAutopilotHooks(fixed)).toBe(true);
    expect(
      (fixed.hooks as Record<string, unknown>).on_session_start,
    ).toBeUndefined();
  });

  it("foreign event key keeps non-Autopilot siblings when stripping stray Autopilot", () => {
    const mixed = mergeHermesConfig(null);
    mixed.hooks = {
      ...(mixed.hooks as Record<string, unknown>),
      on_session_start: [
        { command: "echo keep-session", timeout: 5 },
        {
          command:
            "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call",
          timeout: 120,
        },
      ],
    };
    expect(hermesHooksHavePlatformStamp(mixed)).toBe(false);
    const fixed = mergeHermesConfig(mixed);
    const session = (fixed.hooks as Record<string, unknown>)
      .on_session_start as Array<{ command?: string }>;
    expect(Array.isArray(session)).toBe(true);
    expect(session).toHaveLength(1);
    expect(session[0]!.command).toBe("echo keep-session");
    expect(hasCompleteHermesAutopilotHooks(fixed)).toBe(true);
  });

  it("flat Autopilot object under a foreign key is unstamped / detected", () => {
    const flat = mergeHermesConfig(null);
    flat.hooks = {
      ...(flat.hooks as Record<string, unknown>),
      on_session_start: {
        command:
          "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call",
        timeout: 120,
      },
    };
    expect(hermesHooksHavePlatformStamp(flat)).toBe(false);
    expect(hasCompleteHermesAutopilotHooks(flat)).toBe(false);
    expect(hermesHooksContainAutopilot(flat)).toBe(true);
    // validate refuses flat foreign values — merge must fail closed.
    expect(() => mergeHermesConfig(flat)).toThrow(/must be a list/i);
  });

  it("flat / bare Autopilot under a canonical event key is unstamped", () => {
    const flatEvent = mergeHermesConfig(null);
    (flatEvent.hooks as Record<string, unknown>).pre_llm_call = {
      command:
        "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call",
      timeout: 120,
    };
    expect(hermesHooksHavePlatformStamp(flatEvent)).toBe(false);
    expect(hasCompleteHermesAutopilotHooks(flatEvent)).toBe(false);
    expect(hermesHooksContainAutopilot(flatEvent)).toBe(true);

    const bare = mergeHermesConfig(null);
    (bare.hooks as Record<string, unknown>).on_session_start =
      "node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call";
    expect(hermesHooksHavePlatformStamp(bare)).toBe(false);
    expect(hermesHooksContainAutopilot(bare)).toBe(true);
    expect(() => mergeHermesConfig(bare)).toThrow(/must be a list/i);
  });

  it("hermesConfigYamlContainsAutopilot ignores prose on parse failure", () => {
    expect(typeof hermesConfigYamlContainsAutopilot).toBe("function");
    // Invalid YAML → fallback regex; prose/comment alone must not match.
    expect(hermesConfigYamlContainsAutopilot("{[")).toBe(false);
    expect(
      hermesConfigYamlContainsAutopilot(
        "{[\n# mentions autopilot-harness-hook.mjs in a comment\n",
      ),
    ).toBe(false);
    expect(
      hermesConfigYamlContainsAutopilot(
        "{[\n# node .autopilot/bin/autopilot-harness-hook.mjs in a comment\n",
      ),
    ).toBe(false);
    expect(
      hermesConfigYamlContainsAutopilot(
        "{[\n  note: install node and read autopilot-harness-hook.mjs\n",
      ),
    ).toBe(false);
    expect(
      hermesConfigYamlContainsAutopilot(
        "{[\n  command: echo hi # autopilot-harness-hook.mjs\n",
      ),
    ).toBe(false);
    expect(
      hermesConfigYamlContainsAutopilot(
        "{[\n  command: echo autopilot-harness-hook.mjs\n",
      ),
    ).toBe(false);
    expect(
      hermesConfigYamlContainsAutopilot(
        "{[\n  command: /opt/autopilot-harness-hook.mjs --platform hermes-agent\n",
      ),
    ).toBe(true);
    expect(
      hermesConfigYamlContainsAutopilot(
        "{[\n  command: node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call\n",
      ),
    ).toBe(true);
    // Bare node command scalar (no command: key) still fingerprints.
    expect(
      hermesConfigYamlContainsAutopilot(
        "hooks:\n  pre_llm_call: node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call\n",
      ),
    ).toBe(true);
    // Valid YAML with Autopilot command still detected via parse path.
    expect(
      hermesConfigYamlContainsAutopilot(
        "hooks:\n  pre_llm_call:\n    - command: node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent --event pre_llm_call\n",
      ),
    ).toBe(true);
  });
});
