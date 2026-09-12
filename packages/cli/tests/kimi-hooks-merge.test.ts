import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KIMI_AUTOPILOT_EVENTS,
  KIMI_HOOK_TIMEOUT_SEC,
  KIMI_POST_TOOL_USE_MATCHER,
  kimiAutopilotHasSmallTimeout,
  kimiConfigTomlPath,
  kimiHooksContainAutopilot,
  kimiHooksHavePlatformStamp,
  mergeKimiConfigToml,
  readKimiConfigToml,
  resolveKimiCodeHome,
  stripAutopilotKimiHooks,
} from "../src/init/kimi-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { defaultConfigYaml } from "../src/init/default-config.js";
import {
  formatHostActivationTips,
  formatPostInstallOutro,
} from "../src/init/wizard-helpers.js";

describe("kimi hooks merge", () => {
  it("defaultConfigYaml uses confirm_rounds 1 only for installable kimi-code", () => {
    const withKimi = defaultConfigYaml({
      platforms: [{ id: "kimi-code", surface: "cli" }],
      locale: "en",
    });
    expect(withKimi).toMatch(/confirm_rounds:\s*1/);
    const wrongSurface = defaultConfigYaml({
      platforms: [
        { id: "cursor", surface: "ide" },
        { id: "kimi-code", surface: "ide" },
      ],
      locale: "en",
    });
    expect(wrongSurface).toMatch(/confirm_rounds:\s*5/);
    expect(wrongSurface).not.toMatch(/confirm_rounds:\s*1/);
  });

  it("creates three Autopilot [[hooks]] with platform stamp and timeout 120", () => {
    const merged = mergeKimiConfigToml("");
    expect(kimiHooksContainAutopilot(merged)).toBe(true);
    expect(kimiHooksHavePlatformStamp(merged)).toBe(true);
    expect(kimiAutopilotHasSmallTimeout(merged)).toBe(false);
    for (const ev of KIMI_AUTOPILOT_EVENTS) {
      expect(merged).toMatch(new RegExp(`event = "${ev}"`));
      expect(merged).toMatch(
        new RegExp(
          `command = "node \\.autopilot/bin/autopilot-harness-hook\\.mjs --platform kimi-code --event ${ev}"`,
        ),
      );
    }
    expect(merged).toMatch(`matcher = "${KIMI_POST_TOOL_USE_MATCHER}"`);
    expect(merged).toMatch(`timeout = ${KIMI_HOOK_TIMEOUT_SEC}`);
    expect(merged).not.toMatch(/local\.toml/);
  });

  it("preserves foreign [[hooks]] and other config keys", () => {
    const existing = `# user prefs
model = "kimi"

[[hooks]]
event = "Notification"
command = "echo keep-me"
timeout = 5
`;
    const merged = mergeKimiConfigToml(existing);
    expect(merged).toMatch(/model = "kimi"/);
    expect(merged).toMatch(/echo keep-me/);
    expect(merged).toMatch(/--platform kimi-code/);
    const stripped = stripAutopilotKimiHooks(merged);
    expect(stripped.foreignHookTables.some((t) => /keep-me/.test(t))).toBe(
      true,
    );
  });

  it("replaces prior Autopilot fingerprint without stacking", () => {
    const once = mergeKimiConfigToml("");
    const twice = mergeKimiConfigToml(once);
    const ups = twice.match(/event = "UserPromptSubmit"/g) ?? [];
    expect(ups.length).toBe(1);
  });

  it("treats omitted Autopilot timeout as too small (Kimi default 30s)", () => {
    const missing = `[[hooks]]
event = "Stop"
command = "node .autopilot/bin/autopilot-harness-hook.mjs --platform kimi-code --event Stop"
`;
    expect(kimiAutopilotHasSmallTimeout(missing)).toBe(true);
    const merged = mergeKimiConfigToml(missing);
    expect(kimiAutopilotHasSmallTimeout(merged)).toBe(false);
    expect(merged).toMatch(`timeout = ${KIMI_HOOK_TIMEOUT_SEC}`);
  });

  it("drops Autopilot tables whose timeout line has a trailing comment (no stack)", () => {
    const weird = `[[hooks]]
event = "Stop"
command = "node .autopilot/bin/autopilot-harness-hook.mjs --platform kimi-code --event Stop"
timeout = 30 # legacy
`;
    const merged = mergeKimiConfigToml(weird);
    expect((merged.match(/event = "Stop"/g) ?? []).length).toBe(1);
    expect(merged).toMatch(`timeout = ${KIMI_HOOK_TIMEOUT_SEC}`);
    expect(merged).not.toMatch(/# legacy/);
  });

  it("drops unparseable Autopilot fingerprint tables (no stack)", () => {
    const weird = `[[hooks]]
event = "Stop"
command = "node .autopilot/bin/autopilot-harness-hook.mjs --platform kimi-code --event Stop"
timeout = 30
extra = "breaks-kimi-schema"
`;
    const merged = mergeKimiConfigToml(weird);
    const stops = merged.match(/event = "Stop"/g) ?? [];
    expect(stops.length).toBe(1);
    expect(merged).not.toMatch(/extra =/);
    expect(merged).toMatch(`timeout = ${KIMI_HOOK_TIMEOUT_SEC}`);
  });

  it("drops unparseable Autopilot fingerprint with Windows path separators", () => {
    const weird = `[[hooks]]
event = "Stop"
command = "node .autopilot\\bin\\autopilot-harness-hook.mjs --platform kimi-code --event Stop"
timeout = 30
extra = true
`;
    const merged = mergeKimiConfigToml(weird);
    expect((merged.match(/event = "Stop"/g) ?? []).length).toBe(1);
    expect(merged).not.toMatch(/extra =/);
  });

  it("resolveKimiCodeHome strips C0 controls from env", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-ctrl-"));
    try {
      const cleaned = resolveKimiCodeHome({
        KIMI_CODE_HOME: `${dir}\n/nested`,
      } as NodeJS.ProcessEnv);
      expect(cleaned).toBe(path.resolve(`${dir}/nested`));
      expect(cleaned).not.toMatch(/\n/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps unparseable foreign hooks that only mention Autopilot in a comment", () => {
    const foreign = `[[hooks]]
event = "SessionStart"
command = "echo foreign"
extra = true
# see autopilot-harness-hook.mjs docs
`;
    const merged = mergeKimiConfigToml(foreign);
    expect(merged).toMatch(/echo foreign/);
    expect(merged).toMatch(/extra = true/);
  });

  it("refuses symlink config.toml (O_NOFOLLOW)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-sym-"));
    try {
      const real = path.join(dir, "real.toml");
      const link = path.join(dir, "config.toml");
      fs.writeFileSync(real, "model = \"x\"\n", "utf8");
      fs.symlinkSync(real, link);
      const r = readKimiConfigToml(link);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/symlink/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats missing config.toml as empty (not an error)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-miss-"));
    try {
      const r = readKimiConfigToml(path.join(dir, "config.toml"));
      expect(r).toEqual({ ok: true, value: "" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("kimi init wiring", () => {
  let root = "";
  let kimiHome = "";
  const prevHome = process.env.KIMI_CODE_HOME;

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    if (kimiHome && fs.existsSync(kimiHome)) {
      fs.rmSync(kimiHome, { recursive: true, force: true });
    }
    if (prevHome === undefined) delete process.env.KIMI_CODE_HOME;
    else process.env.KIMI_CODE_HOME = prevHome;
    root = "";
    kimiHome = "";
  });

  it("init --platform kimi-code merges user-home config.toml (not local.toml)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-init-"));
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-home-"));
    process.env.KIMI_CODE_HOME = kimiHome;

    expect(resolveKimiCodeHome()).toBe(path.resolve(kimiHome));

    const r = installInitYes({
      projectRoot: root,
      platform: "kimi-code",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(true);

    const tomlPath = kimiConfigTomlPath(kimiHome);
    expect(fs.existsSync(tomlPath)).toBe(true);
    const toml = fs.readFileSync(tomlPath, "utf8");
    expect(kimiHooksHavePlatformStamp(toml)).toBe(true);
    expect(fs.existsSync(path.join(kimiHome, "local.toml"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".kimi-code"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".codex", "skills"))).toBe(false);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*kimi-code/);
    expect(cfg).toMatch(/confirm_rounds:\s*1/);
    expect(cfg).toMatch(/match:\s*line_start/);

    expect(formatHostActivationTips("kimi-code").join("\n")).toMatch(
      /confirm_rounds:\s*1/,
    );
    expect(formatHostActivationTips("kimi-code").join("\n")).toMatch(
      /Stop-continue|1\/turn/,
    );
    expect(formatPostInstallOutro("kimi-code")).toMatch(/triggers\.on/);
  });

  it("add-platform kimi-code keeps Cursor hooks and wires Kimi toml", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-add-"));
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-addhome-"));
    process.env.KIMI_CODE_HOME = kimiHome;

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
      platform: "kimi-code",
      surface: "cli",
      platforms: [{ id: "kimi-code", surface: "cli" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    });
    expect(add.ok).toBe(true);
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    expect(kimiHooksHavePlatformStamp(fs.readFileSync(kimiConfigTomlPath(kimiHome), "utf8"))).toBe(
      true,
    );
    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id:\s*cursor/);
    expect(cfg).toMatch(/id:\s*kimi-code/);
  });

  it("--force refreshes kimi toml without stacking or dropping foreign hooks", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-force-"));
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-forcehome-"));
    process.env.KIMI_CODE_HOME = kimiHome;

    expect(
      installInitYes({
        projectRoot: root,
        platform: "kimi-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const tomlPath = kimiConfigTomlPath(kimiHome);
    const seeded = `${fs.readFileSync(tomlPath, "utf8")}
[[hooks]]
event = "Notification"
command = "echo foreign-kimi-keep"
timeout = 5
`;
    fs.writeFileSync(tomlPath, seeded, "utf8");

    const refreshed = installInitYes({
      projectRoot: root,
      platform: "kimi-code",
      surface: "cli",
      locale: "en",
      force: true,
    });
    expect(refreshed.ok).toBe(true);
    const toml = fs.readFileSync(tomlPath, "utf8");
    expect(toml).toMatch(/foreign-kimi-keep/);
    expect(kimiHooksHavePlatformStamp(toml)).toBe(true);
    expect((toml.match(/event = "UserPromptSubmit"/g) ?? []).length).toBe(1);
    expect(kimiAutopilotHasSmallTimeout(toml)).toBe(false);
    expect(fs.existsSync(path.join(kimiHome, "local.toml"))).toBe(false);
  });

  it("init writes kimi quickstart with line-start P0 + confirm_rounds tip", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-qs-"));
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-qshome-"));
    process.env.KIMI_CODE_HOME = kimiHome;

    expect(
      installInitYes({
        projectRoot: root,
        platform: "kimi-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const qs = fs.readFileSync(
      path.join(root, "docs", "autopilot", "quickstart.md"),
      "utf8",
    );
    expect(qs).toMatch(/--platform kimi-code/);
    expect(qs).toMatch(/Preferred: in Kimi Code, line-start `Autopilot ON`/);
    expect(qs).toMatch(/Preferred: line-start `Autopilot RUN`/);
    expect(qs).not.toMatch(/Preferred: in Kimi Code, `\/autopilot-on`/);
    expect(qs).not.toMatch(/`autopilot-run` skill:/);
    expect(qs).toMatch(/confirm_rounds/);
    expect(qs).toMatch(/\$KIMI_CODE_HOME|~\/\.kimi-code/);
  });

  it("refuses init when KIMI_CODE_HOME exists as a file", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-filehome-"));
    kimiHome = path.join(root, "kimi-home-file");
    fs.writeFileSync(kimiHome, "not-a-dir\n", "utf8");
    process.env.KIMI_CODE_HOME = kimiHome;

    const r = installInitYes({
      projectRoot: root,
      platform: "kimi-code",
      surface: "cli",
      locale: "en",
      force: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a directory/i);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      false,
    );
  });
});
