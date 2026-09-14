/**
 * Five-host matrix: Copilot ↔ Cursor/Claude/Codex/Kimi cross-fire.
 * Wrong stamp / wrong payload → abort (Copilot = JSON "{}"; Kimi = bare exit 0);
 * lookalike Pascal/agentStop still follows --platform stamp (Copilot = decision:block+reason);
 * prior four hosts must not go red when Copilot is also enabled.
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
  COPILOT_POST_TOOL_USE_MATCHER,
} from "../src/init/copilot-hooks-merge.js";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { COPILOT_STOP_CONSECUTIVE_BLOCK_CAP } from "../../ports/copilot-cli/src/index.js";

type HostId =
  | "cursor"
  | "claude-code"
  | "codex"
  | "kimi-code"
  | "copilot-cli";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-five-host-"));
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

/** Cursor + Claude + Codex + Kimi + Copilot installable hosts in one project. */
function installFiveHost(root: string): void {
  expect(
    installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    }).ok,
  ).toBe(true);
  expect(
    installInitYes({
      projectRoot: root,
      platform: "claude-code",
      surface: "cli",
      platforms: [{ id: "claude-code", surface: "cli" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    }).ok,
  ).toBe(true);
  expect(
    installInitYes({
      projectRoot: root,
      platform: "codex",
      surface: "cli",
      platforms: [{ id: "codex", surface: "cli" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    }).ok,
  ).toBe(true);
  expect(
    installInitYes({
      projectRoot: root,
      platform: "kimi-code",
      surface: "cli",
      platforms: [{ id: "kimi-code", surface: "cli" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    }).ok,
  ).toBe(true);
  expect(
    installInitYes({
      projectRoot: root,
      platform: "copilot-cli",
      surface: "cli",
      platforms: [{ id: "copilot-cli", surface: "cli" }],
      mergePlatforms: true,
      locale: "en",
      force: true,
    }).ok,
  ).toBe(true);
}

describe("five-host Copilot cross-fire matrix", () => {
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
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-five-kimi-"));
    process.env.KIMI_CODE_HOME = kimiHome;
  }

  it("five install stamps all hosts; doctor stays ok for prior hosts", () => {
    root = tmpProject();
    withKimiHome();
    installFiveHost(root);

    const cursorHooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as { hooks: Record<string, { command: string }[]> };
    for (const event of ["beforeSubmitPrompt", "afterFileEdit", "stop"]) {
      const ap = cursorHooks.hooks[event]?.filter((h) =>
        h.command.includes("autopilot-harness"),
      );
      expect(ap?.length).toBe(1);
      expect(ap![0].command).toMatch(/--platform cursor(?:\s|$)/);
      expect(ap![0].command).toMatch(new RegExp(`--event ${event}(?:\\s|$)`));
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

    const codexRaw = fs.readFileSync(
      path.join(root, ".codex", "hooks.json"),
      "utf8",
    );
    expect(codexRaw).toMatch(/--platform codex(?:\s|$)/);

    const kimiToml = fs.readFileSync(path.join(kimiHome, "config.toml"), "utf8");
    expect(kimiToml).toMatch(/--platform kimi-code/);
    expect(kimiToml).toMatch(/timeout\s*=\s*120\b/);
    expect(kimiToml).toMatch(/UserPromptSubmit/);
    expect(kimiToml).toMatch(/PostToolUse/);
    expect(kimiToml).toMatch(/\bevent\s*=\s*"Stop"/);
    expect(fs.existsSync(path.join(root, ".kimi-code"))).toBe(false);
    expect(fs.existsSync(path.join(kimiHome, "local.toml"))).toBe(false);

    const copilotFile = JSON.parse(
      fs.readFileSync(
        path.join(root, ".github", "hooks", "autopilot-harness.json"),
        "utf8",
      ),
    ) as {
      hooks?: Record<
        string,
        Array<{
          bash?: string;
          powershell?: string;
          timeoutSec?: number;
          matcher?: string;
        }>
      >;
    };
    for (const event of COPILOT_AUTOPILOT_EVENTS) {
      const handlers = copilotFile.hooks?.[event];
      expect(Array.isArray(handlers)).toBe(true);
      expect(handlers!.length).toBeGreaterThanOrEqual(1);
      const h = handlers![0]!;
      expect(h.bash).toMatch(/--platform copilot-cli/);
      expect(h.powershell).toMatch(/--platform copilot-cli/);
      expect(h.bash).toBe(h.powershell);
      expect(h.bash).toMatch(new RegExp(`--event ${event}(?:\\s|$)`));
      expect(h.powershell).toMatch(new RegExp(`--event ${event}(?:\\s|$)`));
      expect(h.timeoutSec).toBe(COPILOT_HOOK_TIMEOUT_SEC);
      if (event === "postToolUse") {
        expect(h.matcher).toBe(COPILOT_POST_TOOL_USE_MATCHER);
      } else {
        expect(h.matcher).toBeUndefined();
      }
    }
    expect(fs.existsSync(path.join(root, ".github", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);
    const ignore = fs.readFileSync(path.join(root, ".autopilotignore"), "utf8");
    expect(ignore).toMatch(/\.github\/hooks\/\*\*/);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    for (const id of [
      "cursor",
      "claude-code",
      "codex",
      "kimi-code",
      "copilot-cli",
    ] as const) {
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
    expect(joined).toMatch(/Stop-continue.*≤1|≤1\/turn/i);
    expect(joined).toMatch(
      new RegExp(
        `Stop-continue consecutive block cap ≤${COPILOT_STOP_CONSECUTIVE_BLOCK_CAP}`,
        "i",
      ),
    );
    expect(joined).toMatch(/Restart Copilot CLI/i);
    expect(joined).toMatch(/Claude Code \+ Copilot CLI both enabled/i);
  });

  it("lookalike Pascal Stop + --platform copilot-cli follows Copilot stamp (decision:block+reason)", () => {
    root = tmpProject();
    withKimiHome();
    installFiveHost(root);
    const cp = seedChecklist(root);
    const cid = "five-copilot-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "copilot-cli",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain(cid, { code_edited: 1 });
    store.close();

    // Shared PascalCase + stop_hook_active looks like Claude; stamp must win.
    const r = runHook(
      root,
      "Stop",
      {
        session_id: cid,
        hook_event_name: "Stop",
        stop_hook_active: false,
      },
      "copilot-cli",
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
    expect(Object.keys(r.out).sort()).toEqual(["decision", "reason"]);

    const verify = new StateStore(root);
    expect(verify.getSession(cid)?.platform).toBe("copilot-cli");
    expect(verify.getSession(cid)?.armed).toBe(1);
    verify.close();
  });

  it(
    "Copilot stamp + Cursor-shaped aborted payload → halt (wrong payload abort)",
    () => {
    root = tmpProject();
    withKimiHome();
    installFiveHost(root);
    const cp = seedChecklist(root);
    const cid = "five-abort-aaaa-bbbb-cccc-ddddeeee0002";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "copilot-cli",
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

    for (const platform of [
      "copilot-cli",
      "cursor",
      "claude-code",
      "codex",
      "kimi-code",
    ] as const) {
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
      }
      const mid = new StateStore(root);
      expect(mid.getSession(cid)?.platform).toBe("copilot-cli");
      mid.close();
    }

    // Fresh session: native agentStop abort (not after Cursor-shaped halt chain).
    const nativeCid = "five-abort-native-aaaa-bbbb-cccc-ddddeeee0002";
    const nativeStore = new StateStore(root);
    nativeStore.upsertSession({
      conversation_id: nativeCid,
      project_root: root,
      code_root: root,
      platform: "copilot-cli",
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
      "agentStop",
      { sessionId: nativeCid, status: "aborted", hookEventName: "agentStop" },
      "copilot-cli",
    );
    expect(nativeAbort.status).toBe(0);
    expect(nativeAbort.stdout.trim()).toBe("{}");
    expect(nativeAbort.stderr.trim()).toBe("");
    expect(nativeAbort.out).toEqual({});
    expect(Object.keys(nativeAbort.out).sort()).toEqual([]);

    const verify = new StateStore(root);
    expect(verify.getSession(cid)).toEqual(
      expect.objectContaining({
        platform: "copilot-cli",
        error_count: 0,
      }),
    );
    expect(verify.getReviewChain(cid)).toEqual(
      expect.objectContaining({
        pending_followup: null,
        code_edited: 0,
      }),
    );
    expect(verify.getSession(nativeCid)).toEqual(
      expect.objectContaining({
        platform: "copilot-cli",
        error_count: 0,
      }),
    );
    expect(verify.getReviewChain(nativeCid)).toEqual(
      expect.objectContaining({
        code_edited: 0,
      }),
    );
    verify.close();
  },
  30_000,
  );

  it("wrong --platform on foreign stamp Stop does not wipe Cursor/Claude/Codex/Kimi/Copilot", () => {
    root = tmpProject();
    withKimiHome();
    installFiveHost(root);
    const cp = seedChecklist(root);
    const copilotKimiXf = "five-xf-cop-kimi-aaaa-bbbb-cccc-ddddeeee0053";
    const copilotClaudeXf = "five-xf-cop-cla-aaaa-bbbb-cccc-ddddeeee0054";
    const copilotAbortCid = "five-xf-cop-abt-aaaa-bbbb-cccc-ddddeeee0055";
    const kimiAbortCid = "five-xf-kim-abt-aaaa-bbbb-cccc-ddddeeee0056";
    const hosts: Array<{ cid: string; platform: HostId }> = [
      { cid: "five-xf-aaaa-bbbb-cccc-ddddeeee0013", platform: "cursor" },
      { cid: "five-xf-aaaa-bbbb-cccc-ddddeeee0023", platform: "claude-code" },
      { cid: "five-xf-aaaa-bbbb-cccc-ddddeeee0033", platform: "codex" },
      { cid: "five-xf-aaaa-bbbb-cccc-ddddeeee0043", platform: "kimi-code" },
    ];
    const store = new StateStore(root);
    for (const { cid, platform } of hosts) {
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
    for (const cid of [copilotKimiXf, copilotClaudeXf, copilotAbortCid] as const) {
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "copilot-cli",
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

    // Copilot stamp + kimi argv + Pascal lookalike — Kimi channel (exit 2), stamp stays.
    const xfCopilotViaKimi = runHook(
      root,
      "Stop",
      {
        session_id: copilotKimiXf,
        hook_event_name: "Stop",
        stop_hook_active: false,
      },
      "kimi-code",
    );
    expect(xfCopilotViaKimi.status).toBe(2);
    expect(xfCopilotViaKimi.stdout.trim()).toBe("");
    expect(xfCopilotViaKimi.stderr.trim().length).toBeGreaterThan(0);
    expect(xfCopilotViaKimi.stderr).not.toMatch(/"decision"\s*:\s*"block"/);
    expect(xfCopilotViaKimi.out).toEqual({});
    assertStamp(copilotKimiXf, "copilot-cli");

    // Argv lies claude-code on Copilot stamp; DB stamp must not be rewritten.
    const xfCopilot = runHook(
      root,
      "agentStop",
      {
        sessionId: copilotClaudeXf,
        hookEventName: "agentStop",
        stopHookActive: false,
      },
      "claude-code",
    );
    expect(xfCopilot.status).toBe(0);
    expect(xfCopilot.stderr.trim()).toBe("");
    expect(xfCopilot.out.__parse_error).toBeUndefined();
    expect(xfCopilot.out.decision).toBe("block");
    expect(typeof xfCopilot.out.reason).toBe("string");
    expect(xfCopilot.out.continue).toBeUndefined();
    expect(xfCopilot.out.followup_message).toBeUndefined();
    expect(xfCopilot.out.hookSpecificOutput).toBeUndefined();
    assertStamp(copilotClaudeXf, "copilot-cli");

    // Copilot stamp + Cursor abort under copilot argv → JSON halt {}.
    const abortCopilot = runHook(
      root,
      "Stop",
      {
        conversation_id: copilotAbortCid,
        status: "aborted",
        hook_event_name: "stop",
        loop_count: 0,
      },
      "copilot-cli",
    );
    expect(abortCopilot.status).toBe(0);
    expect(abortCopilot.stdout.trim()).toBe("{}");
    expect(abortCopilot.stderr.trim()).toBe("");
    expect(abortCopilot.out).toEqual({});
    assertStamp(copilotAbortCid, "copilot-cli");

    // Cursor/Claude/Codex/Kimi stamp + copilot-cli argv + agentStop lookalike.
    for (const { cid, platform } of hosts) {
      const xf = runHook(
        root,
        "agentStop",
        {
          sessionId: cid,
          hookEventName: "agentStop",
          stopHookActive: false,
        },
        "copilot-cli",
      );
      expect(xf.status).toBe(0);
      expect(xf.stderr.trim()).toBe("");
      expect(xf.out.__parse_error).toBeUndefined();
      expect(xf.out.decision).toBe("block");
      expect(typeof xf.out.reason).toBe("string");
      expect(xf.out.continue).toBeUndefined();
      expect(xf.out.followup_message).toBeUndefined();
      expect(xf.out.hookSpecificOutput).toBeUndefined();
      expect(Object.keys(xf.out).sort()).toEqual(["decision", "reason"]);
      assertStamp(cid, platform);
    }

    // Fresh Kimi stamp + kimi argv + Cursor abort → bare halt (not after continue).
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

    for (const { cid, platform } of hosts) {
      assertStamp(cid, platform);
    }
    for (const cid of [copilotKimiXf, copilotClaudeXf, copilotAbortCid] as const) {
      assertStamp(cid, "copilot-cli");
    }
  });

  it(
    "prior hosts survive Copilot postToolUse cross-fire (wrong payload / argv)",
    () => {
    root = tmpProject();
    withKimiHome();
    installFiveHost(root);
    const cp = seedChecklist(root);
    const editPath = path.join(root, "src", "xf.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export {}\n");

    const cursorCid = "five-cur-aaaa-bbbb-cccc-ddddeeee0004";
    const claudeCid = "five-cla-aaaa-bbbb-cccc-ddddeeee0005";
    const codexCid = "five-cdx-aaaa-bbbb-cccc-ddddeeee0006";
    const kimiCid = "five-kim-aaaa-bbbb-cccc-ddddeeee0007";
    const copilotCid = "five-cop-aaaa-bbbb-cccc-ddddeeee0008";

    const store = new StateStore(root);
    for (const [cid, platform] of [
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
      [codexCid, "codex"],
      [kimiCid, "kimi-code"],
      [copilotCid, "copilot-cli"],
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

    // Wrong payload shapes / host argv — fail-open, no stamp wipe.
    // Use Cursor-shaped PTU (conversation_id + file_path, no toolName) under
    // copilot/kimi argv so Copilot/Kimi do not stampPlatform-rewrite a foreign
    // session (valid edit|Write + session_id would).
    const xfCursor = runHook(
      root,
      "postToolUse",
      { conversation_id: cursorCid, file_path: editPath },
      "copilot-cli",
    );
    expect(xfCursor.status).toBe(0);
    expect(xfCursor.stdout.trim()).toBe("{}");
    expect(xfCursor.stderr.trim()).toBe("");
    expect(xfCursor.out).toEqual({});

    for (const cid of [claudeCid, codexCid, kimiCid] as const) {
      const xf = runHook(
        root,
        "PostToolUse",
        { conversation_id: cid, file_path: editPath },
        "copilot-cli",
      );
      expect(xf.status).toBe(0);
      expect(xf.stdout.trim()).toBe("{}");
      expect(xf.stderr.trim()).toBe("");
      expect(xf.out).toEqual({});
    }

    for (const cid of [cursorCid, claudeCid, codexCid] as const) {
      const xf = runHook(
        root,
        "PostToolUse",
        { conversation_id: cid, file_path: editPath },
        "kimi-code",
      );
      expect(xf.status).toBe(0);
      expect(xf.stdout.trim()).toBe("");
      expect(xf.stderr.trim()).toBe("");
      expect(xf.out).toEqual({});
    }

    const xfKimiViaCursor = runHook(
      root,
      "PostToolUse",
      {
        session_id: kimiCid,
        tool_name: "Write",
        tool_input: { file_path: editPath },
      },
      "cursor",
    );
    expect(xfKimiViaCursor.status).toBe(0);
    // Cursor argv has no PostToolUse handler → JSON "{}" fail-open (not Kimi bare).
    expect(xfKimiViaCursor.stdout.trim()).toBe("{}");
    expect(xfKimiViaCursor.stderr.trim()).toBe("");
    expect(xfKimiViaCursor.out).toEqual({});

    const xfCopilotViaCursor = runHook(
      root,
      "postToolUse",
      {
        sessionId: copilotCid,
        toolName: "edit",
        tool_input: { path: editPath },
      },
      "cursor",
    );
    expect(xfCopilotViaCursor.status).toBe(0);
    // Cursor argv has no postToolUse handler → JSON "{}" fail-open.
    expect(xfCopilotViaCursor.stdout.trim()).toBe("{}");
    expect(xfCopilotViaCursor.stderr.trim()).toBe("");
    expect(xfCopilotViaCursor.out).toEqual({});

    const verify = new StateStore(root);
    expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
    expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
    expect(verify.getSession(codexCid)?.platform).toBe("codex");
    expect(verify.getSession(kimiCid)?.platform).toBe("kimi-code");
    expect(verify.getSession(copilotCid)?.platform).toBe("copilot-cli");
    expect(verify.getReviewChain(cursorCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(claudeCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(codexCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(kimiCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(copilotCid)?.code_edited).toBe(1);
    verify.close();
  },
  30_000,
  );

  it("Cursor/Claude/Codex/Kimi non-regress when Copilot hooks exist (submit shapes)", () => {
    root = tmpProject();
    withKimiHome();
    installFiveHost(root);
    const cursorCid = "five-sub-aaaa-bbbb-cccc-ddddeeee0009";
    const claudeCid = "five-sub-aaaa-bbbb-cccc-ddddeeee0010";
    const codexCid = "five-sub-aaaa-bbbb-cccc-ddddeeee0011";
    const kimiCid = "five-sub-aaaa-bbbb-cccc-ddddeeee0012";
    const copilotCid = "five-sub-aaaa-bbbb-cccc-ddddeeee0013";

    const seed = new StateStore(root);
    for (const [cid, platform] of [
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
      [codexCid, "codex"],
      [kimiCid, "kimi-code"],
      [copilotCid, "copilot-cli"],
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
    expect(cursor.out.__parse_error).toBeUndefined();

    const claude = runHook(
      root,
      "UserPromptSubmit",
      { session_id: claudeCid, prompt: "hello claude" },
      "claude-code",
    );
    expect(claude.status).toBe(0);
    expect(claude.out.continue).toBeUndefined();
    expect(claude.out.decision).toBeUndefined();
    expect(claude.out.__parse_error).toBeUndefined();

    const codex = runHook(
      root,
      "UserPromptSubmit",
      { session_id: codexCid, prompt: "hello codex" },
      "codex",
    );
    expect(codex.status).toBe(0);
    expect(codex.out.continue).toBeUndefined();
    expect(codex.out.decision).toBeUndefined();
    expect(codex.out.__parse_error).toBeUndefined();

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
    expect(copilotUps.stderr.trim()).toBe("");
    expect(copilotUps.out).toEqual({});
    expect(copilotUps.out.decision).toBeUndefined();
    expect(copilotUps.out.modifiedTransformedPrompt).toBeUndefined();

    const copilotTransform = runHook(
      root,
      "userPromptTransformed",
      {
        sessionId: copilotCid,
        prompt: "hello copilot",
        transformedPrompt: "hello copilot",
      },
      "copilot-cli",
    );
    expect(copilotTransform.status).toBe(0);
    expect(copilotTransform.stderr.trim()).toBe("");
    expect(copilotTransform.out).toEqual({});
    expect(copilotTransform.out.__parse_error).toBeUndefined();

    // Hello submit must not rewrite foreign or Copilot stamps.
    const verify = new StateStore(root);
    expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
    expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
    expect(verify.getSession(codexCid)?.platform).toBe("codex");
    expect(verify.getSession(kimiCid)?.platform).toBe("kimi-code");
    expect(verify.getSession(copilotCid)?.platform).toBe("copilot-cli");
    verify.close();
  });
});
