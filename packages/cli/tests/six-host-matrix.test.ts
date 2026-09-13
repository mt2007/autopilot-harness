/**
 * Six-host matrix: Grok ↔ Cursor/Claude/Codex/Kimi/Copilot cross-fire.
 * Wrong stamp / wrong payload → abort (Cursor-shaped abort → Cursor halt "{}";
 * Kimi argv still bare exit 0); lookalike Pascal Stop + --platform grok-build
 * follows Grok stamp (decision:block+reason); prior five hosts must not go red
 * when Grok is also enabled.
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
  GROK_AUTOPILOT_EVENTS,
  GROK_HOOK_TIMEOUT_SEC,
  GROK_HOOKS_REL_PATH,
  GROK_POST_TOOL_USE_MATCHER,
} from "../src/init/grok-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { GROK_STOP_PER_TURN_BLOCK_CAP } from "../../ports/grok-build/src/index.js";
import { COPILOT_STOP_CONSECUTIVE_BLOCK_CAP } from "../../ports/copilot-cli/src/index.js";

type HostId =
  | "cursor"
  | "claude-code"
  | "codex"
  | "kimi-code"
  | "copilot-cli"
  | "grok-build";

const ALL_HOSTS: readonly HostId[] = [
  "cursor",
  "claude-code",
  "codex",
  "kimi-code",
  "copilot-cli",
  "grok-build",
] as const;

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-six-host-"));
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

function seedChecklist(root: string, slug = "demo"): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(cp, "- [ ] a — A\n- [ ] b — B\n");
  return cp;
}

/** Cursor + Claude + Codex + Kimi + Copilot + Grok installable hosts in one project. */
function installSixHost(root: string): void {
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

describe("six-host Grok cross-fire matrix", () => {
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
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-six-kimi-"));
    process.env.KIMI_CODE_HOME = kimiHome;
  }

  it("six install stamps all hosts; doctor stays ok for prior hosts + Grok", () => {
    root = tmpProject();
    withKimiHome();
    installSixHost(root);

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

    const claude = JSON.parse(
      fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, { hooks?: { command?: string }[] }[]>;
    };
    const claudeStop = (claude.hooks.Stop ?? [])
      .flatMap((g) => g.hooks ?? [])
      .map((h) => h.command ?? "")
      .filter((c) => c.includes("autopilot-harness"));
    expect(claudeStop.length).toBeGreaterThanOrEqual(1);
    expect(
      claudeStop.every((c) => /--platform claude-code(?:\s|$)/.test(c)),
    ).toBe(true);

    expect(
      fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"),
    ).toMatch(/--platform codex(?:\s|$)/);

    const kimiToml = fs.readFileSync(path.join(kimiHome, "config.toml"), "utf8");
    expect(kimiToml).toMatch(/--platform kimi-code/);
    expect(fs.existsSync(path.join(root, ".kimi-code"))).toBe(false);

    const copilotFile = JSON.parse(
      fs.readFileSync(
        path.join(root, ".github", "hooks", "autopilot-harness.json"),
        "utf8",
      ),
    ) as {
      hooks?: Record<
        string,
        Array<{ bash?: string; timeoutSec?: number; matcher?: string }>
      >;
    };
    for (const event of COPILOT_AUTOPILOT_EVENTS) {
      const h = copilotFile.hooks?.[event]?.[0];
      expect(h?.bash).toMatch(/--platform copilot-cli/);
      expect(h?.timeoutSec).toBe(COPILOT_HOOK_TIMEOUT_SEC);
    }

    expect(GROK_HOOKS_REL_PATH).toBe(".grok/hooks/autopilot-harness.json");
    const grokPath = path.join(
      root,
      ".grok",
      "hooks",
      "autopilot-harness.json",
    );
    const grokFile = JSON.parse(fs.readFileSync(grokPath, "utf8")) as {
      hooks?: Record<
        string,
        Array<{
          matcher?: string;
          hooks?: Array<{ command?: string; timeout?: number; type?: string }>;
        }>
      >;
    };
    for (const event of GROK_AUTOPILOT_EVENTS) {
      const groups = grokFile.hooks?.[event];
      expect(Array.isArray(groups)).toBe(true);
      expect(groups!.length).toBe(1);
      const g = groups![0]!;
      if (event === "PostToolUse") {
        expect(g.matcher).toBe(GROK_POST_TOOL_USE_MATCHER);
      } else {
        expect(g.matcher).toBeUndefined();
      }
      const h = g.hooks?.[0];
      expect(h?.type).toBe("command");
      expect(h?.timeout).toBe(GROK_HOOK_TIMEOUT_SEC);
      expect(h?.command).toMatch(/--platform grok-build/);
      expect(h?.command).toMatch(new RegExp(`--event ${event}(?:\\s|$)`));
    }
    expect(fs.existsSync(path.join(root, ".grok", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.github\/hooks\/\*\*/);
    expect(ignore).toMatch(/\.grok\/hooks\/\*\*/);

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
    expect(joined).toMatch(/Stop-continue.*≤1|≤1\/turn/i);
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
    expect(joined).toMatch(/Reload Grok Build|new session/i);
    expect(joined).toMatch(/Grok Build \+ Cursor both enabled/i);
    expect(joined).toMatch(/Grok Build \+ Claude Code both enabled/i);
  });

  it("lookalike Pascal Stop + --platform grok-build follows Grok stamp (decision:block+reason)", () => {
    root = tmpProject();
    withKimiHome();
    installSixHost(root);
    const cp = seedChecklist(root);
    const cid = "six-grok-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "grok-build",
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
        session_id: cid,
        hook_event_name: "Stop",
        stop_hook_active: false,
      },
      "grok-build",
    );
    expect(r.status).toBe(0);
    expect(r.stderr.trim()).toBe("");
    expect(r.out.__parse_error).toBeUndefined();
    expect(r.out.decision).toBe("block");
    expect(typeof r.out.reason).toBe("string");
    expect(String(r.out.reason).length).toBeGreaterThan(0);
    expect(r.out.continue).toBeUndefined();
    expect(r.out.followup_message).toBeUndefined();
    expect(r.out.hookSpecificOutput).toBeUndefined();
    expect(r.out.additionalContext).toBeUndefined();
    expect(Object.keys(r.out).sort()).toEqual(["decision", "reason"]);

    const verify = new StateStore(root);
    expect(verify.getSession(cid)?.platform).toBe("grok-build");
    expect(verify.getSession(cid)?.armed).toBe(1);
    verify.close();
  });

  it("Grok stamp + Cursor-shaped aborted payload → halt (wrong payload abort before FSM)", () => {
    root = tmpProject();
    withKimiHome();
    installSixHost(root);
    const cp = seedChecklist(root);
    const cid = "six-abort-aaaa-bbbb-cccc-ddddeeee0002";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "grok-build",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain(cid, {
      code_edited: 1,
      pending_followup: "恢复：上一回合出错。继续当前任务。",
    });
    store.close();

    // Own argv first: Cursor-shaped abort still routes to Cursor halt (not Grok
    // confirm continue), then every other host argv must keep the Grok stamp.
    const abortPlatforms: readonly HostId[] = [
      "grok-build",
      "cursor",
      "claude-code",
      "codex",
      "kimi-code",
      "copilot-cli",
    ];
    for (const platform of abortPlatforms) {
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
      expect(r.status).toBe(0);
      if (platform === "kimi-code") {
        expect(r.stdout.trim()).toBe("");
        expect(r.stderr.trim()).toBe("");
        expect(r.out).toEqual({});
      } else {
        expect(r.stdout.trim()).toBe("{}");
        expect(r.stderr.trim()).toBe("");
        expect(r.out).toEqual({});
        expect(r.out.decision).toBeUndefined();
        expect(r.out.continue).toBeUndefined();
        expect(r.out.reason).toBeUndefined();
      }
      const mid = new StateStore(root);
      expect(mid.getSession(cid)?.platform).toBe("grok-build");
      expect(mid.getSession(cid)?.error_count).toBe(0);
      // Halt must clear recover tip / dirty and later argv must not re-arm.
      expect(mid.getReviewChain(cid)?.pending_followup ?? null).toBeNull();
      expect(mid.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
      mid.close();
    }

    const verify = new StateStore(root);
    expect(verify.getSession(cid)).toEqual(
      expect.objectContaining({
        platform: "grok-build",
        error_count: 0,
        armed: 1,
      }),
    );
    expect(verify.getReviewChain(cid)).toEqual(
      expect.objectContaining({
        pending_followup: null,
        code_edited: 0,
      }),
    );
    verify.close();

    // Non-Cursor-shaped abort (session_id, no conversation_id) under grok argv
    // must still halt {} without decision:block continue.
    const nativeCid = "six-abort-native-aaaa-bbbb-cccc-ddddeeee0002";
    const nativeStore = new StateStore(root);
    nativeStore.upsertSession({
      conversation_id: nativeCid,
      project_root: root,
      code_root: root,
      platform: "grok-build",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    nativeStore.updateReviewChain(nativeCid, { code_edited: 1 });
    nativeStore.close();

    const nativeAbort = runHook(
      root,
      "Stop",
      {
        session_id: nativeCid,
        status: "aborted",
        hook_event_name: "Stop",
        stop_hook_active: false,
      },
      "grok-build",
    );
    expect(nativeAbort.status).toBe(0);
    expect(nativeAbort.stdout.trim()).toBe("{}");
    expect(nativeAbort.stderr.trim()).toBe("");
    expect(nativeAbort.out).toEqual({});
    expect(Object.keys(nativeAbort.out).sort()).toEqual([]);

    const nativeVerify = new StateStore(root);
    expect(nativeVerify.getSession(nativeCid)?.platform).toBe("grok-build");
    expect(nativeVerify.getSession(nativeCid)?.error_count).toBe(0);
    expect(nativeVerify.getSession(nativeCid)?.armed).toBe(1);
    expect(nativeVerify.getReviewChain(nativeCid)?.code_edited ?? 0).toBe(0);
    nativeVerify.close();
  });

  it("wrong --platform on foreign stamp Stop does not wipe prior hosts or Grok", () => {
    root = tmpProject();
    withKimiHome();
    installSixHost(root);
    const cp = seedChecklist(root);
    const grokKimiXf = "six-xf-grk-kimi-aaaa-bbbb-cccc-ddddeeee0053";
    const grokClaudeXf = "six-xf-grk-cla-aaaa-bbbb-cccc-ddddeeee0054";
    const grokAbortCid = "six-xf-grk-abt-aaaa-bbbb-cccc-ddddeeee0055";
    const kimiAbortCid = "six-xf-kim-abt-aaaa-bbbb-cccc-ddddeeee0056";
    const prior: Array<{ cid: string; platform: HostId }> = [
      { cid: "six-xf-aaaa-bbbb-cccc-ddddeeee0013", platform: "cursor" },
      { cid: "six-xf-aaaa-bbbb-cccc-ddddeeee0023", platform: "claude-code" },
      { cid: "six-xf-aaaa-bbbb-cccc-ddddeeee0033", platform: "codex" },
      { cid: "six-xf-aaaa-bbbb-cccc-ddddeeee0043", platform: "kimi-code" },
      { cid: "six-xf-aaaa-bbbb-cccc-ddddeeee0053", platform: "copilot-cli" },
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
    for (const cid of [grokKimiXf, grokClaudeXf, grokAbortCid] as const) {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "grok-build",
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: cp,
      });
      store.updateReviewChain(cid, { code_edited: 1 });
    }
    store.upsertSession({
      conversation_id: kimiAbortCid,
      project_root: root,
      code_root: root,
      platform: "kimi-code",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain(kimiAbortCid, { code_edited: 1 });
    store.close();

    const assertStamp = (cid: string, platform: HostId) => {
      const v = new StateStore(root);
      expect(v.getSession(cid)?.platform).toBe(platform);
      expect(v.getSession(cid)?.armed).toBe(1);
      v.close();
    };

    // Grok stamp + kimi argv + Pascal lookalike — Kimi channel (exit 2), stamp stays.
    const xfGrokViaKimi = runHook(
      root,
      "Stop",
      {
        session_id: grokKimiXf,
        hook_event_name: "Stop",
        stop_hook_active: false,
      },
      "kimi-code",
    );
    expect(xfGrokViaKimi.status).toBe(2);
    expect(xfGrokViaKimi.stdout.trim()).toBe("");
    expect(xfGrokViaKimi.stderr.trim().length).toBeGreaterThan(0);
    expect(xfGrokViaKimi.stderr).not.toMatch(/"decision"\s*:\s*"block"/);
    expect(xfGrokViaKimi.out).toEqual({});
    assertStamp(grokKimiXf, "grok-build");

    // Argv lies claude-code on Grok stamp; DB stamp must not be rewritten.
    const xfGrok = runHook(
      root,
      "Stop",
      {
        session_id: grokClaudeXf,
        hook_event_name: "Stop",
        stop_hook_active: false,
      },
      "claude-code",
    );
    expect(xfGrok.status).toBe(0);
    expect(xfGrok.stderr.trim()).toBe("");
    expect(xfGrok.out.__parse_error).toBeUndefined();
    expect(xfGrok.out.decision).toBe("block");
    expect(typeof xfGrok.out.reason).toBe("string");
    expect(xfGrok.out.continue).toBeUndefined();
    expect(xfGrok.out.followup_message).toBeUndefined();
    expect(xfGrok.out.hookSpecificOutput).toBeUndefined();
    assertStamp(grokClaudeXf, "grok-build");

    // Grok stamp + Cursor abort under grok argv → JSON halt {}.
    const abortGrok = runHook(
      root,
      "Stop",
      {
        conversation_id: grokAbortCid,
        status: "aborted",
        hook_event_name: "stop",
        loop_count: 0,
      },
      "grok-build",
    );
    expect(abortGrok.status).toBe(0);
    expect(abortGrok.stdout.trim()).toBe("{}");
    expect(abortGrok.stderr.trim()).toBe("");
    expect(abortGrok.out).toEqual({});
    assertStamp(grokAbortCid, "grok-build");
    {
      const v = new StateStore(root);
      expect(v.getReviewChain(grokAbortCid)?.code_edited ?? 0).toBe(0);
      expect(v.getReviewChain(grokAbortCid)?.pending_followup ?? null).toBeNull();
      v.close();
    }

    // Hostile agentStop name under grok argv must not fall through to Copilot Layer C.
    const grokAgentCid = "six-xf-grk-agent-aaaa-bbbb-cccc-ddddeeee0057";
    {
      const s = new StateStore(root);
      s.upsertSession({
        conversation_id: grokAgentCid,
        project_root: root,
        code_root: root,
        platform: "grok-build",
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: cp,
      });
      s.updateReviewChain(grokAgentCid, { code_edited: 1 });
      s.close();
    }
    const xfAgent = runHook(
      root,
      "Stop",
      {
        sessionId: grokAgentCid,
        hookEventName: "agentStop",
        stopHookActive: false,
      },
      "grok-build",
    );
    expect(xfAgent.status).toBe(0);
    expect(xfAgent.stderr.trim()).toBe("");
    expect(xfAgent.out.__parse_error).toBeUndefined();
    expect(xfAgent.out.decision).toBe("block");
    expect(typeof xfAgent.out.reason).toBe("string");
    expect(xfAgent.out.continue).toBeUndefined();
    expect(xfAgent.out.hookSpecificOutput).toBeUndefined();
    expect(xfAgent.out.additionalContext).toBeUndefined();
    expect(xfAgent.out.modifiedTransformedPrompt).toBeUndefined();
    expect(Object.keys(xfAgent.out).sort()).toEqual(["decision", "reason"]);
    assertStamp(grokAgentCid, "grok-build");

    // Prior host stamps + grok-build argv + Pascal Stop lookalike → Grok channel.
    for (const { cid, platform } of prior) {
      const xf = runHook(
        root,
        "Stop",
        {
          session_id: cid,
          hook_event_name: "Stop",
          stop_hook_active: false,
        },
        "grok-build",
      );
      expect(xf.status).toBe(0);
      expect(xf.stderr.trim()).toBe("");
      expect(xf.out.__parse_error).toBeUndefined();
      expect(xf.out.decision).toBe("block");
      expect(typeof xf.out.reason).toBe("string");
      expect(xf.out.continue).toBeUndefined();
      expect(xf.out.additionalContext).toBeUndefined();
      expect(Object.keys(xf.out).sort()).toEqual(["decision", "reason"]);
      assertStamp(cid, platform);
    }

    const abortKimi = runHook(
      root,
      "Stop",
      {
        conversation_id: kimiAbortCid,
        status: "aborted",
        hook_event_name: "stop",
        loop_count: 0,
      },
      "kimi-code",
    );
    expect(abortKimi.status).toBe(0);
    expect(abortKimi.stdout.trim()).toBe("");
    expect(abortKimi.stderr.trim()).toBe("");
    expect(abortKimi.out).toEqual({});
    assertStamp(kimiAbortCid, "kimi-code");

    for (const { cid, platform } of prior) {
      assertStamp(cid, platform);
    }
    for (const cid of [
      grokKimiXf,
      grokClaudeXf,
      grokAbortCid,
      grokAgentCid,
    ] as const) {
      assertStamp(cid, "grok-build");
    }
  });

  it("prior hosts survive Grok PostToolUse cross-fire (wrong payload / argv)", () => {
    root = tmpProject();
    withKimiHome();
    installSixHost(root);
    const cp = seedChecklist(root);
    const editPath = path.join(root, "src", "xf.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export {}\n");

    const cursorCid = "six-cur-aaaa-bbbb-cccc-ddddeeee0004";
    const claudeCid = "six-cla-aaaa-bbbb-cccc-ddddeeee0005";
    const codexCid = "six-cdx-aaaa-bbbb-cccc-ddddeeee0006";
    const kimiCid = "six-kim-aaaa-bbbb-cccc-ddddeeee0007";
    const copilotCid = "six-cop-aaaa-bbbb-cccc-ddddeeee0008";
    const grokCid = "six-grk-aaaa-bbbb-cccc-ddddeeee0009";

    const store = new StateStore(root);
    for (const [cid, platform] of [
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
      [codexCid, "codex"],
      [kimiCid, "kimi-code"],
      [copilotCid, "copilot-cli"],
      [grokCid, "grok-build"],
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

    // Wrong payload shapes / host argv — fail-open, no stamp wipe.
    const xfCursor = runHook(
      root,
      "PostToolUse",
      { conversation_id: cursorCid, file_path: editPath },
      "grok-build",
    );
    expect(xfCursor.status).toBe(0);
    expect(xfCursor.stdout.trim()).toBe("{}");
    expect(xfCursor.stderr.trim()).toBe("");
    expect(xfCursor.out).toEqual({});

    for (const cid of [claudeCid, codexCid, kimiCid, copilotCid] as const) {
      const xf = runHook(
        root,
        "PostToolUse",
        { conversation_id: cid, file_path: editPath },
        "grok-build",
      );
      expect(xf.status).toBe(0);
      expect(xf.stdout.trim()).toBe("{}");
      expect(xf.stderr.trim()).toBe("");
      expect(xf.out).toEqual({});
    }

    const xfGrokViaCursor = runHook(
      root,
      "PostToolUse",
      {
        session_id: grokCid,
        tool_name: "Write",
        tool_input: { file_path: editPath },
      },
      "cursor",
    );
    expect(xfGrokViaCursor.status).toBe(0);
    // Cursor argv has no PostToolUse handler → JSON "{}" fail-open.
    expect(xfGrokViaCursor.stdout.trim()).toBe("{}");
    expect(xfGrokViaCursor.stderr.trim()).toBe("");
    expect(xfGrokViaCursor.out).toEqual({});

    const verify = new StateStore(root);
    expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
    expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
    expect(verify.getSession(codexCid)?.platform).toBe("codex");
    expect(verify.getSession(kimiCid)?.platform).toBe("kimi-code");
    expect(verify.getSession(copilotCid)?.platform).toBe("copilot-cli");
    expect(verify.getSession(grokCid)?.platform).toBe("grok-build");
    expect(verify.getReviewChain(cursorCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(claudeCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(codexCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(kimiCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(copilotCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(grokCid)?.code_edited).toBe(1);
    verify.close();
  });

  it("prior five hosts non-regress when Grok hooks exist (submit shapes)", () => {
    root = tmpProject();
    withKimiHome();
    installSixHost(root);
    const cursorCid = "six-sub-aaaa-bbbb-cccc-ddddeeee0010";
    const claudeCid = "six-sub-aaaa-bbbb-cccc-ddddeeee0011";
    const codexCid = "six-sub-aaaa-bbbb-cccc-ddddeeee0012";
    const kimiCid = "six-sub-aaaa-bbbb-cccc-ddddeeee0013";
    const copilotCid = "six-sub-aaaa-bbbb-cccc-ddddeeee0014";
    const grokCid = "six-sub-aaaa-bbbb-cccc-ddddeeee0015";

    const seed = new StateStore(root);
    for (const [cid, platform] of [
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
      [codexCid, "codex"],
      [kimiCid, "kimi-code"],
      [copilotCid, "copilot-cli"],
      [grokCid, "grok-build"],
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

    const verify = new StateStore(root);
    expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
    expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
    expect(verify.getSession(codexCid)?.platform).toBe("codex");
    expect(verify.getSession(kimiCid)?.platform).toBe("kimi-code");
    expect(verify.getSession(copilotCid)?.platform).toBe("copilot-cli");
    expect(verify.getSession(grokCid)?.platform).toBe("grok-build");
    verify.close();
  });
});
