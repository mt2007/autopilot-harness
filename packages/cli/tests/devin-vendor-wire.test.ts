/**
 * v0.15 vendor-platform-wire — INSTALLABLE devin/cli; vendor exports; eleven-way
 * shell KNOWN_PLATFORMS; Devin↔existing stamp abort; workspace:* publish list.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import {
  INSTALLABLE_BINDINGS,
  defaultSurfaceFor,
  formatBindingOptionLabel,
  isInstallableBinding,
  normalizeBinding,
} from "../src/init/platforms.js";
import {
  DEVIN_HOOKS_REL_PATH,
  mergeDevinHooks,
} from "../src/init/devin-hooks-merge.js";
import { installInitYes, applyDevinSkillFrontmatter } from "../src/init/install.js";
import { DEFAULT_PLANS_DIR } from "../src/init/artifact-defaults.js";
import { DEVIN_PLATFORM } from "@autopilot-harness/port-devin";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliRoot, "../..");
const HOOK_ASSET = path.join(cliRoot, "assets/autopilot-harness-hook.mjs");
const VENDOR_ENTRY = path.join(cliRoot, "src/vendor-entry.ts");
const BUNDLE_SCRIPT = path.join(cliRoot, "scripts/bundle-vendor.mjs");
const VENDOR_RUNTIME = path.join(cliRoot, "assets/vendor/runtime.mjs");

const ELEVEN_SHELL = [
  "cursor",
  "claude-code",
  "codex",
  "kimi-code",
  "copilot-cli",
  "grok-build",
  "gemini-cli",
  "factory-droid",
  "hermes-agent",
  "antigravity",
  "devin",
] as const;

describe("vendor-platform-wire (devin)", () => {
  it("INSTALLABLE_BINDINGS includes devin/cli", () => {
    expect(
      INSTALLABLE_BINDINGS.some((b) => b.id === "devin" && b.surface === "cli"),
    ).toBe(true);
    expect(defaultSurfaceFor("devin")).toBe("cli");
    expect(isInstallableBinding({ id: "devin", surface: "cli" })).toBe(true);
    expect(normalizeBinding("devin")).toEqual({ id: "devin", surface: "cli" });
    expect(formatBindingOptionLabel({ id: "devin", surface: "cli" })).toMatch(
      /Devin/i,
    );
    expect(DEVIN_PLATFORM).toBe("devin");
    expect(DEVIN_HOOKS_REL_PATH).toBe(".devin/hooks.v1.json");
  });

  it("shell KNOWN_PLATFORMS is eleven-way with devin; NON_SHELL stays pi+runner", () => {
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    const known = src.match(
      /KNOWN_PLATFORMS\s*=\s*new Set\(\[([\s\S]*?)\]\)/,
    );
    expect(known).toBeTruthy();
    const ids = [...(known?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(11);
    expect(new Set(ids)).toEqual(new Set(ELEVEN_SHELL));
    expect(ids).toContain("devin");
    expect(ids).not.toContain("pi");
    expect(ids).not.toContain("runner");
    expect(src).toMatch(
      /NON_SHELL_PLATFORMS\s*=\s*new Set\(\[\s*"pi"\s*,\s*"runner"\s*\]\)/,
    );
    expect(src).toMatch(/Dispatch is explicit eleven-way/);
  });

  it("Devin package-only fallbacks exclude other host stop aliases/stamps", () => {
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    const stopFn = src.match(
      /function devinStopHandler\(port\) \{([\s\S]*?)\n\}/,
    );
    expect(stopFn?.[1]).toMatch(/handleCodexStop/);
    expect(stopFn?.[1]).toMatch(/handleKimiStop/);
    expect(stopFn?.[1]).toMatch(/handleFactoryStop/);
    expect(stopFn?.[1]).toMatch(/HERMES_PLATFORM/);
    expect(stopFn?.[1]).toMatch(/ANTIGRAVITY_PLATFORM/);
    // UPS / Post / hostPortReady package-only blocks for hostId === "devin"
    const upsBlocks = [
      ...src.matchAll(
        /if \(hostId === "devin"\) \{([\s\S]*?)\n  if \(hostId === "/g,
      ),
    ].map((m) => m[1]);
    expect(upsBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of upsBlocks) {
      if (!/handleUserPromptSubmit|handlePostToolUse|handleDevinUserPromptSubmit/.test(block)) {
        continue;
      }
      expect(block).toMatch(/handleCodexStop/);
      expect(block).toMatch(/FACTORY_PLATFORM/);
      expect(block).toMatch(/ANTIGRAVITY_PLATFORM/);
    }
    // Antigravity Post package-only must refuse a Devin-stamped dual export
    const agPost = src.match(
      /if \(hostId === "antigravity"\) \{[\s\S]*?handleAntigravityPostToolUse[\s\S]*?return undefined;\n  \}/,
    );
    expect(agPost?.[0]).toMatch(/DEVIN_PLATFORM !== "devin"/);
  });

  it("mergeDevinHooks stamps $DEVIN_PROJECT_DIR + --platform devin + timeout 120", () => {
    const merged = mergeDevinHooks(null);
    for (const event of ["UserPromptSubmit", "PostToolUse", "Stop"] as const) {
      const groups = merged[event] as Array<{
        matcher?: string;
        hooks?: Array<{ command?: string; timeout?: number }>;
      }>;
      expect(Array.isArray(groups)).toBe(true);
      const cmd = groups[0]?.hooks?.[0]?.command ?? "";
      expect(cmd).toMatch(/\$DEVIN_PROJECT_DIR/);
      expect(cmd).toMatch(/--platform devin/);
      expect(cmd).toMatch(new RegExp(`--event ${event}`));
      expect(groups[0]?.hooks?.[0]?.timeout).toBe(120);
    }
    const post = merged.PostToolUse as Array<{ matcher?: string }>;
    expect(post[0]?.matcher).toBe(
      "^(write|edit|apply_patch|notebook_edit)$",
    );
  });

  it("mergeDevinHooks strips foreign Autopilot stamps and keeps sibling events", () => {
    const merged = mergeDevinHooks({
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: 'echo "foreign sibling"',
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command:
                'node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform claude-code --event UserPromptSubmit',
              timeout: 60,
            },
          ],
        },
      ],
    });
    const ups = merged.UserPromptSubmit as Array<{
      hooks?: Array<{ command?: string; timeout?: number }>;
    }>;
    expect(ups).toHaveLength(1);
    expect(ups[0]?.hooks?.[0]?.command).toMatch(/--platform devin/);
    expect(ups[0]?.hooks?.[0]?.command).not.toMatch(/claude-code/);
    expect(ups[0]?.hooks?.[0]?.timeout).toBe(120);
    const sibling = merged.SessionStart as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    expect(sibling[0]?.hooks?.[0]?.command).toBe('echo "foreign sibling"');
  });

  it("mergeDevinHooks refuses a hooks key that is not an object", () => {
    expect(() =>
      mergeDevinHooks({
        hooks: [
          {
            hooks: [
              {
                command:
                  "node .autopilot/bin/autopilot-harness-hook.mjs --platform claude-code --event Stop",
              },
            ],
          },
        ],
      }),
    ).toThrow(/must be an object/i);
  });

  it("mergeDevinHooks refuses nested hooks wrap that already carries Autopilot", () => {
    expect(() =>
      mergeDevinHooks({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  command:
                    "node .autopilot/bin/autopilot-harness-hook.mjs --platform claude-code --event UserPromptSubmit",
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(/top-level event keys/i);
  });

  it("mergeDevinHooks keeps prose mentioning the hook filename (not a command)", () => {
    const merged = mergeDevinHooks({
      description: "See autopilot-harness-hook.mjs in docs — not a hook command.",
      SessionStart: [
        {
          hooks: [{ type: "command", command: 'echo "ok"' }],
        },
      ],
    });
    expect(merged.description).toMatch(/autopilot-harness-hook\.mjs/);
    expect(
      (merged.SessionStart as Array<{ hooks?: Array<{ command?: string }> }>)[0]
        ?.hooks?.[0]?.command,
    ).toBe('echo "ok"');
  });

  it("applyDevinSkillFrontmatter rewrites block-list triggers without orphan YAML", () => {
    const body = `---
name: autopilot-on
description: "x"
triggers:
  - user
  - model
---

Body.
`;
    const out = applyDevinSkillFrontmatter(body);
    expect(out).toMatch(/^triggers:\s*\[user\]\s*$/m);
    expect(out).not.toMatch(/^\s*-\s*user\s*$/m);
    expect(out).not.toMatch(/^triggers:\s*\[[^\]]*model/m);
    expect(out).not.toMatch(/^\s*-\s*model\s*$/m);
    expect(out).toMatch(/\nBody\.\n/);
  });

  it("applyDevinSkillFrontmatter drops a sibling triggers scalar when [user] is also present", () => {
    const body = `---
name: autopilot-on
triggers: [user]
triggers: model
---

Body.
`;
    const once = applyDevinSkillFrontmatter(body);
    expect(once).toMatch(/^triggers:\s*\[user\]\s*$/m);
    expect(once).not.toMatch(/^triggers:\s*model\s*$/m);
    expect(applyDevinSkillFrontmatter(once)).toBe(once);
  });

  it("Stop writer disables UPS inject (source contract)", () => {
    const src = fs.readFileSync(HOOK_ASSET, "utf8");
    expect(src).toMatch(
      /writeDevinReply\(result,\s*\{\s*allowInject:\s*false\s*\}\)/,
    );
    // Inject is opt-in (Antigravity-shaped); UPS must pass allowInject: true.
    expect(src).toMatch(
      /writeDevinReply\(result,\s*\{\s*allowInject:\s*true\s*\}\)/,
    );
    const writer = src.match(
      /function writeDevinReply\(result, opts = \{\}\) \{([\s\S]*?)\n\}/,
    );
    expect(writer?.[1]).toMatch(/allowInject === true/);
    // Empty-reason block must silence inside writeDevinReply — never fall through to inject.
    expect(writer?.[1]).toMatch(
      /if \(result\.decision === "block"\) \{[\s\S]*?writeReply\(""\);\s*return;/,
    );
  });

  it("installed hook: UPS needPick inject; Post empty; Stop block without inject", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-devin-io-"));
    try {
      const r = installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      });
      expect(r.ok, r.error).toBe(true);
      const checklist = path.join(root, DEFAULT_PLANS_DIR, "alpha", "checklist.md");
      fs.mkdirSync(path.join(root, DEFAULT_PLANS_DIR, "alpha"), { recursive: true });
      fs.mkdirSync(path.join(root, DEFAULT_PLANS_DIR, "beta"), { recursive: true });
      fs.writeFileSync(checklist, "# Checklist — alpha\n\n- [ ] a — A\n");
      fs.writeFileSync(
        path.join(root, DEFAULT_PLANS_DIR, "beta", "checklist.md"),
        "# Checklist — beta\n\n- [ ] b — B\n",
      );
      const hook = path.join(
        root,
        ".autopilot",
        "bin",
        "autopilot-harness-hook.mjs",
      );
      const spawnDevin = (event: string, payload: Record<string, unknown>) => {
        const proc = spawnSync(
          process.execPath,
          [hook, "--platform", "devin", "--event", event],
          {
            cwd: root,
            input: JSON.stringify(payload),
            encoding: "utf8",
            timeout: 20_000,
            env: { ...process.env, DEVIN_PROJECT_DIR: root },
          },
        );
        if (proc.error) throw proc.error;
        return {
          status: proc.status ?? -1,
          stdout: proc.stdout ?? "",
          stderr: proc.stderr ?? "",
        };
      };

      const cid = "devin-wire-io-0001";
      const on = spawnDevin("UserPromptSubmit", {
        session_id: cid,
        prompt: "Autopilot ON",
      });
      expect(on.status).toBe(0);
      expect(on.stdout).toBe("");

      const pick = spawnDevin("UserPromptSubmit", {
        session_id: cid,
        prompt: "Autopilot RUN",
      });
      expect(pick.status).toBe(0);
      expect(pick.stdout.length).toBeGreaterThan(0);
      const pickOut = JSON.parse(pick.stdout.trim()) as {
        hookSpecificOutput?: {
          hookEventName?: string;
          additionalContext?: string;
        };
        decision?: string;
      };
      expect(pickOut.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
      expect(pickOut.hookSpecificOutput?.additionalContext).toMatch(
        /alpha|beta|Select a plan/i,
      );
      expect(pickOut.decision).toBeUndefined();
      expect(Object.keys(pickOut).sort()).toEqual(["hookSpecificOutput"]);

      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      const editFile = path.join(root, "src", "wire-edit.ts");
      fs.writeFileSync(editFile, "export const n = 1;\n");

      // Seed executing lease (install tree already has state.db from ON/RUN).
      const armed = new StateStore(root);
      armed.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: DEVIN_PLATFORM,
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "alpha",
        checklist_path: checklist,
      });
      armed.close();

      const post = spawnDevin("PostToolUse", {
        session_id: cid,
        tool_name: "edit",
        tool_input: { file_path: editFile },
      });
      expect(post.status).toBe(0);
      expect(post.stdout).toBe("");
      const postStore = new StateStore(root);
      expect(postStore.getReviewChain(cid)?.code_edited).toBe(1);
      postStore.close();

      const stop = spawnDevin("Stop", {
        session_id: cid,
        stop_hook_active: false,
      });
      expect(stop.status).toBe(0);
      expect(stop.stdout.length).toBeGreaterThan(0);
      expect(stop.stdout.trim()).not.toBe("{}");
      const stopOut = JSON.parse(stop.stdout.trim()) as {
        decision?: string;
        reason?: string;
        continue?: boolean;
        hookSpecificOutput?: unknown;
      };
      expect(stopOut.decision).toBe("block");
      expect(stopOut.reason).toBeTruthy();
      expect(stopOut.continue).toBeUndefined();
      expect(stopOut).not.toHaveProperty("hookSpecificOutput");
      expect(Object.keys(stopOut).sort()).toEqual(["decision", "reason"]);

      // Missing session → empty allow (never {} / never inject).
      const silenceStop = spawnDevin("Stop", {
        session_id: "devin-wire-missing-stop",
        stop_hook_active: false,
      });
      expect(silenceStop.status).toBe(0);
      expect(silenceStop.stdout).toBe("");
      expect(silenceStop.stdout.trim()).not.toBe("{}");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("Devin stamp on Cursor event aborts with empty stdout before FSM", () => {
    const r = spawnSync(
      process.execPath,
      [HOOK_ASSET, "--event", "beforeSubmitPrompt", "--platform", "devin"],
      {
        input: JSON.stringify({ prompt: "hello" }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(r.status).toBe(0);
    expect(r.stdout ?? "").toBe("");
  });

  it("Devin stamp on Antigravity-only PreInvocation aborts with empty stdout", () => {
    // Wrong unique host event under Devin stamp stays empty (cross abort).
    const r = spawnSync(
      process.execPath,
      [HOOK_ASSET, "--event", "PreInvocation", "--platform", "devin"],
      {
        input: JSON.stringify({ conversationId: "x" }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(r.status).toBe(0);
    expect(r.stdout ?? "").toBe("");
  });

  it("vendor-entry + bundle script + runtime include port-devin aliases", () => {
    const entry = fs.readFileSync(VENDOR_ENTRY, "utf8");
    expect(entry).toMatch(/@autopilot-harness\/port-devin/);
    expect(entry).toMatch(/handleDevinUserPromptSubmit/);
    expect(entry).toMatch(/handleDevinPostToolUse/);
    expect(entry).toMatch(/handleDevinStop/);

    const bundle = fs.readFileSync(BUNDLE_SCRIPT, "utf8");
    expect(bundle).toMatch(/port-devin/);

    expect(fs.existsSync(VENDOR_RUNTIME)).toBe(true);
    const runtime = fs.readFileSync(VENDOR_RUNTIME, "utf8");
    expect(runtime).toMatch(/handleDevinStop|DEVIN_PLATFORM/);
  });

  it("init wires .devin/hooks.v1.json + .devin/skills with triggers:[user]; no .agents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-devin-wire-"));
    try {
      const r = installInitYes({
        projectRoot: root,
        platforms: [{ id: "devin", surface: "cli" }],
        locale: "en",
        force: false,
      });
      expect(r.ok, r.error).toBe(true);
      const hooksPath = path.join(root, DEVIN_HOOKS_REL_PATH);
      expect(fs.existsSync(hooksPath)).toBe(true);
      const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as Record<
        string,
        unknown
      >;
      expect(hooks).not.toHaveProperty("hooks");
      expect(JSON.stringify(hooks)).toMatch(/\$DEVIN_PROJECT_DIR/);
      expect(JSON.stringify(hooks)).toMatch(/--platform devin/);
      const skill = fs.readFileSync(
        path.join(root, ".devin/skills/autopilot-on/SKILL.md"),
        "utf8",
      );
      expect(skill).toMatch(/^triggers:\s*\[user\]\s*$/m);
      expect(fs.existsSync(path.join(root, ".agents/skills"))).toBe(false);
      expect(fs.existsSync(path.join(root, ".devin/config.json"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("cli depends on port-devin workspace and public package list includes it", () => {
    const cliPkg = JSON.parse(
      fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(cliPkg.dependencies?.["@autopilot-harness/port-devin"]).toBe(
      "workspace:*",
    );
    const publicList = fs.readFileSync(
      path.join(cliRoot, "tests/public-npm-packages.ts"),
      "utf8",
    );
    expect(publicList).toMatch(/packages\/ports\/devin\/package\.json/);
    expect(
      fs.existsSync(path.join(repoRoot, "packages/ports/devin/package.json")),
    ).toBe(true);
  });
});
