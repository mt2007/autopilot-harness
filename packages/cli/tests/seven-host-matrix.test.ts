/**
 * Seven-host matrix: Gemini ↔ Cursor/Claude/Codex/Kimi/Copilot/Grok cross-fire.
 * Wrong stamp / wrong payload → abort (Cursor-shaped abort on AfterAgent →
 * JSON halt "{}"; Gemini-unique events + wrong --platform also JSON "{}" before
 * FSM — not Kimi bare exit). Lookalike AfterAgent + --platform gemini-cli
 * follows Gemini stamp (decision:deny+reason); prior six hosts must not go red
 * when Gemini is also enabled.
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
import { AUTOPILOT_EVENTS } from "../src/init/types.js";
import { runDoctor } from "../src/status-doctor.js";
import { GEMINI_AFTER_AGENT_TURN_CAP } from "../../ports/gemini-cli/src/index.js";
import { GROK_STOP_PER_TURN_BLOCK_CAP } from "../../ports/grok-build/src/index.js";
import { COPILOT_STOP_CONSECUTIVE_BLOCK_CAP } from "../../ports/copilot-cli/src/index.js";

type HostId =
  | "cursor"
  | "claude-code"
  | "codex"
  | "kimi-code"
  | "copilot-cli"
  | "grok-build"
  | "gemini-cli";

const ALL_HOSTS: readonly HostId[] = [
  "cursor",
  "claude-code",
  "codex",
  "kimi-code",
  "copilot-cli",
  "grok-build",
  "gemini-cli",
] as const;

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-seven-host-"));
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

/** Cursor + Claude + Codex + Kimi + Copilot + Grok + Gemini installable hosts. */
function installSevenHost(root: string): void {
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

describe("seven-host Gemini cross-fire matrix", () => {
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
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-seven-kimi-"));
    process.env.KIMI_CODE_HOME = kimiHome;
  }

  it("seven install stamps all hosts; doctor stays ok for prior hosts + Gemini", () => {
    root = tmpProject();
    withKimiHome();
    installSevenHost(root);

    const cursorHooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as { hooks: Record<string, { command: string }[]> };
    for (const event of AUTOPILOT_EVENTS) {
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
    expect(
      fs.existsSync(
        path.join(root, ".gemini", "skills", "autopilot-on", "SKILL.md"),
      ),
    ).toBe(true);

    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.grok\/hooks\/\*\*/);
    expect(ignore).toMatch(/\.gemini\/settings\.json/);
    expect(ignore).toMatch(/\.gemini\/skills\/\*\*/);

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
    expect(joined).toMatch(/Gemini CLI \+ Claude Code both enabled/i);
    expect(joined).toMatch(/folder trust/i);
  });

  it("lookalike AfterAgent + --platform gemini-cli follows Gemini stamp (decision:deny+reason)", () => {
    root = tmpProject();
    withKimiHome();
    installSevenHost(root);
    const cp = seedChecklist(root);
    const cid = "seven-gem-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "gemini-cli",
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
      "AfterAgent",
      {
        sessionId: cid,
        hook_event_name: "AfterAgent",
        prompt: "original user",
        prompt_response: "assistant done",
        stop_hook_active: false,
      },
      "gemini-cli",
    );
    expect(r.status).toBe(0);
    expect(r.stderr.trim()).toBe("");
    expect(r.out.__parse_error).toBeUndefined();
    expect(r.out.decision).toBe("deny");
    expect(typeof r.out.reason).toBe("string");
    expect(String(r.out.reason).length).toBeGreaterThan(0);
    expect(r.out.continue).toBeUndefined();
    expect(r.out.clearContext).toBeUndefined();
    expect(JSON.stringify(r.out)).not.toMatch(/clearContext|"block"/);
    expect(Object.keys(r.out).sort()).toEqual(["decision", "reason"]);

    const verify = new StateStore(root);
    expect(verify.getSession(cid)?.platform).toBe("gemini-cli");
    expect(verify.getSession(cid)?.armed).toBe(1);
    verify.close();
  });

  it(
    "Gemini stamp + Cursor-shaped aborted payload → halt (wrong payload abort before FSM)",
    () => {
    root = tmpProject();
    withKimiHome();
    installSevenHost(root);
    const cp = seedChecklist(root);
    const cid = "seven-abort-aaaa-bbbb-cccc-ddddeeee0002";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "gemini-cli",
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
      "gemini-cli",
      "cursor",
      "claude-code",
      "codex",
      "kimi-code",
      "copilot-cli",
      "grok-build",
    ];
    for (const platform of abortPlatforms) {
      const tipBefore = (() => {
        const s = new StateStore(root);
        const tip = s.getReviewChain(cid)?.pending_followup ?? null;
        s.close();
        return tip;
      })();
      const r = runHook(
        root,
        // Gemini abort is observed on AfterAgent; Cursor-shaped aborted still
        // hits the universal abort path before host FSM (own argv), or the
        // Gemini-unique-event wrong-platform gate (foreign argv → JSON "{}").
        "AfterAgent",
        {
          conversation_id: cid,
          status: "aborted",
          hook_event_name: "stop",
          loop_count: 0,
        },
        platform,
      );
      expect(r.status).toBe(0);
      // Wrong-platform Gemini events always emit JSON "{}" (not Kimi bare exit).
      expect(r.stdout.trim()).toBe("{}");
      expect(r.stderr.trim()).toBe("");
      expect(r.out).toEqual({});
      expect(r.out.decision).toBeUndefined();
      expect(r.out.continue).toBeUndefined();
      expect(r.out.reason).toBeUndefined();
      const mid = new StateStore(root);
      expect(mid.getSession(cid)?.platform).toBe("gemini-cli");
      expect(mid.getSession(cid)?.error_count).toBe(0);
      expect(mid.getSession(cid)?.armed).toBe(1);
      // Foreign argv never opens state.db; own-argv Cursor halt preserves tip
      // for Gemini AfterAgent abort (hook-vendor contract).
      expect(mid.getReviewChain(cid)?.pending_followup ?? null).toBe(tipBefore);
      mid.close();
    }

    const verify = new StateStore(root);
    expect(verify.getSession(cid)).toEqual(
      expect.objectContaining({
        platform: "gemini-cli",
        error_count: 0,
        armed: 1,
      }),
    );
    expect(verify.getReviewChain(cid)?.pending_followup).toBe(
      "Review fix round park",
    );
    verify.close();
  },
  30_000,
  );

  it("wrong --platform on foreign stamp AfterAgent/Stop does not wipe prior hosts or Gemini", () => {
    root = tmpProject();
    withKimiHome();
    installSevenHost(root);
    const cp = seedChecklist(root);
    const gemKimiXf = "seven-xf-gem-kimi-aaaa-bbbb-cccc-ddddeeee0053";
    const gemClaudeXf = "seven-xf-gem-cla-aaaa-bbbb-cccc-ddddeeee0054";
    const gemAbortCid = "seven-xf-gem-abt-aaaa-bbbb-cccc-ddddeeee0055";
    const prior: Array<{ cid: string; platform: HostId }> = [
      { cid: "seven-xf-aaaa-bbbb-cccc-ddddeeee0013", platform: "cursor" },
      { cid: "seven-xf-aaaa-bbbb-cccc-ddddeeee0023", platform: "claude-code" },
      { cid: "seven-xf-aaaa-bbbb-cccc-ddddeeee0033", platform: "codex" },
      { cid: "seven-xf-aaaa-bbbb-cccc-ddddeeee0043", platform: "kimi-code" },
      { cid: "seven-xf-aaaa-bbbb-cccc-ddddeeee0053", platform: "copilot-cli" },
      { cid: "seven-xf-aaaa-bbbb-cccc-ddddeeee0063", platform: "grok-build" },
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
    for (const cid of [gemKimiXf, gemClaudeXf, gemAbortCid] as const) {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "gemini-cli",
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: cp,
      });
      store.updateReviewChain(cid, { code_edited: 1 });
    }
    store.close();

    const assertStamp = (cid: string, platform: HostId) => {
      const v = new StateStore(root);
      expect(v.getSession(cid)?.platform).toBe(platform);
      expect(v.getSession(cid)?.armed).toBe(1);
      v.close();
    };

    // Gemini stamp + kimi argv + AfterAgent — Gemini-unique event + wrong
    // --platform aborts before vendor FSM (JSON "{}"; stamp untouched).
    const xfGemViaKimi = runHook(
      root,
      "AfterAgent",
      {
        sessionId: gemKimiXf,
        hook_event_name: "AfterAgent",
        stop_hook_active: false,
      },
      "kimi-code",
    );
    expect(xfGemViaKimi.status).toBe(0);
    expect(xfGemViaKimi.stdout.trim()).toBe("{}");
    expect(xfGemViaKimi.stderr.trim()).toBe("");
    expect(xfGemViaKimi.out).toEqual({});
    assertStamp(gemKimiXf, "gemini-cli");

    // Argv lies claude-code on Gemini stamp; unique-event gate aborts before
    // Claude/Gemini FSM — must not rewrite stamp or emit deny/block.
    const xfGem = runHook(
      root,
      "AfterAgent",
      {
        sessionId: gemClaudeXf,
        hook_event_name: "AfterAgent",
        prompt: "original user",
        prompt_response: "assistant done",
        stop_hook_active: false,
      },
      "claude-code",
    );
    expect(xfGem.status).toBe(0);
    expect(xfGem.stdout.trim()).toBe("{}");
    expect(xfGem.stderr.trim()).toBe("");
    expect(xfGem.out).toEqual({});
    expect(xfGem.out.decision).toBeUndefined();
    assertStamp(gemClaudeXf, "gemini-cli");

    // Gemini stamp + Cursor abort under gemini argv → JSON halt {}.
    const abortGem = runHook(
      root,
      "AfterAgent",
      {
        conversation_id: gemAbortCid,
        status: "aborted",
        hook_event_name: "stop",
        loop_count: 0,
      },
      "gemini-cli",
    );
    expect(abortGem.status).toBe(0);
    expect(abortGem.stdout.trim()).toBe("{}");
    expect(abortGem.stderr.trim()).toBe("");
    expect(abortGem.out).toEqual({});
    assertStamp(gemAbortCid, "gemini-cli");

    for (const { cid, platform } of prior) {
      assertStamp(cid, platform);
    }
  });

  it(
    "prior hosts survive Gemini AfterTool cross-fire (wrong payload / argv)",
    () => {
    root = tmpProject();
    withKimiHome();
    installSevenHost(root);
    const cp = seedChecklist(root);
    const editPath = path.join(root, "src", "xf.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export {}\n");

    const cursorCid = "seven-cur-aaaa-bbbb-cccc-ddddeeee0004";
    const claudeCid = "seven-cla-aaaa-bbbb-cccc-ddddeeee0005";
    const codexCid = "seven-cdx-aaaa-bbbb-cccc-ddddeeee0006";
    const kimiCid = "seven-kim-aaaa-bbbb-cccc-ddddeeee0007";
    const copilotCid = "seven-cop-aaaa-bbbb-cccc-ddddeeee0008";
    const grokCid = "seven-grk-aaaa-bbbb-cccc-ddddeeee0009";
    const gemCid = "seven-gem-aaaa-bbbb-cccc-ddddeeee0010";

    const store = new StateStore(root);
    for (const [cid, platform] of [
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
      [codexCid, "codex"],
      [kimiCid, "kimi-code"],
      [copilotCid, "copilot-cli"],
      [grokCid, "grok-build"],
      [gemCid, "gemini-cli"],
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

    // Precondition: every host armed before wrong-argv cross-fire.
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
      ] as const) {
        expect(armed.getReviewChain(cid)?.code_edited).toBe(1);
      }
      armed.close();
    }

    // Wrong payload shapes / host argv — fail-open, no stamp wipe.
    const xfCursor = runHook(
      root,
      "AfterTool",
      { conversation_id: cursorCid, file_path: editPath },
      "gemini-cli",
    );
    expect(xfCursor.status).toBe(0);
    expect(xfCursor.stdout.trim()).toBe("{}");
    expect(xfCursor.stderr.trim()).toBe("");
    expect(xfCursor.out).toEqual({});

    for (const cid of [claudeCid, codexCid, kimiCid, copilotCid, grokCid] as const) {
      const xf = runHook(
        root,
        "AfterTool",
        { conversation_id: cid, file_path: editPath },
        "gemini-cli",
      );
      expect(xf.status).toBe(0);
      expect(xf.stdout.trim()).toBe("{}");
      expect(xf.stderr.trim()).toBe("");
      expect(xf.out).toEqual({});
    }

    // Gemini stamp + Cursor argv on AfterTool — unique-event wrong-platform gate → "{}".
    const xfGemViaCursor = runHook(
      root,
      "AfterTool",
      {
        sessionId: gemCid,
        toolName: "write_file",
        toolInput: { file_path: editPath },
      },
      "cursor",
    );
    expect(xfGemViaCursor.status).toBe(0);
    expect(xfGemViaCursor.stdout.trim()).toBe("{}");
    expect(xfGemViaCursor.stderr.trim()).toBe("");
    expect(xfGemViaCursor.out).toEqual({});

    const verify = new StateStore(root);
    expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
    expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
    expect(verify.getSession(codexCid)?.platform).toBe("codex");
    expect(verify.getSession(kimiCid)?.platform).toBe("kimi-code");
    expect(verify.getSession(copilotCid)?.platform).toBe("copilot-cli");
    expect(verify.getSession(grokCid)?.platform).toBe("grok-build");
    expect(verify.getSession(gemCid)?.platform).toBe("gemini-cli");
    expect(verify.getReviewChain(cursorCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(claudeCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(codexCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(kimiCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(copilotCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(grokCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(gemCid)?.code_edited).toBe(1);
    verify.close();
  },
  30_000,
  );

  it("prior six hosts non-regress when Gemini hooks exist (submit / BeforeAgent shapes)", () => {
    root = tmpProject();
    withKimiHome();
    installSevenHost(root);
    const cursorCid = "seven-sub-aaaa-bbbb-cccc-ddddeeee0010";
    const claudeCid = "seven-sub-aaaa-bbbb-cccc-ddddeeee0011";
    const codexCid = "seven-sub-aaaa-bbbb-cccc-ddddeeee0012";
    const kimiCid = "seven-sub-aaaa-bbbb-cccc-ddddeeee0013";
    const copilotCid = "seven-sub-aaaa-bbbb-cccc-ddddeeee0014";
    const grokCid = "seven-sub-aaaa-bbbb-cccc-ddddeeee0015";
    const gemCid = "seven-sub-aaaa-bbbb-cccc-ddddeeee0016";

    const seed = new StateStore(root);
    for (const [cid, platform] of [
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
      [codexCid, "codex"],
      [kimiCid, "kimi-code"],
      [copilotCid, "copilot-cli"],
      [grokCid, "grok-build"],
      [gemCid, "gemini-cli"],
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

    // Gemini Silence {} on ordinary chat BeforeAgent.
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

    const verify = new StateStore(root);
    expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
    expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
    expect(verify.getSession(codexCid)?.platform).toBe("codex");
    expect(verify.getSession(kimiCid)?.platform).toBe("kimi-code");
    expect(verify.getSession(copilotCid)?.platform).toBe("copilot-cli");
    expect(verify.getSession(grokCid)?.platform).toBe("grok-build");
    expect(verify.getSession(gemCid)?.platform).toBe("gemini-cli");
    verify.close();
  });
});
