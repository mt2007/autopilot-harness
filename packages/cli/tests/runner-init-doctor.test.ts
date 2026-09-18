/**
 * init / doctor / upgrade / uninstall / --add-platform for surface:runner.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSTALLABLE_BINDINGS,
  MAX_PLATFORM_BINDINGS,
  defaultSurfaceFor,
  ensureRunnerConfigKeys,
  hasInstallableHookHost,
  installInitYes,
  isInstallableBinding,
  normalizeBinding,
  runDoctor,
  stripRunnerConfigTraces,
  uninstallProject,
  upgradeProject,
} from "../src/index.js";
import { defaultConfigYaml } from "../src/init/default-config.js";
import { mergeConfigYamlMissingKeys } from "../src/init/config-merge.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-runner-init-"));
}

describe("runner installable binding", () => {
  it("INSTALLABLE_BINDINGS includes runner/runner", () => {
    expect(
      INSTALLABLE_BINDINGS.some(
        (b) => b.id === "runner" && b.surface === "runner",
      ),
    ).toBe(true);
    expect(defaultSurfaceFor("runner")).toBe("runner");
    expect(isInstallableBinding({ id: "runner", surface: "runner" })).toBe(
      true,
    );
    expect(normalizeBinding("runner")).toEqual({
      id: "runner",
      surface: "runner",
    });
  });

  it("defaultConfigYaml writes runner: with max_iterations 32 and no command", () => {
    const yaml = defaultConfigYaml({
      platforms: [{ id: "runner", surface: "runner" }],
      locale: "en",
    });
    expect(yaml).toMatch(/runner:/);
    expect(yaml).toMatch(/max_iterations:\s*32/);
    expect(yaml).not.toMatch(/^\s*command:/m);
    expect(yaml).toMatch(/# command:/);
    // Commented examples must use argv-shaped tips for claude/codex — `{prompt_file}`
    // expands to a path string (shell:false); `codex exec` treats PROMPT as text, not a file.
    expect(yaml).toMatch(/# command: "claude -p \{prompt\}"/);
    expect(yaml).toMatch(/# command: "codex exec -- \{prompt\}"/);
    expect(yaml).not.toMatch(/codex exec -- \{prompt_file\}/);
  });

  it("upgrade merge appends missing runner keys", () => {
    const existing = `platforms:
  - id: cursor
    surface: ide
locale: en
`;
    const defaults = defaultConfigYaml({
      platforms: [{ id: "cursor", surface: "ide" }],
      locale: "en",
    });
    const { yaml, addedPaths } = mergeConfigYamlMissingKeys(existing, defaults);
    expect(addedPaths.some((p) => p === "runner" || p.startsWith("runner."))).toBe(
      true,
    );
    expect(yaml).toMatch(/runner:/);
    expect(yaml).toMatch(/max_iterations:\s*32/);
  });

  it("ensureRunnerConfigKeys fills runner without inventing command", () => {
    const { yaml, addedPaths } = ensureRunnerConfigKeys("locale: en\n");
    expect(addedPaths).toContain("runner");
    expect(yaml).toMatch(/max_iterations:\s*32/);
    expect(yaml).not.toMatch(/command:/);
  });

  it("ensureRunnerConfigKeys respects camelCase maxIterations", () => {
    const { yaml, addedPaths } = ensureRunnerConfigKeys(
      "runner:\n  maxIterations: 10\nlocale: en\n",
    );
    expect(addedPaths).toEqual([]);
    expect(yaml).toMatch(/maxIterations:\s*10/);
    expect(yaml).not.toMatch(/max_iterations:/);
  });

  it("stripRunnerConfigTraces removes runner: and drops binding when peers remain", () => {
    const src = `platforms:
  - id: cursor
    surface: ide
  - id: runner
    surface: runner
runner:
  max_iterations: 32
locale: en
`;
    const { yaml, removedRunnerKey, removedFromPlatforms } =
      stripRunnerConfigTraces(src);
    expect(removedRunnerKey).toBe(true);
    expect(removedFromPlatforms).toBe(true);
    expect(yaml).not.toMatch(/runner:/);
    expect(yaml).toMatch(/id: cursor/);
    expect(yaml).not.toMatch(/id: runner/);
  });

  it("stripRunnerConfigTraces keeps runner-only platforms entry", () => {
    const src = `platforms:
  - id: runner
    surface: runner
runner:
  command: "echo {prompt}"
  max_iterations: 8
`;
    const { yaml, removedRunnerKey, removedFromPlatforms } =
      stripRunnerConfigTraces(src);
    expect(removedRunnerKey).toBe(true);
    expect(removedFromPlatforms).toBe(false);
    expect(yaml).not.toMatch(/command:/);
    expect(yaml).toMatch(/id: runner/);
  });

  it("stripRunnerConfigTraces clears runner: on over-cap without rewriting platforms", () => {
    const many = Array.from({ length: MAX_PLATFORM_BINDINGS + 1 }, (_, i) => {
      const id = i === 0 ? "runner" : `host${i}`;
      const surface = i === 0 ? "runner" : "cli";
      return `  - id: ${id}\n    surface: ${surface}`;
    }).join("\n");
    const src = `platforms:\n${many}\nrunner:\n  max_iterations: 32\n`;
    const { yaml, removedRunnerKey, removedFromPlatforms } =
      stripRunnerConfigTraces(src);
    expect(removedRunnerKey).toBe(true);
    expect(removedFromPlatforms).toBe(false);
    expect(yaml).not.toMatch(/^runner:/m);
    expect(yaml).toMatch(/id: runner/);
    expect(yaml).toMatch(/id: host32/);
  });

  it("stripRunnerConfigTraces fails closed on over-cap when only platforms need edit", () => {
    const many = Array.from({ length: MAX_PLATFORM_BINDINGS + 1 }, (_, i) => {
      const id = i === 0 ? "runner" : `host${i}`;
      const surface = i === 0 ? "runner" : "cli";
      return `  - id: ${id}\n    surface: ${surface}`;
    }).join("\n");
    const src = `platforms:\n${many}\nlocale: en\n`;
    expect(() => stripRunnerConfigTraces(src)).toThrow(/cap|exceeds/i);
  });

  it("hasInstallableHookHost is false for runner-only", () => {
    expect(
      hasInstallableHookHost([{ id: "runner", surface: "runner" }]),
    ).toBe(false);
    expect(
      hasInstallableHookHost([
        { id: "cursor", surface: "ide" },
        { id: "runner", surface: "runner" },
      ]),
    ).toBe(true);
  });
});

describe("runner init / add-platform / doctor / uninstall", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("init runner-only succeeds and writes runner: stub", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platforms: [{ id: "runner", surface: "runner" }],
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);
    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id: runner/);
    expect(cfg).toMatch(/surface: runner/);
    expect(cfg).toMatch(/max_iterations:\s*32/);
    expect(cfg).not.toMatch(/^\s*command:/m);
  });

  it("add-platform runner keeps Cursor hooks and ensures runner keys", () => {
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

    // Simulate legacy config without runner: before add-platform.
    const configPath = path.join(root, ".autopilot", "config.yml");
    let yaml = fs.readFileSync(configPath, "utf8");
    yaml = yaml.replace(/\nrunner:[\s\S]*?(?=\n[a-z]|\n*$)/, "\n");
    fs.writeFileSync(configPath, yaml, "utf8");
    expect(fs.readFileSync(configPath, "utf8")).not.toMatch(/runner:/);

    const add = installInitYes({
      projectRoot: root,
      platforms: [{ id: "runner", surface: "runner" }],
      locale: "en",
      force: true,
      mergePlatforms: true,
    });
    expect(add.ok).toBe(true);

    const next = fs.readFileSync(configPath, "utf8");
    expect(next).toMatch(/id: cursor/);
    expect(next).toMatch(/id: runner/);
    expect(next).toMatch(/runner:/);
    expect(next).toMatch(/max_iterations:\s*32/);
    expect(
      fs.existsSync(path.join(root, ".cursor", "hooks.json")),
    ).toBe(true);
  });

  it("doctor WARNs empty command, small iterations, and dual+one_executor", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "cursor", surface: "ide" },
          { id: "runner", surface: "runner" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const configPath = path.join(root, ".autopilot", "config.yml");
    let yaml = fs.readFileSync(configPath, "utf8");
    yaml = yaml.replace(
      /runner:[\s\S]*?(?=\n[a-z]|\n*$)/,
      "runner:\n  max_iterations: 3\n",
    );
    fs.writeFileSync(configPath, yaml, "utf8");

    const doc = runDoctor(root);
    const text = doc.lines.join("\n");
    expect(text).toMatch(/WARN\s+runner\.command is empty/);
    expect(text).toMatch(/WARN\s+runner\.max_iterations is 3/);
    expect(text).toMatch(/WARN\s+Runner \+ hook host under concurrency\.mode: one_executor/);
  });

  it("uninstall clears runner: and runner-prompts", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "cursor", surface: "ide" },
          { id: "runner", surface: "runner" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const prompts = path.join(root, ".autopilot", "runner-prompts");
    fs.mkdirSync(prompts, { recursive: true });
    fs.writeFileSync(path.join(prompts, "x.txt"), "hi\n", "utf8");

    const result = uninstallProject({ projectRoot: root });
    expect(result.ok).toBe(true);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).not.toMatch(/runner:/);
    expect(cfg).toMatch(/id: cursor/);
    expect(cfg).not.toMatch(/id: runner/);
    expect(fs.existsSync(prompts)).toBe(false);
  });

  it("uninstall without runner platform keeps configured runner.command", () => {
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
    let yaml = fs.readFileSync(configPath, "utf8");
    // Ensure platforms are cursor-only but runner.command is set (CLI-usable).
    yaml = yaml.replace(
      /runner:[\s\S]*?(?=\n[a-z]|\n*$)/,
      'runner:\n  command: "echo {prompt}"\n  max_iterations: 32\n',
    );
    fs.writeFileSync(configPath, yaml, "utf8");
    expect(fs.readFileSync(configPath, "utf8")).toMatch(/command:/);
    expect(fs.readFileSync(configPath, "utf8")).not.toMatch(/id: runner/);

    const result = uninstallProject({ projectRoot: root });
    expect(result.ok).toBe(true);
    const next = fs.readFileSync(configPath, "utf8");
    expect(next).toMatch(/command:\s*"echo \{prompt\}"/);
    expect(next).toMatch(/max_iterations:\s*32/);
  });

  it("doctor runner-only WARNs empty command but not dual-track", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "runner", surface: "runner" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const text = runDoctor(root).lines.join("\n");
    expect(text).toMatch(/WARN\s+runner\.command is empty/);
    expect(text).not.toMatch(/dual track/);
  });

  it("doctor WARNs raw max_iterations below recommended (incl. 0)", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "runner", surface: "runner" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const configPath = path.join(root, ".autopilot", "config.yml");
    let yaml = fs.readFileSync(configPath, "utf8");
    yaml = yaml.replace(
      /runner:[\s\S]*?(?=\n[a-z]|\n*$)/,
      "runner:\n  command: echo {prompt}\n  max_iterations: 0\n",
    );
    fs.writeFileSync(configPath, yaml, "utf8");

    const text = runDoctor(root).lines.join("\n");
    expect(text).toMatch(/WARN\s+runner\.max_iterations is 0/);
  });

  it("upgrade appends runner: to legacy cursor config", () => {
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
    let yaml = fs.readFileSync(configPath, "utf8");
    yaml = yaml.replace(/\nrunner:[\s\S]*?(?=\n[a-z]|\n*$)/, "\n");
    fs.writeFileSync(configPath, yaml, "utf8");

    const up = upgradeProject({ projectRoot: root });
    expect(up.ok).toBe(true);
    const next = fs.readFileSync(configPath, "utf8");
    expect(next).toMatch(/runner:/);
    expect(next).toMatch(/max_iterations:\s*32/);
  });
});
