/**
 * Quad-host matrix: Kimi ↔ Cursor/Claude/Codex cross-fire.
 * Wrong stamp / wrong payload → abort (Kimi = bare exit 0, no JSON "{}");
 * lookalike Pascal Stop still follows --platform stamp (Kimi = exit 2+stderr);
 * Cursor+Claude+Codex wiring must not go red when Kimi is also enabled.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";

type HostId = "cursor" | "claude-code" | "codex" | "kimi-code";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-quad-host-"));
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

/** Cursor + Claude + Codex + Kimi installable hosts in one project. */
function installQuadHost(root: string): void {
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
}

describe("quad-host Kimi cross-fire matrix", () => {
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
    kimiHome = fs.mkdtempSync(path.join(os.tmpdir(), "ap-quad-kimi-"));
    process.env.KIMI_CODE_HOME = kimiHome;
  }

  it("quad install stamps all four hosts; doctor stays ok for prior hosts", () => {
    root = tmpProject();
    withKimiHome();
    installQuadHost(root);

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

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/^\s*-\s*id:\s*cursor\s*$/m);
    expect(cfg).toMatch(/^\s*-\s*id:\s*claude-code\s*$/m);
    expect(cfg).toMatch(/^\s*-\s*id:\s*codex\s*$/m);
    expect(cfg).toMatch(/^\s*-\s*id:\s*kimi-code\s*$/m);

    const { ok, lines } = runDoctor(root, { kimiCodeHome: kimiHome });
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    // Prior hosts must not go red when Kimi is also present (Kimi Stop≤1 WARN ok).
    expect(joined).not.toMatch(/\bFAIL\b/);
    expect(joined).toMatch(/OK\s+hooks\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+\.codex\/hooks\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+Kimi Code config\.toml Autopilot entries/);
    expect(joined).toMatch(/Stop-continue.*≤1|≤1\/turn/i);
  });

  it("lookalike Claude Stop shape + --platform kimi-code follows Kimi stamp (exit 2+stderr)", () => {
    root = tmpProject();
    withKimiHome();
    installQuadHost(root);
    const cp = seedChecklist(root);
    const cid = "quad-kimi-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "kimi-code",
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
      "kimi-code",
    );
    expect(r.status).toBe(2);
    expect(r.stderr.trim().length).toBeGreaterThan(0);
    expect(r.stdout.trim()).toBe("");
    expect(r.stderr).not.toMatch(/"decision"\s*:\s*"block"/);
    // Empty stdout must not be mistaken for Claude JSON block.
    expect(r.out).toEqual({});

    const verify = new StateStore(root);
    expect(verify.getSession(cid)?.platform).toBe("kimi-code");
    expect(verify.getSession(cid)?.armed).toBe(1);
    verify.close();
  });

  it("Kimi stamp + Cursor-shaped aborted payload → halt bare exit 0 (wrong payload abort)", () => {
    root = tmpProject();
    withKimiHome();
    installQuadHost(root);
    const cp = seedChecklist(root);
    const cid = "quad-abort-aaaa-bbbb-cccc-ddddeeee0002";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "kimi-code",
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

    // Wrong payload (Cursor aborted) under each host argv → halt; stamp stays.
    for (const platform of [
      "kimi-code",
      "cursor",
      "claude-code",
      "codex",
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
        // Kimi must not emit JSON "{}" (would pollute context).
        expect(r.stdout.trim()).toBe("");
        expect(r.stderr.trim()).toBe("");
        expect(r.out).toEqual({});
      } else {
        // Cursor/Claude/Codex halt speaks JSON "{}" on stdout.
        expect(r.stdout.trim()).toBe("{}");
        expect(r.stderr.trim()).toBe("");
        expect(r.out).toEqual({});
        expect(r.out.decision).toBeUndefined();
      }
      const mid = new StateStore(root);
      expect(mid.getSession(cid)?.platform).toBe("kimi-code");
      mid.close();
    }

    const verify = new StateStore(root);
    const sess = verify.getSession(cid);
    expect(sess?.platform).toBe("kimi-code");
    expect(sess?.error_count ?? 0).toBe(0);
    verify.close();
  });

  it("wrong --platform on foreign stamp Stop does not wipe Cursor/Claude/Codex/Kimi", () => {
    root = tmpProject();
    withKimiHome();
    installQuadHost(root);
    const cp = seedChecklist(root);
    const hosts: Array<{ cid: string; platform: HostId }> = [
      { cid: "quad-xf-aaaa-bbbb-cccc-ddddeeee0003", platform: "kimi-code" },
      { cid: "quad-xf-aaaa-bbbb-cccc-ddddeeee0013", platform: "cursor" },
      { cid: "quad-xf-aaaa-bbbb-cccc-ddddeeee0023", platform: "claude-code" },
      { cid: "quad-xf-aaaa-bbbb-cccc-ddddeeee0033", platform: "codex" },
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
    store.close();

    const assertStamp = (cid: string, platform: HostId) => {
      const v = new StateStore(root);
      expect(v.getSession(cid)?.platform).toBe(platform);
      expect(v.getSession(cid)?.armed).toBe(1);
      v.close();
    };

    // Argv lies claude-code on Kimi stamp; stamp must not be rewritten.
    // Layer C emits Claude decision:block on dirty armed, but platform stays kimi.
    const xfKimi = runHook(
      root,
      "Stop",
      {
        session_id: hosts[0]!.cid,
        hook_event_name: "Stop",
        stop_hook_active: false,
      },
      "claude-code",
    );
    expect(xfKimi.status).toBe(0);
    expect(xfKimi.out.__parse_error).toBeUndefined();
    expect(xfKimi.out.decision).toBe("block");
    expect(typeof xfKimi.out.reason).toBe("string");
    expect(String(xfKimi.out.reason).length).toBeGreaterThan(0);
    expect(xfKimi.out.followup_message).toBeUndefined();
    expect(xfKimi.out.hookSpecificOutput).toBeUndefined();
    assertStamp(hosts[0]!.cid, "kimi-code");

    // Kimi stamp session + Cursor abort under kimi argv → bare halt.
    const abortKimi = runHook(
      root,
      "Stop",
      {
        conversation_id: hosts[0]!.cid,
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
    assertStamp(hosts[0]!.cid, "kimi-code");

    // Cursor/Claude/Codex stamp + Kimi argv + Pascal lookalike — stamp must
    // stay; argv kimi speaks exit 2+stderr (not Claude JSON) on dirty armed.
    for (const { cid, platform } of [
      hosts[1]!,
      hosts[2]!,
      hosts[3]!,
    ] as const) {
      const xf = runHook(
        root,
        "Stop",
        {
          session_id: cid,
          hook_event_name: "Stop",
          stop_hook_active: false,
        },
        "kimi-code",
      );
      expect(xf.status).toBe(2);
      expect(xf.stdout.trim()).toBe("");
      expect(xf.stderr.trim().length).toBeGreaterThan(0);
      expect(xf.stderr).not.toMatch(/"decision"\s*:\s*"block"/);
      expect(xf.out).toEqual({});
      assertStamp(cid, platform);
    }

    for (const { cid, platform } of hosts) {
      assertStamp(cid, platform);
    }
  });

  it("prior hosts survive Kimi PostToolUse cross-fire (wrong payload / argv)", () => {
    root = tmpProject();
    withKimiHome();
    installQuadHost(root);
    const cp = seedChecklist(root);
    const editPath = path.join(root, "src", "xf.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export {}\n");

    const cursorCid = "quad-cur-aaaa-bbbb-cccc-ddddeeee0004";
    const claudeCid = "quad-cla-aaaa-bbbb-cccc-ddddeeee0005";
    const codexCid = "quad-cdx-aaaa-bbbb-cccc-ddddeeee0006";
    const kimiCid = "quad-kim-aaaa-bbbb-cccc-ddddeeee0007";

    const store = new StateStore(root);
    for (const [cid, platform] of [
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
      [codexCid, "codex"],
      [kimiCid, "kimi-code"],
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

    // Correct arming paths.
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

    // Wrong payload shapes / host argv — fail-open, no stamp wipe.
    // Use Cursor-shaped PTU under kimi argv so Kimi does not stampKimiPlatform
    // rewrite a foreign session (valid Write+session_id would).
    const xfCursor = runHook(
      root,
      "PostToolUse",
      { conversation_id: cursorCid, file_path: editPath },
      "kimi-code",
    );
    expect(xfCursor.status).toBe(0);
    expect(xfCursor.stdout.trim()).toBe("");
    expect(xfCursor.stderr.trim()).toBe("");
    expect(xfCursor.out).toEqual({});

    const xfClaude = runHook(
      root,
      "PostToolUse",
      { conversation_id: claudeCid, file_path: editPath },
      "kimi-code",
    );
    expect(xfClaude.status).toBe(0);
    expect(xfClaude.stdout.trim()).toBe("");
    expect(xfClaude.stderr.trim()).toBe("");
    expect(xfClaude.out).toEqual({});

    const xfCodex = runHook(
      root,
      "PostToolUse",
      { conversation_id: codexCid, file_path: editPath },
      "kimi-code",
    );
    expect(xfCodex.status).toBe(0);
    expect(xfCodex.stdout.trim()).toBe("");
    expect(xfCodex.stderr.trim()).toBe("");
    expect(xfCodex.out).toEqual({});

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

    const verify = new StateStore(root);
    expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
    expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
    expect(verify.getSession(codexCid)?.platform).toBe("codex");
    expect(verify.getSession(kimiCid)?.platform).toBe("kimi-code");
    expect(verify.getReviewChain(cursorCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(claudeCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(codexCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(kimiCid)?.code_edited).toBe(1);
    verify.close();
  });

  it("Cursor/Claude/Codex non-regress when Kimi hooks exist (submit shapes)", () => {
    root = tmpProject();
    withKimiHome();
    installQuadHost(root);
    const cursorCid = "quad-sub-aaaa-bbbb-cccc-ddddeeee0008";
    const claudeCid = "quad-sub-aaaa-bbbb-cccc-ddddeeee0009";
    const codexCid = "quad-sub-aaaa-bbbb-cccc-ddddeeee0010";
    const kimiCid = "quad-sub-aaaa-bbbb-cccc-ddddeeee0011";

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
  });
});
