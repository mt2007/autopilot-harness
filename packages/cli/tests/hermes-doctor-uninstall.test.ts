import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatHermesConfigYaml,
  hermesConfigYamlPath,
  mergeHermesConfig,
  parseHermesConfigYaml,
} from "../src/init/hermes-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { applyPlatformsToConfigYaml } from "../src/init/platforms.js";
import { runDoctor } from "../src/status-doctor.js";
import { uninstallProject } from "../src/uninstall.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-doc-"));
}

describe("Hermes doctor / uninstall", () => {
  let root = "";
  let hermesHome = "";
  let prevHome: string | undefined;

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = prevHome;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    if (hermesHome) fs.rmSync(hermesHome, { recursive: true, force: true });
    root = "";
    hermesHome = "";
  });

  function withHermesHome(): string {
    hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hermes-home-"));
    prevHome = process.env.HERMES_HOME;
    process.env.HERMES_HOME = hermesHome;
    return hermesHome;
  }

  it("doctor FAIL when Hermes fingerprint missing", () => {
    root = tmpProject();
    withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "hermes-agent",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    // Empty user-home yaml → missing all Autopilot events.
    fs.writeFileSync(hermesConfigYamlPath(hermesHome), "", "utf8");

    const r = runDoctor(root, { hermesHome });
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toMatch(
      /FAIL\s+Hermes config\.yaml missing\/incomplete Autopilot for:/i,
    );
  });

  it("doctor FAIL when Hermes fingerprint incomplete", () => {
    root = tmpProject();
    withHermesHome();
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
    const file = parseHermesConfigYaml(fs.readFileSync(yamlPath, "utf8"));
    // Drop two events → residual fingerprint incomplete.
    delete (file.hooks as Record<string, unknown>).post_tool_call;
    delete (file.hooks as Record<string, unknown>).pre_verify;
    fs.writeFileSync(yamlPath, formatHermesConfigYaml(file), "utf8");

    const r = runDoctor(root, { hermesHome });
    expect(r.ok).toBe(false);
    const joined = r.lines.join("\n");
    expect(joined).toMatch(
      /FAIL\s+Hermes config\.yaml missing\/incomplete Autopilot for:.*post_tool_call/i,
    );
    expect(joined).toMatch(/pre_verify/i);
  });

  it("doctor FAIL when post_tool_call matcher missing (残指纹)", () => {
    root = tmpProject();
    withHermesHome();
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
    const file = parseHermesConfigYaml(fs.readFileSync(yamlPath, "utf8"));
    const posts = (file.hooks as Record<string, unknown>)
      .post_tool_call as Array<Record<string, unknown>>;
    for (const e of posts) {
      if (
        typeof e.command === "string" &&
        e.command.includes("autopilot-harness-hook")
      ) {
        delete e.matcher;
      }
    }
    fs.writeFileSync(yamlPath, formatHermesConfigYaml(file), "utf8");

    const r = runDoctor(root, { hermesHome });
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toMatch(
      /FAIL\s+Hermes config\.yaml Autopilot fingerprint incomplete \(stamp\/matcher\/leftover\)/i,
    );
  });

  it("doctor FAIL when a duplicate post_tool_call Autopilot entry omits matcher", () => {
    root = tmpProject();
    withHermesHome();
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
    const file = parseHermesConfigYaml(fs.readFileSync(yamlPath, "utf8"));
    const posts = (file.hooks as Record<string, unknown>)
      .post_tool_call as Array<Record<string, unknown>>;
    const good = posts.find(
      (e) =>
        typeof e.command === "string" &&
        e.command.includes("autopilot-harness-hook"),
    );
    expect(good).toBeDefined();
    // First entry keeps matcher; second Autopilot twin omits it (host would
    // run the twin on all tools). Residual FAIL must catch every entry.
    posts.push({
      command: good!.command,
      timeout: 120,
    });
    fs.writeFileSync(yamlPath, formatHermesConfigYaml(file), "utf8");

    const r = runDoctor(root, { hermesHome });
    expect(r.ok).toBe(false);
    const joined = r.lines.join("\n");
    expect(joined).toMatch(
      /FAIL\s+Hermes config\.yaml Autopilot fingerprint incomplete \(stamp\/matcher\/leftover\)/i,
    );
    expect(joined).toMatch(/duplicate Autopilot/i);
  });

  it("doctor WARN-only on duplicate Autopilot entries (does not FAIL)", () => {
    root = tmpProject();
    withHermesHome();
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
    const file = mergeHermesConfig(
      parseHermesConfigYaml(fs.readFileSync(yamlPath, "utf8")),
    );
    const pre = (file.hooks as Record<string, unknown>)
      .pre_llm_call as unknown[];
    pre.push({ ...pre[0] });
    fs.writeFileSync(yamlPath, formatHermesConfigYaml(file), "utf8");

    const r = runDoctor(root, { hermesHome });
    const joined = r.lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+Hermes config\.yaml has 1 duplicate Autopilot/i,
    );
    expect(joined).not.toMatch(
      /FAIL\s+Hermes config\.yaml Autopilot fingerprint incomplete/i,
    );
    expect(joined).not.toMatch(
      /FAIL\s+Hermes config\.yaml missing\/incomplete/i,
    );
    // Duplicates alone must not flip doctor to FAIL (pin/bin may still warn).
    expect(joined).not.toMatch(/FAIL\s+Hermes /i);
  });

  it("doctor WARN when Claude-only project has leftover Hermes Autopilot hooks", () => {
    root = tmpProject();
    withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "claude-code", surface: "cli" },
          { id: "hermes-agent", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    const yaml = fs.readFileSync(cfgPath, "utf8");
    fs.writeFileSync(
      cfgPath,
      applyPlatformsToConfigYaml(yaml, [
        { id: "claude-code", surface: "cli" },
      ]),
      "utf8",
    );
    expect(
      hermesConfigYamlContainsAutopilotText(hermesConfigYamlPath(hermesHome)),
    ).toBe(true);

    const r = runDoctor(root, { hermesHome });
    expect(r.lines.join("\n")).toMatch(
      /Hermes Autopilot hooks present while Claude Code is enabled/i,
    );
  });

  it("doctor WARN for hook timeout and max_verify_nudges", () => {
    root = tmpProject();
    withHermesHome();
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
    const file = mergeHermesConfig(
      parseHermesConfigYaml(fs.readFileSync(yamlPath, "utf8")),
    );
    for (const event of ["pre_llm_call", "post_tool_call", "pre_verify"] as const) {
      const list = (file.hooks as Record<string, unknown>)[event] as Array<{
        command?: string;
        timeout?: number;
      }>;
      for (const e of list) {
        if (
          typeof e.command === "string" &&
          e.command.includes("autopilot-harness-hook")
        ) {
          e.timeout = 30;
        }
      }
    }
    file.agent = { ...(file.agent as object), max_verify_nudges: 3 };
    fs.writeFileSync(yamlPath, formatHermesConfigYaml(file), "utf8");

    const r = runDoctor(root, { hermesHome });
    // FAIL is for missing fingerprint only; timeout/nudge are WARN (ok may still be true).
    const joined = r.lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+Autopilot Hermes hook timeout below 120/i,
    );
    expect(joined).toMatch(
      /WARN\s+agent\.max_verify_nudges is still 3/i,
    );
    expect(joined).toMatch(/hermes hooks doctor/i);
    expect(joined).toMatch(/consent\/non-TTY/i);
    expect(joined).toMatch(/HERMES_HOME/i);
    expect(joined).toMatch(/edit-only/i);
    expect(joined).toMatch(/plugins run before shell hooks/i);
  });

  it("doctor WARN when agent.max_verify_nudges is missing", () => {
    root = tmpProject();
    withHermesHome();
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
    const file = parseHermesConfigYaml(fs.readFileSync(yamlPath, "utf8"));
    delete file.agent;
    fs.writeFileSync(yamlPath, formatHermesConfigYaml(file), "utf8");

    const r = runDoctor(root, { hermesHome });
    expect(r.lines.join("\n")).toMatch(
      /WARN\s+agent\.max_verify_nudges missing/i,
    );
  });

  it("doctor WARN when Hermes Agent + Claude Code both enabled", () => {
    root = tmpProject();
    withHermesHome();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "hermes-agent", surface: "cli" },
          { id: "claude-code", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const r = runDoctor(root, { hermesHome });
    expect(r.lines.join("\n")).toMatch(
      /Hermes Agent \+ Claude Code both enabled/i,
    );
  });

  it("uninstall strips Autopilot Hermes hooks and leaves foreign entries", () => {
    root = tmpProject();
    withHermesHome();
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

    const dry = uninstallProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(true);
    if (dry.ok) {
      expect(
        dry.actions.some((a) =>
          /strip Autopilot entries from \$HERMES_HOME\/config\.yaml/i.test(a),
        ),
      ).toBe(true);
      // Dry-run must not mutate.
      expect(hermesConfigYamlContainsAutopilotText(yamlPath)).toBe(true);
    }

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.actions.some((a) =>
        /strip Autopilot entries from \$HERMES_HOME\/config\.yaml/i.test(a),
      ),
    ).toBe(true);

    const after = parseHermesConfigYaml(fs.readFileSync(yamlPath, "utf8"));
    const pre = (after.hooks?.pre_llm_call ?? []) as Array<{ command?: string }>;
    const cmds = pre.map((s) => String(s.command ?? ""));
    expect(cmds.some((c) => c.includes("foreign-hermes-keep"))).toBe(true);
    expect(cmds.some((c) => /autopilot-harness-hook/.test(c))).toBe(false);
    expect(hermesConfigYamlContainsAutopilotText(yamlPath)).toBe(false);
  });

  it("uninstall fails closed on corrupt Hermes yaml with Autopilot fingerprint (incl. dry-run)", () => {
    root = tmpProject();
    withHermesHome();
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
    // Regex fingerprint hits, but YAML does not parse — dry-run must not claim strip.
    fs.writeFileSync(
      yamlPath,
      "command: node .autopilot/bin/autopilot-harness-hook.mjs --platform hermes-agent\nhooks: [\nnot-yaml\n",
      "utf8",
    );
    expect(hermesConfigYamlContainsAutopilotText(yamlPath)).toBe(true);

    const dry = uninstallProject({ projectRoot: root, dryRun: true });
    expect(dry.ok).toBe(false);
    if (!dry.ok) {
      expect(dry.error).toMatch(/Hermes config\.yaml|valid YAML|YAML/i);
    }
    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Hermes config\.yaml|valid YAML|YAML/i);
    }
    // Still on disk (no partial write).
    expect(hermesConfigYamlContainsAutopilotText(yamlPath)).toBe(true);
  });
});

function hermesConfigYamlContainsAutopilotText(yamlPath: string): boolean {
  const text = fs.readFileSync(yamlPath, "utf8");
  return /autopilot-harness-hook\.mjs/.test(text);
}
