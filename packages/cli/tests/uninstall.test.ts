import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installInitYes } from "../src/init/install.js";
import { stripAutopilotHooks } from "../src/init/hooks-merge.js";
import type { HooksFile } from "../src/init/types.js";
import { uninstallProject } from "../src/uninstall.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-uninstall-"));
}

describe("stripAutopilotHooks", () => {
  it("removes Autopilot entries and keeps foreign hooks", () => {
    const existing: HooksFile = {
      version: 1,
      hooks: {
        stop: [
          { command: "echo keep-me" },
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event stop",
            loop_limit: null,
          },
        ],
        beforeSubmitPrompt: [
          {
            command:
              "node .autopilot/bin/autopilot-harness-hook.mjs --event beforeSubmitPrompt",
          },
        ],
      },
    };
    const stripped = stripAutopilotHooks(existing);
    expect(stripped.hooks.stop).toEqual([{ command: "echo keep-me" }]);
    expect(stripped.hooks.beforeSubmitPrompt).toEqual([]);
  });
});

describe("uninstallProject", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("fails closed on empty projectRoot", () => {
    const r = uninstallProject({ projectRoot: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/projectRoot/);
  });

  it("dry-run reports actions without deleting files", () => {
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

    const hooksPath = path.join(root, ".cursor", "hooks.json");
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as HooksFile;
    hooks.hooks.stop = [
      ...(hooks.hooks.stop ?? []),
      { command: "echo user-hook" },
    ];
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + "\n");

    const planFile = path.join(root, "plans", "demo", "plan.md");
    fs.mkdirSync(path.dirname(planFile), { recursive: true });
    fs.writeFileSync(planFile, "# keep\n", "utf8");

    const r = uninstallProject({ projectRoot: root, dryRun: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dryRun).toBe(true);
    expect(r.actions.some((a) => /hooks\.json/i.test(a))).toBe(true);
    expect(r.actions.some((a) => /skills/i.test(a))).toBe(true);
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    expect(fs.readFileSync(planFile, "utf8")).toBe("# keep\n");
  });

  it("default uninstall strips hooks/skills/bin, keeps config and plans", () => {
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

    const hooksPath = path.join(root, ".cursor", "hooks.json");
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as HooksFile;
    hooks.hooks.stop = [
      ...(hooks.hooks.stop ?? []),
      { command: "echo user-hook" },
    ];
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + "\n");

    const planFile = path.join(root, "plans", "demo", "plan.md");
    fs.mkdirSync(path.dirname(planFile), { recursive: true });
    fs.writeFileSync(planFile, "# keep\n", "utf8");

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dryRun).toBe(false);
    expect(r.removed.length).toBeGreaterThan(0);

    const afterHooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as HooksFile;
    expect(
      afterHooks.hooks.stop?.some((h) => h.command === "echo user-hook"),
    ).toBe(true);
    expect(
      JSON.stringify(afterHooks).includes("autopilot-harness-hook.mjs"),
    ).toBe(false);

    expect(
      fs.existsSync(
        path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs"),
      ),
    ).toBe(false);
    expect(fs.existsSync(path.join(root, ".autopilot", "pin.json"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(root, ".autopilot", "config.yml"))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(root, "docs", "autopilot", "workflows", "autopilot-planning.md"),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(root, "docs", "autopilot", "quickstart.md")),
    ).toBe(false);
    expect(fs.readFileSync(planFile, "utf8")).toBe("# keep\n");
    expect(r.kept.some((k) => /config\.yml/i.test(k))).toBe(true);
    expect(r.kept.some((k) => /plans/i.test(k))).toBe(true);
  });

  it("purge-all removes .autopilot entirely but never plans", () => {
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

    const planFile = path.join(root, "plans", "demo", "plan.md");
    fs.mkdirSync(path.dirname(planFile), { recursive: true });
    fs.writeFileSync(planFile, "# keep\n", "utf8");

    const r = uninstallProject({ projectRoot: root, purgeAll: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(fs.existsSync(path.join(root, ".autopilot"))).toBe(false);
    expect(fs.readFileSync(planFile, "utf8")).toBe("# keep\n");
  });

  it("is a no-op success when Autopilot is not installed", () => {
    root = tmpProject();
    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actions.some((a) => /nothing to uninstall/i.test(a))).toBe(true);
    expect(r.removed).toEqual([]);
  });

  it("still removes skills when hooks.json has no hooks field", () => {
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

    const hooksPath = path.join(root, ".cursor", "hooks.json");
    fs.writeFileSync(hooksPath, JSON.stringify({ version: 1 }, null, 2) + "\n");

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      fs.existsSync(
        path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(false);
    expect(fs.existsSync(path.join(root, ".autopilot", "bin"))).toBe(false);
  });

  it("refuses when .cursor is a symlink (escape)", () => {
    root = tmpProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-un-esc-"));
    fs.mkdirSync(path.join(outside, "skills"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".cursor"));
    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/symlink/i);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("refuses .cursor/skills symlink before stripping hooks", () => {
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

    const hooksPath = path.join(root, ".cursor", "hooks.json");
    const hooksBefore = fs.readFileSync(hooksPath, "utf8");
    const skillsPath = path.join(root, ".cursor", "skills");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skills-esc-"));
    fs.rmSync(skillsPath, { recursive: true, force: true });
    fs.symlinkSync(outside, skillsPath);

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/symlink|escapes/i);
    // Must fail closed before mutating hooks.json.
    expect(fs.readFileSync(hooksPath, "utf8")).toBe(hooksBefore);
    expect(JSON.stringify(JSON.parse(hooksBefore)).includes("autopilot-harness-hook.mjs")).toBe(
      true,
    );
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("refuses when hooks.json exists but is not a regular file", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".cursor", "hooks.json"), { recursive: true });
    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a regular file/i);
  });

  it("fails closed when an Autopilot skill path is neither file nor directory", () => {
    root = tmpProject();
    const skills = path.join(root, ".cursor", "skills");
    fs.mkdirSync(skills, { recursive: true });
    const fifo = path.join(skills, "autopilot-on");
    try {
      fs.mkfifoSync(fifo);
    } catch {
      // Platforms without mkfifo: skip (Windows).
      return;
    }
    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a regular file or directory/i);
    expect(fs.existsSync(fifo)).toBe(true);
  });

  it("reports skip when a skill path is a symlink instead of silent ignore", () => {
    root = tmpProject();
    fs.mkdirSync(path.join(root, ".cursor", "skills"), { recursive: true });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-skill-esc-"));
    fs.symlinkSync(outside, path.join(root, ".cursor", "skills", "autopilot-on"));
    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actions.some((a) => /skip .+symlink/i.test(a))).toBe(true);
    expect(r.actions.some((a) => /nothing to uninstall/i.test(a))).toBe(false);
    // Symlink left in place (not followed / not removed as a tree).
    expect(
      fs.lstatSync(path.join(root, ".cursor", "skills", "autopilot-on")).isSymbolicLink(),
    ).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("uninstalls Claude settings Autopilot entries and skills", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      env?: Record<string, string>;
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    settings.hooks = settings.hooks ?? {};
    settings.hooks.Stop = [
      ...(settings.hooks.Stop ?? []),
      { hooks: [{ command: "echo foreign-stop" }] },
    ];
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actions.some((a) => /\.claude\/settings\.json/i.test(a))).toBe(
      true,
    );

    const after = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      env?: Record<string, string>;
      hooks?: Record<string, unknown>;
    };
    expect(JSON.stringify(after).includes("autopilot-harness-hook.mjs")).toBe(
      false,
    );
    expect(after.env?.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP).toBeUndefined();
    expect(JSON.stringify(after.hooks?.Stop)).toMatch(/foreign-stop/);
    expect(
      fs.existsSync(
        path.join(root, ".claude", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("uninstalls Claude BLOCK_CAP-only leftovers without Autopilot hooks", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const settingsPath = path.join(root, ".claude", "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          env: { CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: "0", KEEP: "yes" },
          hooks: {
            Stop: [{ hooks: [{ type: "command", command: "echo foreign" }] }],
          },
        },
        null,
        2,
      ) + "\n",
    );

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      env?: Record<string, string>;
      hooks?: Record<string, unknown>;
    };
    expect(after.env?.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP).toBeUndefined();
    expect(after.env?.KEEP).toBe("yes");
    expect(JSON.stringify(after.hooks?.Stop)).toMatch(/echo foreign/);
  });

  it("Cursor-only uninstall strips in-project leftover Claude Autopilot settings and skills", () => {
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

    // Simulate leftover Claude wiring after platforms were narrowed to Cursor-only.
    const settingsPath = path.join(root, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          env: { CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: "0", KEEP: "yes" },
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command:
                      "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
                  },
                  { type: "command", command: "echo foreign-stop" },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
    );
    const skillDir = path.join(root, ".claude", "skills", "autopilot-on");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# leftover\n");

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      env?: Record<string, string>;
      hooks?: Record<string, unknown>;
    };
    expect(after.env?.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP).toBeUndefined();
    expect(after.env?.KEEP).toBe("yes");
    expect(JSON.stringify(after)).not.toMatch(/autopilot-harness-hook\.mjs/);
    expect(JSON.stringify(after.hooks?.Stop)).toMatch(/foreign-stop/);
    expect(fs.existsSync(path.join(skillDir, "SKILL.md"))).toBe(false);
    expect(
      fs.existsSync(
        path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("Cursor-only uninstall skips corrupt leftover .claude/settings.json", () => {
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
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      "{not-json",
      "utf8",
    );

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actions.some((a) => /skip \.claude\/settings\.json/i.test(a))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(false);
  });

  it("Cursor-only uninstall soft-skips Autopilot Claude settings under symlinked .claude", () => {
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

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ah-claude-link-"));
    fs.writeFileSync(
      path.join(outside, "settings.json"),
      JSON.stringify(
        {
          env: { CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: "0" },
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command: "node .autopilot/bin/autopilot-harness-hook.mjs --event Stop",
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
    fs.symlinkSync(outside, path.join(root, ".claude"));

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actions.some((a) => /skip \.claude\/settings\.json/i.test(a))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(false);
    // Outside tree must remain untouched (no write-through).
    expect(
      JSON.stringify(
        JSON.parse(fs.readFileSync(path.join(outside, "settings.json"), "utf8")),
      ),
    ).toMatch(/CLAUDE_CODE_STOP_HOOK_BLOCK_CAP/);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("Cursor-only uninstall soft-skips Claude skills under symlinked .claude", () => {
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

    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ah-claude-skill-"));
    const skillOutside = path.join(outside, "skills", "autopilot-on");
    fs.mkdirSync(skillOutside, { recursive: true });
    fs.writeFileSync(path.join(skillOutside, "SKILL.md"), "# outside\n");
    fs.symlinkSync(outside, path.join(root, ".claude"));

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.actions.some((a) => /skip \.claude\/skills\/autopilot-on/i.test(a)),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".cursor", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(false);
    expect(fs.existsSync(path.join(skillOutside, "SKILL.md"))).toBe(true);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("Claude-only uninstall fails closed on corrupt settings.json", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "claude-code",
        surface: "cli",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      "{not-json",
      "utf8",
    );

    const r = uninstallProject({ projectRoot: root });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/settings\.json/i);
  });
});
