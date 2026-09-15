/**
 * Eight-host matrix: Factory ↔ Cursor/Claude/Codex/Kimi/Copilot/Grok/Gemini
 * cross-fire. Wrong stamp / wrong payload → abort (Cursor-shaped abort on Stop
 * → Cursor halt; Factory stamp forces empty-body writer — never JSON "{}";
 * Kimi stamp → bare exit 0; Gemini-unique events + wrong --platform → JSON
 * "{}"). Cursor-only events under Factory stamp fail-open empty before FSM.
 * Lookalike Stop + --platform factory-droid follows Factory stamp
 * (decision:block+reason). Prior seven hosts must not go red when Factory is
 * also enabled.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import {
  COPILOT_AUTOPILOT_EVENTS,
  COPILOT_HOOK_TIMEOUT_SEC,
} from "../src/init/copilot-hooks-merge.js";
import {
  autopilotFactoryHookCommandLine,
  FACTORY_AUTOPILOT_EVENTS,
  FACTORY_HOOK_TIMEOUT_SEC,
  FACTORY_HOOKS_REL_PATH,
  FACTORY_POST_TOOL_USE_MATCHER,
  hasCompleteFactoryAutopilotHooks,
  validateFactoryHooksShape,
} from "../src/init/factory-hooks-merge.js";
import {
  GEMINI_AUTOPILOT_EVENTS,
  GEMINI_AFTER_TOOL_MATCHER,
  GEMINI_HOOK_TIMEOUT_MS,
  GEMINI_SETTINGS_REL_PATH,
  GEMINI_WILDCARD_MATCHER,
} from "../src/init/gemini-settings-merge.js";
import {
  GROK_AUTOPILOT_EVENTS,
  GROK_HOOK_TIMEOUT_SEC,
  GROK_HOOKS_REL_PATH,
} from "../src/init/grok-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { GEMINI_AFTER_AGENT_TURN_CAP } from "../../ports/gemini-cli/src/index.js";
import { GROK_STOP_PER_TURN_BLOCK_CAP } from "../../ports/grok-build/src/index.js";
import { COPILOT_STOP_CONSECUTIVE_BLOCK_CAP } from "../../ports/copilot-cli/src/index.js";
import {
  FACTORY_DROID_DEGRADED_STOP_CONTINUE_CAP,
  FACTORY_PLATFORM,
} from "../../ports/factory-droid/src/index.js";

type HostId =
  | "cursor"
  | "claude-code"
  | "codex"
  | "kimi-code"
  | "copilot-cli"
  | "grok-build"
  | "gemini-cli"
  | "factory-droid";

const ALL_HOSTS: readonly HostId[] = [
  "cursor",
  "claude-code",
  "codex",
  "kimi-code",
  "copilot-cli",
  "grok-build",
  "gemini-cli",
  "factory-droid",
] as const;

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-eight-host-"));
}

function hookPath(root: string): string {
  return path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs");
}

function runHook(
  root: string,
  event: string,
  payload: Record<string, unknown>,
  platform?: string,
): {
  status: number | null;
  out: Record<string, unknown>;
  stdout: string;
  stderr: string;
} {
  const args = [hookPath(root)];
  if (platform) args.push("--platform", platform);
  args.push("--event", event);
  const proc = spawnSync(process.execPath, args, {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 15_000,
  });
  // Spawn failure / timeout must not look like Factory/Kimi Silence (empty).
  if (proc.error) {
    throw proc.error;
  }
  if (proc.status == null) {
    throw new Error(
      `eight-host hook spawn killed: event=${event} platform=${platform ?? "(none)"} signal=${proc.signal}`,
    );
  }
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  let out: Record<string, unknown> = {};
  try {
    out = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
  } catch {
    out = { __parse_error: stdout };
  }
  return { status: proc.status, out, stdout, stderr };
}

/** Assert wrong-stamp / abort halt shape for the argv stamp. */
function expectAbortHalt(
  r: {
    status: number | null;
    out: Record<string, unknown>;
    stdout: string;
    stderr: string;
  },
  platform: HostId,
): void {
  expect(r.status).toBe(0);
  expect(r.stderr.trim()).toBe("");
  expect(r.out.__parse_error).toBeUndefined();
  if (platform === "kimi-code" || platform === "factory-droid") {
    expect(r.stdout.length).toBe(0);
    expect(r.stdout.trim()).not.toBe("{}");
  } else {
    expect(r.stdout.trim()).toBe("{}");
  }
  expect(r.out).toEqual({});
  expect(r.out.decision).toBeUndefined();
  expect(r.out.continue).toBeUndefined();
  expect(r.out.reason).toBeUndefined();
  expect(r.out.stopReason).toBeUndefined();
  expect(r.out.hookSpecificOutput).toBeUndefined();
}

function seedChecklist(root: string, slug = "demo"): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(cp, "- [ ] a — A\n- [ ] b — B\n");
  return cp;
}

/** Cursor + Claude + Codex + Kimi + Copilot + Grok + Gemini + Factory. */
function installEightHost(root: string): void {
  expect(
    installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    }).ok,
  ).toBe(true);
  for (const [platform, surface] of [
    ["claude-code", "cli"],
    ["codex", "cli"],
    ["kimi-code", "cli"],
    ["copilot-cli", "cli"],
    ["grok-build", "cli"],
    ["gemini-cli", "cli"],
    ["factory-droid", "cli"],
  ] as const) {
    expect(
      installInitYes({
        projectRoot: root,
        platform,
        surface,
        platforms: [{ id: platform, surface }],
        mergePlatforms: true,
        locale: "en",
        force: true,
      }).ok,
    ).toBe(true);
  }
}

describe("eight-host Factory cross-fire matrix", () => {
  let root = "";
  let kimiHome = "";
  let prevKimiHome: string | undefined;

  afterEach(() => {
    if (kimiHome) {
      if (prevKimiHome === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = prevKimiHome;
      prevKimiHome = undefined;
      fs.rmSync(kimiHome, { recursive: true, force: true });
      kimiHome = "";
    }
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  function withKimiHome(): void {
    prevKimiHome = process.env.KIMI_CODE_HOME;
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-eight-kimi-"));
    process.env.KIMI_CODE_HOME = kimiHome;
  }

  it("eight install stamps all hosts; doctor stays ok for prior hosts + Factory", () => {
    root = tmpProject();
    withKimiHome();
    installEightHost(root);

    const cursorHooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as { hooks: Record<string, { command: string }[]> };
    for (const event of ["beforeSubmitPrompt", "afterFileEdit", "stop"]) {
      const ap = cursorHooks.hooks[event]?.filter((h) =>
        h.command.includes("autopilot-harness"),
      );
      expect(ap?.length).toBe(1);
      expect(ap![0].command).toMatch(/--platform cursor(?:\s|$)/);
    }

    expect(
      fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"),
    ).toMatch(/--platform codex(?:\s|$)/);

    const kimiToml = fs.readFileSync(path.join(kimiHome, "config.toml"), "utf8");
    expect(kimiToml).toMatch(/--platform kimi-code/);

    const copilotFile = JSON.parse(
      fs.readFileSync(
        path.join(root, ".github", "hooks", "autopilot-harness.json"),
        "utf8",
      ),
    ) as {
      hooks?: Record<string, Array<{ bash?: string; timeoutSec?: number }>>;
    };
    for (const event of COPILOT_AUTOPILOT_EVENTS) {
      expect(copilotFile.hooks?.[event]?.[0]?.bash).toMatch(
        /--platform copilot-cli/,
      );
      expect(copilotFile.hooks?.[event]?.[0]?.timeoutSec).toBe(
        COPILOT_HOOK_TIMEOUT_SEC,
      );
    }

    const grokPath = path.join(root, GROK_HOOKS_REL_PATH);
    const grokFile = JSON.parse(fs.readFileSync(grokPath, "utf8")) as {
      hooks?: Record<
        string,
        Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>
      >;
    };
    for (const event of GROK_AUTOPILOT_EVENTS) {
      const h = grokFile.hooks?.[event]?.[0]?.hooks?.[0];
      expect(h?.timeout).toBe(GROK_HOOK_TIMEOUT_SEC);
      expect(h?.command).toMatch(/--platform grok-build/);
    }

    expect(GEMINI_SETTINGS_REL_PATH).toBe(".gemini/settings.json");
    const geminiPath = path.join(root, ".gemini", "settings.json");
    const geminiFile = JSON.parse(fs.readFileSync(geminiPath, "utf8")) as {
      hooks?: Record<
        string,
        Array<{
          matcher?: string;
          hooks?: Array<{ name?: string; command?: string; timeout?: number }>;
        }>
      >;
    };
    for (const event of GEMINI_AUTOPILOT_EVENTS) {
      const groups = geminiFile.hooks?.[event];
      expect(Array.isArray(groups)).toBe(true);
      expect(groups!.length).toBe(1);
      const g = groups![0]!;
      if (event === "AfterTool") {
        expect(g.matcher).toBe(GEMINI_AFTER_TOOL_MATCHER);
      } else {
        expect(g.matcher).toBe(GEMINI_WILDCARD_MATCHER);
      }
      const h = g.hooks?.[0];
      expect(h?.name).toBe(`autopilot-harness-${event}`);
      expect(h?.timeout).toBe(GEMINI_HOOK_TIMEOUT_MS);
      expect(h?.command).toMatch(/--platform gemini-cli/);
      expect(h?.command).toMatch(new RegExp(`--event ${event}(?:\\s|$)`));
    }
    expect(fs.existsSync(path.join(root, ".gemini", "skills"))).toBe(false);

    // Factory hooks.json is top-level events (no nested `.hooks` bag).
    const factoryPath = path.join(root, FACTORY_HOOKS_REL_PATH);
    const factoryFile = JSON.parse(fs.readFileSync(factoryPath, "utf8")) as {
      hooks?: unknown;
      UserPromptSubmit?: Array<{
        matcher?: string;
        hooks?: Array<{ command?: string; timeout?: number }>;
      }>;
      PostToolUse?: Array<{
        matcher?: string;
        hooks?: Array<{ command?: string; timeout?: number }>;
      }>;
      Stop?: Array<{
        matcher?: string;
        hooks?: Array<{ command?: string; timeout?: number }>;
      }>;
    };
    expect(factoryFile.hooks).toBeUndefined();
    expect(validateFactoryHooksShape(factoryFile)).toBeNull();
    expect(hasCompleteFactoryAutopilotHooks(factoryFile)).toBe(true);
    for (const event of FACTORY_AUTOPILOT_EVENTS) {
      const groups = factoryFile[event];
      expect(Array.isArray(groups)).toBe(true);
      expect(groups!.length).toBe(1);
      const g = groups![0]!;
      if (event === "PostToolUse") {
        expect(g.matcher).toBe(FACTORY_POST_TOOL_USE_MATCHER);
      } else {
        expect(g.matcher).toBeUndefined();
      }
      const cmd = g.hooks?.[0]?.command ?? "";
      const timeout = g.hooks?.[0]?.timeout;
      expect(timeout).toBe(FACTORY_HOOK_TIMEOUT_SEC);
      // Exact stock line — quoted "$FACTORY_PROJECT_DIR" (Droid cwd ≠ root).
      expect(cmd).toBe(autopilotFactoryHookCommandLine(event));
    }

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.grok\/hooks\/\*\*/);
    expect(ignore).toMatch(/\.gemini\/settings\.json/);
    expect(ignore).toMatch(/\.factory\/hooks\.json/);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    for (const id of ALL_HOSTS) {
      expect(cfg).toMatch(new RegExp(`^\\s*-\\s*id:\\s*${id}\\s*$`, "m"));
    }

    const { ok, lines } = runDoctor(root, { kimiCodeHome: kimiHome });
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    expect(joined).not.toMatch(/\bFAIL\b/);
    expect(joined).toMatch(/OK\s+hooks\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+\.codex\/hooks\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+Kimi Code config\.toml Autopilot entries/);
    expect(joined).toMatch(
      /OK\s+\.github\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
    expect(joined).toMatch(
      /OK\s+\.grok\/hooks\/autopilot-harness\.json Autopilot entries/,
    );
    expect(joined).toMatch(
      /OK\s+\.gemini\/settings\.json Autopilot entries/,
    );
    expect(joined).toMatch(
      new RegExp(`OK\\s+${FACTORY_HOOKS_REL_PATH.replace(/\./g, "\\.")} Autopilot entries`),
    );
    expect(joined).toMatch(
      new RegExp(
        `Stop-continue consecutive block cap ≤${COPILOT_STOP_CONSECUTIVE_BLOCK_CAP}`,
        "i",
      ),
    );
    expect(joined).toMatch(
      new RegExp(
        `Stop-continue per-turn block cap ≤${GROK_STOP_PER_TURN_BLOCK_CAP}`,
        "i",
      ),
    );
    expect(joined).toMatch(
      new RegExp(
        `AfterAgent turn cap ≤${GEMINI_AFTER_AGENT_TURN_CAP}`,
        "i",
      ),
    );
    expect(joined).toMatch(
      /Factory Droid Stop-continue: no documented raise\/hard-cap/i,
    );
    expect(joined).toMatch(
      /Factory Droid multi-block under stop_hook_active is unproven/i,
    );
    expect(FACTORY_DROID_DEGRADED_STOP_CONTINUE_CAP).toBe(1);
    expect(joined).toMatch(/Factory Droid \+ Claude Code both enabled/i);
    expect(joined).toMatch(/Gemini CLI \+ Claude Code both enabled/i);
    expect(joined).toMatch(/folder trust/i);
  });

  it("lookalike Stop + --platform factory-droid follows Factory stamp (decision:block+reason)", () => {
    root = tmpProject();
    withKimiHome();
    installEightHost(root);
    const cp = seedChecklist(root);
    const cid = "eight-fac-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: FACTORY_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain(cid, { code_edited: 1 });
    store.close();

    const r = runHook(
      root,
      "Stop",
      {
        sessionId: cid,
        hook_event_name: "Stop",
        reason: "end_turn",
        stop_hook_active: false,
      },
      "factory-droid",
    );
    expect(r.status).toBe(0);
    expect(r.stderr.trim()).toBe("");
    expect(r.out.__parse_error).toBeUndefined();
    expect(r.out.decision).toBe("block");
    expect(typeof r.out.reason).toBe("string");
    expect(String(r.out.reason).length).toBeGreaterThan(0);
    expect(r.out.continue).toBeUndefined();
    expect(r.out.stopReason).toBeUndefined();
    expect(r.out.hookSpecificOutput).toBeUndefined();
    expect(Object.keys(r.out).sort()).toEqual(["decision", "reason"]);
    expect(r.stdout.trim()).not.toBe("");
    expect(r.stdout.trim()).not.toBe("{}");
    expect(JSON.parse(r.stdout.trim())).toEqual({
      decision: "block",
      reason: r.out.reason,
    });

    const verify = new StateStore(root);
    expect(verify.getSession(cid)?.platform).toBe(FACTORY_PLATFORM);
    expect(verify.getSession(cid)?.phase).toBe("executing");
    expect(verify.getSession(cid)?.armed).toBe(1);
    expect(verify.getReviewChain(cid)?.chain_pending).toBe(1);
    expect(verify.getReviewChain(cid)?.pending_followup).toBeTruthy();
    verify.close();
  });

  it(
    "Factory stamp + Cursor-shaped aborted payload → halt (wrong payload abort before FSM)",
    () => {
      root = tmpProject();
      withKimiHome();
      installEightHost(root);
      const cp = seedChecklist(root);
      const cid = "eight-abort-aaaa-bbbb-cccc-ddddeeee0002";
      const store = new StateStore(root);
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: FACTORY_PLATFORM,
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: cp,
      });
      store.updateReviewChain(cid, {
        code_edited: 1,
        chain_pending: 1,
        pending_followup: "Review fix round park",
      });
      store.close();

      const abortPlatforms: readonly HostId[] = [
        "factory-droid",
        "cursor",
        "claude-code",
        "codex",
        "kimi-code",
        "copilot-cli",
        "grok-build",
        "gemini-cli",
      ];
      for (const platform of abortPlatforms) {
        const before = (() => {
          const s = new StateStore(root);
          const tip = s.getReviewChain(cid)?.pending_followup ?? null;
          const pending = s.getReviewChain(cid)?.chain_pending ?? 0;
          s.close();
          return { tip, pending };
        })();
        const r = runHook(
          root,
          "Stop",
          {
            conversation_id: cid,
            status: "aborted",
            hook_event_name: "stop",
            loop_count: 0,
          },
          platform,
        );
        expectAbortHalt(r, platform);
        const mid = new StateStore(root);
        expect(mid.getSession(cid)?.platform).toBe(FACTORY_PLATFORM);
        expect(mid.getSession(cid)?.phase).toBe("executing");
        expect(mid.getSession(cid)?.error_count).toBe(0);
        expect(mid.getSession(cid)?.armed).toBe(1);
        expect(mid.getReviewChain(cid)?.pending_followup ?? null).toBe(
          before.tip,
        );
        expect(mid.getReviewChain(cid)?.chain_pending).toBe(before.pending);
        mid.close();
      }

      const verify = new StateStore(root);
      expect(verify.getSession(cid)).toEqual(
        expect.objectContaining({
          platform: FACTORY_PLATFORM,
          phase: "executing",
          error_count: 0,
          armed: 1,
        }),
      );
      expect(verify.getReviewChain(cid)?.pending_followup).toBe(
        "Review fix round park",
      );
      expect(verify.getReviewChain(cid)?.chain_pending).toBe(1);
      verify.close();
    },
    30_000,
  );

  it("wrong --platform / Cursor-only event does not wipe prior hosts or Factory", () => {
    root = tmpProject();
    withKimiHome();
    installEightHost(root);
    const cp = seedChecklist(root);
    const facKimiXf = "eight-xf-fac-kimi-aaaa-bbbb-cccc-ddddeeee0053";
    const facClaudeXf = "eight-xf-fac-cla-aaaa-bbbb-cccc-ddddeeee0054";
    const facAbortCid = "eight-xf-fac-abt-aaaa-bbbb-cccc-ddddeeee0055";
    const facWrongEv = "eight-xf-fac-wev-aaaa-bbbb-cccc-ddddeeee0056";
    const prior: Array<{ cid: string; platform: HostId }> = [
      { cid: "eight-xf-aaaa-bbbb-cccc-ddddeeee0013", platform: "cursor" },
      { cid: "eight-xf-aaaa-bbbb-cccc-ddddeeee0023", platform: "claude-code" },
      { cid: "eight-xf-aaaa-bbbb-cccc-ddddeeee0033", platform: "codex" },
      { cid: "eight-xf-aaaa-bbbb-cccc-ddddeeee0043", platform: "kimi-code" },
      { cid: "eight-xf-aaaa-bbbb-cccc-ddddeeee0053", platform: "copilot-cli" },
      { cid: "eight-xf-aaaa-bbbb-cccc-ddddeeee0063", platform: "grok-build" },
      { cid: "eight-xf-aaaa-bbbb-cccc-ddddeeee0073", platform: "gemini-cli" },
    ];
    const store = new StateStore(root);
    for (const { cid, platform } of prior) {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform,
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: cp,
      });
      store.updateReviewChain(cid, { code_edited: 1 });
    }
    for (const cid of [
      facKimiXf,
      facClaudeXf,
      facAbortCid,
      facWrongEv,
    ] as const) {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: FACTORY_PLATFORM,
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: cp,
      });
      store.updateReviewChain(cid, {
        code_edited: 1,
        chain_pending: 1,
        pending_followup: "park tip",
      });
    }
    store.close();

    const assertStamp = (cid: string, platform: HostId) => {
      const v = new StateStore(root);
      expect(v.getSession(cid)?.platform).toBe(platform);
      expect(v.getSession(cid)?.armed).toBe(1);
      v.close();
    };

    // Gemini-unique AfterAgent under Factory stamp → Gemini early gate "{}".
    // Factory session tip/stamp must survive (no FSM steal).
    const xfFacViaAfterAgent = runHook(
      root,
      "AfterAgent",
      {
        sessionId: facKimiXf,
        hook_event_name: "AfterAgent",
        stop_hook_active: false,
      },
      "factory-droid",
    );
    expect(xfFacViaAfterAgent.status).toBe(0);
    expect(xfFacViaAfterAgent.stdout.trim()).toBe("{}");
    expect(xfFacViaAfterAgent.stderr.trim()).toBe("");
    expect(xfFacViaAfterAgent.out).toEqual({});
    expect(xfFacViaAfterAgent.out.decision).toBeUndefined();
    assertStamp(facKimiXf, FACTORY_PLATFORM);
    {
      const mid = new StateStore(root);
      expect(mid.getSession(facKimiXf)?.phase).toBe("executing");
      expect(mid.getReviewChain(facKimiXf)?.pending_followup).toBe("park tip");
      expect(mid.getReviewChain(facKimiXf)?.chain_pending).toBe(1);
      mid.close();
    }

    // Gemini-unique BeforeAgent under Factory stamp → same early "{}" gate.
    const xfBeforeAgent = runHook(
      root,
      "BeforeAgent",
      { sessionId: facKimiXf, prompt: "hostile before-agent" },
      "factory-droid",
    );
    expect(xfBeforeAgent.status).toBe(0);
    expect(xfBeforeAgent.stdout.trim()).toBe("{}");
    expect(xfBeforeAgent.stderr.trim()).toBe("");
    expect(xfBeforeAgent.out).toEqual({});
    assertStamp(facKimiXf, FACTORY_PLATFORM);
    {
      const mid = new StateStore(root);
      expect(mid.getSession(facKimiXf)?.phase).toBe("executing");
      expect(mid.getReviewChain(facKimiXf)?.pending_followup).toBe("park tip");
      expect(mid.getReviewChain(facKimiXf)?.chain_pending).toBe(1);
      mid.close();
    }

    // Copilot camelCase under Factory stamp → fail-open empty before FSM
    // (UPS / Transform / postToolUse triad).
    const xfCopilotUps = runHook(
      root,
      "userPromptSubmitted",
      { sessionId: facKimiXf, prompt: "hostile copilot ups" },
      "factory-droid",
    );
    expectAbortHalt(xfCopilotUps, "factory-droid");
    assertStamp(facKimiXf, FACTORY_PLATFORM);
    {
      const mid = new StateStore(root);
      expect(mid.getSession(facKimiXf)?.phase).toBe("executing");
      expect(mid.getReviewChain(facKimiXf)?.pending_followup).toBe("park tip");
      expect(mid.getReviewChain(facKimiXf)?.chain_pending).toBe(1);
      mid.close();
    }
    const xfCopilotTransform = runHook(
      root,
      "userPromptTransformed",
      {
        sessionId: facKimiXf,
        transformedPrompt: "hostile transform",
      },
      "factory-droid",
    );
    expectAbortHalt(xfCopilotTransform, "factory-droid");
    assertStamp(facKimiXf, FACTORY_PLATFORM);
    {
      const mid = new StateStore(root);
      expect(mid.getSession(facKimiXf)?.phase).toBe("executing");
      expect(mid.getReviewChain(facKimiXf)?.pending_followup).toBe("park tip");
      expect(mid.getReviewChain(facKimiXf)?.chain_pending).toBe(1);
      mid.close();
    }
    const xfCopilotPost = runHook(
      root,
      "postToolUse",
      {
        sessionId: facKimiXf,
        toolName: "edit",
        tool_input: { path: path.join(root, "src", "nope.ts") },
      },
      "factory-droid",
    );
    expectAbortHalt(xfCopilotPost, "factory-droid");
    assertStamp(facKimiXf, FACTORY_PLATFORM);
    {
      const mid = new StateStore(root);
      expect(mid.getSession(facKimiXf)?.phase).toBe("executing");
      expect(mid.getReviewChain(facKimiXf)?.pending_followup).toBe("park tip");
      expect(mid.getReviewChain(facKimiXf)?.code_edited).toBe(1);
      mid.close();
    }

    // agentStop argv + Cursor-shaped abort (conversation_id + status aborted;
    // do NOT set hookEventName:agentStop — that excludes Cursor shape) under
    // Factory stamp → Cursor halt + Factory empty writer (never "{}").
    const xfAgentStopAbort = runHook(
      root,
      "agentStop",
      {
        conversation_id: facAbortCid,
        status: "aborted",
        loop_count: 0,
      },
      "factory-droid",
    );
    expectAbortHalt(xfAgentStopAbort, "factory-droid");
    assertStamp(facAbortCid, FACTORY_PLATFORM);
    {
      const mid = new StateStore(root);
      expect(mid.getSession(facAbortCid)?.phase).toBe("executing");
      expect(mid.getReviewChain(facAbortCid)?.pending_followup).toBe("park tip");
      expect(mid.getReviewChain(facAbortCid)?.chain_pending).toBe(1);
      mid.close();
    }

    // Shared Pascal Stop + Cursor-shaped abort under wrong --platform
    // claude-code → universal abort before Factory FSM; tip/stamp untouched.
    // (Plain Stop under Claude argv can still speak — dual-fingerprint WARN.)
    const tipBeforeClaude = (() => {
      const s = new StateStore(root);
      const tip = s.getReviewChain(facClaudeXf)?.pending_followup ?? null;
      s.close();
      return tip;
    })();
    const xfFac = runHook(
      root,
      "Stop",
      {
        conversation_id: facClaudeXf,
        status: "aborted",
        hook_event_name: "stop",
        loop_count: 0,
      },
      "claude-code",
    );
    expectAbortHalt(xfFac, "claude-code");
    assertStamp(facClaudeXf, FACTORY_PLATFORM);
    {
      const mid = new StateStore(root);
      expect(mid.getSession(facClaudeXf)?.phase).toBe("executing");
      expect(mid.getReviewChain(facClaudeXf)?.pending_followup ?? null).toBe(
        tipBeforeClaude,
      );
      expect(mid.getReviewChain(facClaudeXf)?.chain_pending).toBe(1);
      mid.close();
    }

    // Factory stamp + Cursor abort under factory argv → empty halt.
    const abortFac = runHook(
      root,
      "Stop",
      {
        conversation_id: facAbortCid,
        status: "aborted",
        hook_event_name: "stop",
        loop_count: 0,
      },
      "factory-droid",
    );
    expectAbortHalt(abortFac, "factory-droid");
    assertStamp(facAbortCid, FACTORY_PLATFORM);
    {
      const mid = new StateStore(root);
      expect(mid.getSession(facAbortCid)?.phase).toBe("executing");
      expect(mid.getReviewChain(facAbortCid)?.pending_followup).toBe("park tip");
      expect(mid.getReviewChain(facAbortCid)?.chain_pending).toBe(1);
      mid.close();
    }

    // Factory stamp + Cursor-only event → abort before FSM, zero-byte.
    const wrongEvent = runHook(
      root,
      "beforeSubmitPrompt",
      {
        conversation_id: facWrongEv,
        prompt: "hello",
        cwd: root,
      },
      "factory-droid",
    );
    expectAbortHalt(wrongEvent, "factory-droid");
    assertStamp(facWrongEv, FACTORY_PLATFORM);
    {
      const mid = new StateStore(root);
      expect(mid.getSession(facWrongEv)?.phase).toBe("executing");
      expect(mid.getReviewChain(facWrongEv)?.pending_followup).toBe("park tip");
      expect(mid.getReviewChain(facWrongEv)?.chain_pending).toBe(1);
      mid.close();
    }

    // Factory stamp + Claude-only StopFailure → fail-open empty (no tip wipe).
    const stopFail = runHook(
      root,
      "StopFailure",
      { session_id: facWrongEv, cwd: root },
      "factory-droid",
    );
    expectAbortHalt(stopFail, "factory-droid");
    assertStamp(facWrongEv, FACTORY_PLATFORM);
    {
      const mid = new StateStore(root);
      expect(mid.getSession(facWrongEv)?.phase).toBe("executing");
      expect(mid.getReviewChain(facWrongEv)?.pending_followup).toBe("park tip");
      expect(mid.getReviewChain(facWrongEv)?.chain_pending).toBe(1);
      mid.close();
    }

    for (const { cid, platform } of prior) {
      assertStamp(cid, platform);
      const mid = new StateStore(root);
      expect(mid.getSession(cid)?.phase).toBe("executing");
      expect(mid.getReviewChain(cid)?.code_edited).toBe(1);
      mid.close();
    }
  });

  it(
    "prior hosts survive Factory PostToolUse cross-fire (wrong payload / argv)",
    () => {
      root = tmpProject();
      withKimiHome();
      installEightHost(root);
      const cp = seedChecklist(root);
      const editPath = path.join(root, "src", "xf.ts");
      fs.mkdirSync(path.dirname(editPath), { recursive: true });
      fs.writeFileSync(editPath, "export {}\n");

      const cursorCid = "eight-cur-aaaa-bbbb-cccc-ddddeeee0004";
      const claudeCid = "eight-cla-aaaa-bbbb-cccc-ddddeeee0005";
      const codexCid = "eight-cdx-aaaa-bbbb-cccc-ddddeeee0006";
      const kimiCid = "eight-kim-aaaa-bbbb-cccc-ddddeeee0007";
      const copilotCid = "eight-cop-aaaa-bbbb-cccc-ddddeeee0008";
      const grokCid = "eight-grk-aaaa-bbbb-cccc-ddddeeee0009";
      const gemCid = "eight-gem-aaaa-bbbb-cccc-ddddeeee0010";
      const facCid = "eight-fac-aaaa-bbbb-cccc-ddddeeee0011";

      const store = new StateStore(root);
      for (const [cid, platform] of [
        [cursorCid, "cursor"],
        [claudeCid, "claude-code"],
        [codexCid, "codex"],
        [kimiCid, "kimi-code"],
        [copilotCid, "copilot-cli"],
        [grokCid, "grok-build"],
        [gemCid, "gemini-cli"],
        [facCid, FACTORY_PLATFORM],
      ] as const) {
        store.upsertSession({
          conversation_id: cid,
          project_root: root,
          code_root: root,
          platform,
          phase: "executing",
          armed: 1,
          paused: 0,
          track_id: "demo",
          checklist_path: cp,
        });
      }
      store.close();

      expect(
        runHook(
          root,
          "afterFileEdit",
          { conversation_id: cursorCid, file_path: editPath },
          "cursor",
        ).status,
      ).toBe(0);
      expect(
        runHook(
          root,
          "PostToolUse",
          {
            session_id: claudeCid,
            tool_name: "Write",
            tool_input: { file_path: editPath },
          },
          "claude-code",
        ).status,
      ).toBe(0);
      expect(
        runHook(
          root,
          "PostToolUse",
          {
            session_id: codexCid,
            tool_name: "Write",
            tool_input: { file_path: editPath },
          },
          "codex",
        ).status,
      ).toBe(0);
      expect(
        runHook(
          root,
          "PostToolUse",
          {
            session_id: kimiCid,
            tool_name: "Write",
            tool_input: { file_path: editPath },
          },
          "kimi-code",
        ).status,
      ).toBe(0);
      expect(
        runHook(
          root,
          "postToolUse",
          {
            sessionId: copilotCid,
            toolName: "edit",
            tool_input: { path: editPath },
          },
          "copilot-cli",
        ).status,
      ).toBe(0);
      expect(
        runHook(
          root,
          "PostToolUse",
          {
            session_id: grokCid,
            tool_name: "Write",
            tool_input: { file_path: editPath },
          },
          "grok-build",
        ).status,
      ).toBe(0);
      expect(
        runHook(
          root,
          "AfterTool",
          {
            sessionId: gemCid,
            toolName: "write_file",
            toolInput: { file_path: editPath },
          },
          "gemini-cli",
        ).status,
      ).toBe(0);
      // Factory Post arm must be zero-byte (never stringify "{}").
      const facArm = runHook(
        root,
        "PostToolUse",
        {
          session_id: facCid,
          tool_name: "Edit",
          tool_input: { file_path: editPath },
        },
        "factory-droid",
      );
      expect(facArm.status).toBe(0);
      expect(facArm.stderr.trim()).toBe("");
      expect(facArm.stdout.length).toBe(0);
      expect(facArm.stdout.trim()).not.toBe("{}");
      expect(facArm.out).toEqual({});
      expect(facArm.out.decision).toBeUndefined();
      {
        const mid = new StateStore(root);
        expect(mid.getSession(facCid)?.platform).toBe(FACTORY_PLATFORM);
        expect(mid.getReviewChain(facCid)?.code_edited).toBe(1);
        mid.close();
      }

      {
        const armed = new StateStore(root);
        for (const cid of [
          cursorCid,
          claudeCid,
          codexCid,
          kimiCid,
          copilotCid,
          grokCid,
          gemCid,
          facCid,
        ] as const) {
          expect(armed.getReviewChain(cid)?.code_edited).toBe(1);
        }
        armed.close();
      }

      // Wrong payload shapes / Factory argv — empty body (no tool_name → Factory
      // Post early-return); must not rewrite prior-host stamps or clear arms.
      const priorCidPlatform: ReadonlyArray<readonly [string, HostId]> = [
        [cursorCid, "cursor"],
        [claudeCid, "claude-code"],
        [codexCid, "codex"],
        [kimiCid, "kimi-code"],
        [copilotCid, "copilot-cli"],
        [grokCid, "grok-build"],
        [gemCid, "gemini-cli"],
      ];
      for (const [cid, platform] of priorCidPlatform) {
        const xf = runHook(
          root,
          "PostToolUse",
          { conversation_id: cid, file_path: editPath },
          "factory-droid",
        );
        expect(xf.status).toBe(0);
        expect(xf.stdout.length).toBe(0);
        expect(xf.stdout.trim()).not.toBe("{}");
        expect(xf.stderr.trim()).toBe("");
        expect(xf.out).toEqual({});
        const mid = new StateStore(root);
        expect(mid.getSession(cid)?.platform).toBe(platform);
        expect(mid.getReviewChain(cid)?.code_edited).toBe(1);
        mid.close();
      }

      // Factory stamp + Cursor argv on PostToolUse — Cursor port has no
      // PostToolUse handler → JSON "{}" observe path; Factory stamp/arm survive.
      const xfFacViaCursor = runHook(
        root,
        "PostToolUse",
        {
          session_id: facCid,
          tool_name: "Edit",
          tool_input: { file_path: editPath },
        },
        "cursor",
      );
      expect(xfFacViaCursor.status).toBe(0);
      expect(xfFacViaCursor.stderr.trim()).toBe("");
      expect(xfFacViaCursor.stdout.trim()).toBe("{}");
      expect(xfFacViaCursor.out).toEqual({});
      expect(xfFacViaCursor.out.decision).toBeUndefined();
      {
        const mid = new StateStore(root);
        expect(mid.getSession(facCid)?.platform).toBe(FACTORY_PLATFORM);
        expect(mid.getReviewChain(facCid)?.code_edited).toBe(1);
        mid.close();
      }

      // Gemini-unique AfterTool under Factory argv → early "{}" gate (before FSM).
      const xfAfterTool = runHook(
        root,
        "AfterTool",
        {
          sessionId: facCid,
          toolName: "write_file",
          toolInput: { file_path: editPath },
        },
        "factory-droid",
      );
      expect(xfAfterTool.status).toBe(0);
      expect(xfAfterTool.stdout.trim()).toBe("{}");
      expect(xfAfterTool.stderr.trim()).toBe("");
      expect(xfAfterTool.out).toEqual({});
      expect(xfAfterTool.out.decision).toBeUndefined();
      {
        const mid = new StateStore(root);
        expect(mid.getSession(facCid)?.platform).toBe(FACTORY_PLATFORM);
        expect(mid.getSession(facCid)?.phase).toBe("executing");
        expect(mid.getReviewChain(facCid)?.code_edited).toBe(1);
        mid.close();
      }

      const verify = new StateStore(root);
      expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
      expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
      expect(verify.getSession(codexCid)?.platform).toBe("codex");
      expect(verify.getSession(kimiCid)?.platform).toBe("kimi-code");
      expect(verify.getSession(copilotCid)?.platform).toBe("copilot-cli");
      expect(verify.getSession(grokCid)?.platform).toBe("grok-build");
      expect(verify.getSession(gemCid)?.platform).toBe("gemini-cli");
      expect(verify.getSession(facCid)?.platform).toBe(FACTORY_PLATFORM);
      expect(verify.getReviewChain(cursorCid)?.code_edited).toBe(1);
      expect(verify.getReviewChain(claudeCid)?.code_edited).toBe(1);
      expect(verify.getReviewChain(codexCid)?.code_edited).toBe(1);
      expect(verify.getReviewChain(kimiCid)?.code_edited).toBe(1);
      expect(verify.getReviewChain(copilotCid)?.code_edited).toBe(1);
      expect(verify.getReviewChain(grokCid)?.code_edited).toBe(1);
      expect(verify.getReviewChain(gemCid)?.code_edited).toBe(1);
      expect(verify.getReviewChain(facCid)?.code_edited).toBe(1);
      verify.close();
    },
    30_000,
  );

  it("prior seven hosts non-regress when Factory hooks exist (submit / UPS shapes)", () => {
    root = tmpProject();
    withKimiHome();
    installEightHost(root);
    const cursorCid = "eight-sub-aaaa-bbbb-cccc-ddddeeee0010";
    const claudeCid = "eight-sub-aaaa-bbbb-cccc-ddddeeee0011";
    const codexCid = "eight-sub-aaaa-bbbb-cccc-ddddeeee0012";
    const kimiCid = "eight-sub-aaaa-bbbb-cccc-ddddeeee0013";
    const copilotCid = "eight-sub-aaaa-bbbb-cccc-ddddeeee0014";
    const grokCid = "eight-sub-aaaa-bbbb-cccc-ddddeeee0015";
    const gemCid = "eight-sub-aaaa-bbbb-cccc-ddddeeee0016";
    const facCid = "eight-sub-aaaa-bbbb-cccc-ddddeeee0017";

    const seed = new StateStore(root);
    for (const [cid, platform] of [
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
      [codexCid, "codex"],
      [kimiCid, "kimi-code"],
      [copilotCid, "copilot-cli"],
      [grokCid, "grok-build"],
      [gemCid, "gemini-cli"],
      [facCid, FACTORY_PLATFORM],
    ] as const) {
      seed.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform,
        phase: "idle",
        armed: 0,
        paused: 0,
        track_id: "_pending",
      });
    }
    seed.close();

    const cursor = runHook(
      root,
      "beforeSubmitPrompt",
      { conversation_id: cursorCid, prompt: "hello cursor" },
      "cursor",
    );
    expect(cursor.status).toBe(0);
    expect(cursor.out.continue).toBe(true);
    expect(cursor.out.decision).toBeUndefined();

    const claude = runHook(
      root,
      "UserPromptSubmit",
      { session_id: claudeCid, prompt: "hello claude" },
      "claude-code",
    );
    expect(claude.status).toBe(0);
    expect(claude.out.continue).toBeUndefined();
    expect(claude.out.decision).toBeUndefined();

    const codex = runHook(
      root,
      "UserPromptSubmit",
      { session_id: codexCid, prompt: "hello codex" },
      "codex",
    );
    expect(codex.status).toBe(0);
    expect(codex.out.decision).toBeUndefined();

    const kimi = runHook(
      root,
      "UserPromptSubmit",
      { session_id: kimiCid, prompt: "hello kimi" },
      "kimi-code",
    );
    expect(kimi.status).toBe(0);
    expect(kimi.stdout.trim()).toBe("");
    expect(kimi.stderr.trim()).toBe("");
    expect(kimi.out).toEqual({});

    const copilotUps = runHook(
      root,
      "userPromptSubmitted",
      { sessionId: copilotCid, prompt: "hello copilot" },
      "copilot-cli",
    );
    expect(copilotUps.status).toBe(0);
    expect(copilotUps.stdout.trim()).toBe("{}");
    expect(copilotUps.out).toEqual({});

    const grok = runHook(
      root,
      "UserPromptSubmit",
      { session_id: grokCid, prompt: "hello grok" },
      "grok-build",
    );
    expect(grok.status).toBe(0);
    expect(grok.stdout.trim()).toBe("{}");
    expect(grok.stderr.trim()).toBe("");
    expect(grok.out).toEqual({});
    expect(grok.out.decision).toBeUndefined();
    expect(grok.out.additionalContext).toBeUndefined();

    const gem = runHook(
      root,
      "BeforeAgent",
      { sessionId: gemCid, prompt: "hello gemini" },
      "gemini-cli",
    );
    expect(gem.status).toBe(0);
    expect(gem.stdout.trim()).toBe("{}");
    expect(gem.out).toEqual({});
    expect(gem.out.decision).toBeUndefined();
    expect(gem.out.hookSpecificOutput).toBeUndefined();

    // Factory ON allow → zero-byte stdout (never "{}").
    const fac = runHook(
      root,
      "UserPromptSubmit",
      { session_id: facCid, prompt: "hello factory", cwd: root },
      "factory-droid",
    );
    expect(fac.status).toBe(0);
    expect(fac.stdout.length).toBe(0);
    expect(fac.stdout.trim()).not.toBe("{}");
    expect(fac.stderr.trim()).toBe("");
    expect(fac.out).toEqual({});
    expect(fac.out.decision).toBeUndefined();
    expect(fac.out.hookSpecificOutput).toBeUndefined();
    expect(fac.out.continue).toBeUndefined();

    const verify = new StateStore(root);
    expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
    expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
    expect(verify.getSession(codexCid)?.platform).toBe("codex");
    expect(verify.getSession(kimiCid)?.platform).toBe("kimi-code");
    expect(verify.getSession(copilotCid)?.platform).toBe("copilot-cli");
    expect(verify.getSession(grokCid)?.platform).toBe("grok-build");
    expect(verify.getSession(gemCid)?.platform).toBe("gemini-cli");
    expect(verify.getSession(facCid)?.platform).toBe(FACTORY_PLATFORM);
    // Ordinary-chat UPS must not claim executing / steal a cross-cid lease.
    // (findExecutingSession(exclude) alone cannot catch "self wrongly executing".)
    for (const cid of [
      cursorCid,
      claudeCid,
      codexCid,
      kimiCid,
      copilotCid,
      grokCid,
      gemCid,
      facCid,
    ] as const) {
      expect(verify.getSession(cid)?.phase).toBe("idle");
      expect(verify.getSession(cid)?.armed ?? 0).toBe(0);
      expect(verify.findExecutingSession(cid)).toBeNull();
    }
    verify.close();
  });
});
