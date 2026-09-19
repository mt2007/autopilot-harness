/**
 * init / doctor / upgrade / uninstall / --add-platform for Devin CLI.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEVIN_HOOKS_REL_PATH,
  DEVIN_SOFT_MIN_VERSION,
  INSTALLABLE_BINDINGS,
  defaultSurfaceFor,
  devinHooksContainAutopilot,
  devinConfigJsonContainsAutopilot,
  installInitYes,
  isDevinVersionBelowSoftMin,
  isInstallableBinding,
  isParseableDevinVersion,
  normalizeBinding,
  probeDevinCliVersion,
  runDoctor,
  uninstallProject,
  upgradeProject,
  validateDevinHooksShape,
} from "../src/index.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-devin-init-"));
}

describe("devin installable binding", () => {
  it("INSTALLABLE_BINDINGS includes devin/cli", () => {
    expect(
      INSTALLABLE_BINDINGS.some((b) => b.id === "devin" && b.surface === "cli"),
    ).toBe(true);
    expect(defaultSurfaceFor("devin")).toBe("cli");
    expect(isInstallableBinding({ id: "devin", surface: "cli" })).toBe(true);
    expect(normalizeBinding("devin")).toEqual({ id: "devin", surface: "cli" });
  });

  it("isDevinVersionBelowSoftMin ignores unparseable; compares dotted versions", () => {
    expect(isParseableDevinVersion(null)).toBe(false);
    expect(isParseableDevinVersion("devin-nightly")).toBe(false);
    expect(isParseableDevinVersion(DEVIN_SOFT_MIN_VERSION)).toBe(true);
    expect(isDevinVersionBelowSoftMin(null)).toBe(false);
    expect(isDevinVersionBelowSoftMin("devin-nightly")).toBe(false);
    expect(isDevinVersionBelowSoftMin("3000.10.30")).toBe(true);
    expect(isDevinVersionBelowSoftMin(DEVIN_SOFT_MIN_VERSION)).toBe(false);
    expect(isDevinVersionBelowSoftMin("3000.11.0")).toBe(false);
  });

  it("probeDevinCliVersion accepts injectable runner", () => {
    expect(probeDevinCliVersion(() => "devin 3000.10.31 (b98cc431)\n")).toBe(
      "3000.10.31",
    );
    expect(
      probeDevinCliVersion(() => `${"banner ".repeat(40)}3000.10.31\n`),
    ).toBe("3000.10.31");
    expect(
      probeDevinCliVersion(() => "node 22.11.0\ndevin 3000.10.31 (abc)\n"),
    ).toBe("3000.10.31");
    expect(probeDevinCliVersion(() => "no-version-here")).toBe("no-version-here");
    expect(
      probeDevinCliVersion(() => {
        throw new Error("missing");
      }),
    ).toBeNull();
  });
});

describe("devin init / add-platform / doctor / uninstall", () => {
  let root = "";

  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("init writes hooks.v1.json + .devin/skills, not config.json or .agents", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platforms: [{ id: "devin", surface: "cli" }],
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const hooksPath = path.join(root, ".devin", "hooks.v1.json");
    expect(fs.existsSync(hooksPath)).toBe(true);
    const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(devinHooksContainAutopilot(hooks)).toBe(true);
    const stop = hooks.Stop as Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>;
    const cmd = stop?.[0]?.hooks?.[0]?.command ?? "";
    expect(cmd).toContain("$DEVIN_PROJECT_DIR");
    expect(cmd).toContain("--platform devin");
    expect(stop?.[0]?.hooks?.[0]?.timeout).toBe(120);
    expect(fs.existsSync(path.join(root, ".devin", "config.json"))).toBe(false);

    expect(
      fs.existsSync(
        path.join(root, ".devin", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(root, ".agents", "skills"))).toBe(false);

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.devin\/hooks\.v1\.json/);
    expect(ignore).toMatch(/\.devin\/skills\//);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id: devin/);
    expect(cfg).toMatch(/surface: cli/);
  });

  it("add-platform devin keeps Cursor hooks and writes Devin wiring", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        force: false,
        locale: "en",
      }).ok,
    ).toBe(true);

    const add = installInitYes({
      projectRoot: root,
      platforms: [{ id: "devin", surface: "cli" }],
      locale: "en",
      force: true,
      mergePlatforms: true,
    });
    expect(add.ok).toBe(true);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/id: cursor/);
    expect(cfg).toMatch(/id: devin/);
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".devin", "hooks.v1.json"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, ".devin", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("doctor FAILs missing fingerprint; WARNs /hooks · -p · Desktop tip · cap", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const okDoc = runDoctor(root);
    const okText = okDoc.lines.join("\n");
    expect(okText).toMatch(
      new RegExp(`OK\\s+${DEVIN_HOOKS_REL_PATH.replace(/\./g, "\\.")}`),
    );
    expect(okText).toMatch(/WARN\s+Devin CLI: review hooks in \/hooks/i);
    expect(okText).toMatch(/WARN\s+Devin tip:.*`-p`/i);
    expect(okText).toMatch(/WARN\s+Devin tip: CLI only — Desktop not tested/i);
    expect(okText).toMatch(/WARN\s+Devin CLI Stop-continue: no documented/i);
    expect(okText).not.toMatch(/FAIL\s+.*Desktop/i);

    fs.unlinkSync(path.join(root, ".devin", "hooks.v1.json"));
    const failDoc = runDoctor(root);
    expect(failDoc.ok).toBe(false);
    expect(failDoc.lines.join("\n")).toMatch(
      new RegExp(`FAIL\\s+${DEVIN_HOOKS_REL_PATH.replace(/\./g, "\\.")} missing`),
    );
  });

  it("doctor WARNs low timeout and missing $DEVIN_PROJECT_DIR without false OK", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hooksPath = path.join(root, ".devin", "hooks.v1.json");
    const file = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      Stop: Array<{ hooks: Array<{ command: string; timeout?: number }> }>;
      UserPromptSubmit: Array<{
        hooks: Array<{ command: string; timeout?: number }>;
      }>;
      PostToolUse: Array<{
        hooks: Array<{ command: string; timeout?: number }>;
      }>;
    };
    for (const event of ["Stop", "UserPromptSubmit", "PostToolUse"] as const) {
      for (const group of file[event]) {
        for (const h of group.hooks ?? []) {
          h.timeout = 30;
          h.command = h.command.replace(/\$DEVIN_PROJECT_DIR/g, ".");
        }
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(file, null, 2) + "\n", "utf8");

    const joined = runDoctor(root).lines.join("\n");
    expect(joined).toMatch(/WARN\s+Autopilot Devin hook timeout below 120/i);
    expect(joined).toMatch(
      /WARN\s+Autopilot Devin hooks missing \$DEVIN_PROJECT_DIR/i,
    );
    expect(joined).not.toMatch(
      new RegExp(`OK\\s+${DEVIN_HOOKS_REL_PATH.replace(/\./g, "\\.")}`),
    );
  });

  it("devinHooksContainAutopilot ignores prose description strings", () => {
    expect(
      devinHooksContainAutopilot({
        description:
          'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
      }),
    ).toBe(false);
    expect(
      devinHooksContainAutopilot({
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
                timeout: 120,
              },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("validateDevinHooksShape allows description prose; rejects flat Autopilot object", () => {
    expect(
      validateDevinHooksShape({
        description:
          'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
                timeout: 120,
              },
            ],
          },
        ],
      }),
    ).toBeNull();
    expect(
      validateDevinHooksShape({
        hooks: {
          description:
            'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
        },
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
                timeout: 120,
              },
            ],
          },
        ],
      }),
    ).toBeNull();
    expect(
      validateDevinHooksShape({
        notes: {
          type: "command",
          command:
            'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
        },
      }),
    ).toMatch(/must be under a top-level event array/i);
  });

  it("config.json prose under hooks is not an Autopilot fingerprint", () => {
    expect(
      devinConfigJsonContainsAutopilot({
        hooks: {
          description:
            'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs',
        },
      }),
    ).toBe(false);
    expect(
      devinConfigJsonContainsAutopilot({
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  command:
                    'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
                },
              ],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("init keeps sibling description string when merging Autopilot hooks", () => {
    root = tmpProject();
    const hooksPath = path.join(root, ".devin", "hooks.v1.json");
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(
      hooksPath,
      JSON.stringify(
        {
          description:
            'See node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs for Autopilot',
          PreToolUse: [
            { hooks: [{ type: "command", command: "echo sibling" }] },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const result = installInitYes({
      projectRoot: root,
      platforms: [{ id: "devin", surface: "cli" }],
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(typeof after.description).toBe("string");
    expect(Array.isArray(after.PreToolUse)).toBe(true);
    expect(devinHooksContainAutopilot(after)).toBe(true);
  });

  it("doctor WARNs Runner + Devin under one_executor", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "devin", surface: "cli" },
          { id: "runner", surface: "runner" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const joined = runDoctor(root).lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+Runner \+ hook host under concurrency\.mode: one_executor/i,
    );
  });

  it("doctor WARNs when DEVIN_SANDBOX is set", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const prev = process.env.DEVIN_SANDBOX;
    try {
      process.env.DEVIN_SANDBOX = "1";
      const joined = runDoctor(root).lines.join("\n");
      expect(joined).toMatch(/WARN\s+DEVIN_SANDBOX is set/i);
      expect(joined).not.toMatch(/FAIL\s+.*DEVIN_SANDBOX/i);
    } finally {
      if (prev === undefined) delete process.env.DEVIN_SANDBOX;
      else process.env.DEVIN_SANDBOX = prev;
    }
  });

  it("doctor WARNs Devin+Claude dual fingerprints when both enabled", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [
          { id: "devin", surface: "cli" },
          { id: "claude-code", surface: "cli" },
        ],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const joined = runDoctor(root).lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+Devin CLI \+ Claude Code both enabled — dual Autopilot fingerprints/i,
    );
  });

  it("doctor WARNs skills dual-open under .devin and .agents", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const agentsSkill = path.join(
      root,
      ".agents",
      "skills",
      "autopilot-on",
    );
    fs.mkdirSync(agentsSkill, { recursive: true });
    fs.writeFileSync(path.join(agentsSkill, "SKILL.md"), "# leftover\n", "utf8");

    const joined = runDoctor(root).lines.join("\n");
    expect(joined).toMatch(
      /WARN\s+Autopilot skills under both \.devin\/skills and \.agents\/skills/i,
    );
  });

  it("doctor WARNs config.json Autopilot hooks residual", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    fs.writeFileSync(
      path.join(root, ".devin", "config.json"),
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command:
                      'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const joined = runDoctor(root).lines.join("\n");
    expect(joined).toMatch(
      /\.devin\/config\.json hooks still list Autopilot/i,
    );
    expect(joined).not.toMatch(/FAIL\s+.*config\.json/i);
  });

  it("doctor leftover config.json-only does not claim uninstall clears it", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "cursor", surface: "ide" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    fs.mkdirSync(path.join(root, ".devin"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".devin", "config.json"),
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command:
                      'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const joined = runDoctor(root).lines.join("\n");
    expect(joined).toMatch(
      /leftover \.devin\/config\.json Autopilot hooks.*does not strip config\.json/i,
    );
    expect(joined).not.toMatch(
      /leftover \.devin\/hooks\.v1\.json Autopilot fingerprint/i,
    );
  });

  it("doctor does not tell uninstall to strip an invalid hooks shape", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "cursor", surface: "ide" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    fs.mkdirSync(path.join(root, ".devin"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".devin", "hooks.v1.json"),
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: "command",
                    command:
                      'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event Stop',
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const joined = runDoctor(root).lines.join("\n");
    expect(joined).toMatch(
      /leftover \.devin\/hooks\.v1\.json Autopilot is an invalid shape/i,
    );
    expect(joined).toMatch(/will not strip it/i);
    expect(joined).not.toMatch(
      /leftover \.devin\/hooks\.v1\.json Autopilot fingerprint \(devin not in platforms\) — uninstall or add-platform/i,
    );
  });

  it("symlink .devin/hooks.v1.json fail-closed on init", () => {
    root = tmpProject();
    const devinDir = path.join(root, ".devin");
    fs.mkdirSync(devinDir, { recursive: true });
    const dest = path.join(devinDir, "hooks.v1.json");
    const outside = path.join(root, "outside-hooks.json");
    fs.writeFileSync(outside, "{}\n", "utf8");
    fs.symlinkSync(outside, dest);

    const result = installInitYes({
      projectRoot: root,
      platforms: [{ id: "devin", surface: "cli" }],
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/symlink/i);
  });

  it("upgrade refreshes Devin hooks timeout and stamp", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hooksPath = path.join(root, ".devin", "hooks.v1.json");
    const stale = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      Stop: Array<{ hooks: Array<{ command: string; timeout?: number }> }>;
    };
    for (const group of stale.Stop) {
      for (const h of group.hooks ?? []) {
        h.timeout = 30;
        h.command = h.command.replace(/\$DEVIN_PROJECT_DIR/g, ".");
      }
    }
    fs.writeFileSync(hooksPath, JSON.stringify(stale, null, 2) + "\n", "utf8");

    const up = upgradeProject({ projectRoot: root, dryRun: false });
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(up.actions.some((a) => a.includes(DEVIN_HOOKS_REL_PATH))).toBe(true);

    const fresh = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
      Stop: Array<{ hooks: Array<{ command: string; timeout?: number }> }>;
    };
    const handler = fresh.Stop.flatMap((g) => g.hooks ?? []).find((h) =>
      h.command?.includes("autopilot-harness-hook"),
    );
    expect(handler?.timeout).toBe(120);
    expect(handler?.command).toContain("$DEVIN_PROJECT_DIR");
  });

  it("uninstall strips hooks and .devin/skills; keeps sibling events", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hooksPath = path.join(root, ".devin", "hooks.v1.json");
    const before = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as Record<
      string,
      unknown
    >;
    before.PreToolUse = [
      {
        hooks: [{ type: "command", command: "echo sibling" }],
      },
    ];
    fs.writeFileSync(hooksPath, JSON.stringify(before, null, 2) + "\n", "utf8");

    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(true);
    if (!un.ok) return;

    expect(
      fs.existsSync(
        path.join(root, ".devin", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(false);

    const after = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as Record<
      string,
      unknown
    >;
    expect(devinHooksContainAutopilot(after)).toBe(false);
    expect(Array.isArray(after.PreToolUse)).toBe(true);
    expect(after.Stop).toBeUndefined();
  });

  it("uninstall unlinks vacant hooks.v1.json when only Autopilot remained", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(true);
    expect(fs.existsSync(path.join(root, ".devin", "hooks.v1.json"))).toBe(
      false,
    );
  });

  it("uninstall fail-closed on .devin/hooks.v1.json symlink when wantDevin", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const hooksPath = path.join(root, ".devin", "hooks.v1.json");
    const outside = path.join(root, "outside-hooks.json");
    fs.copyFileSync(hooksPath, outside);
    fs.unlinkSync(hooksPath);
    fs.symlinkSync(outside, hooksPath);

    const un = uninstallProject({ projectRoot: root, dryRun: false });
    expect(un.ok).toBe(false);
    if (un.ok) return;
    expect(un.error).toMatch(/symlink/i);
  });
});
