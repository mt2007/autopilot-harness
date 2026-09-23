/**
 * Triple-host matrix: Codex ↔ Cursor/Claude cross-fire.
 * Wrong stamp / wrong payload → abort {}; lookalike shapes still follow stamp;
 * Cursor+Claude dual-host wiring must not go red when Codex is also enabled.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";
import { AUTOPILOT_EVENTS } from "../src/init/types.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-triple-host-"));
}

function hookPath(root: string): string {
  return path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs");
}

function runHook(
  root: string,
  event: string,
  payload: Record<string, unknown>,
  platform?: string,
): { status: number | null; out: Record<string, unknown> } {
  const args = [hookPath(root)];
  if (platform) args.push("--platform", platform);
  args.push("--event", event);
  const proc = spawnSync(process.execPath, args, {
    cwd: root,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 15_000,
  });
  let out: Record<string, unknown> = {};
  try {
    out = JSON.parse(proc.stdout.trim() || "{}") as Record<string, unknown>;
  } catch {
    out = { __parse_error: proc.stdout };
  }
  return { status: proc.status, out };
}

function seedChecklist(root: string, slug = "demo"): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  fs.writeFileSync(cp, "- [ ] a — A\n- [ ] b — B\n");
  return cp;
}

/** Cursor + Claude + Codex installable hosts in one project. */
function installTripleHost(root: string): void {
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
}

describe("triple-host Codex cross-fire matrix", () => {
  let root = "";
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    root = "";
  });

  it("triple install stamps all three hosts; doctor stays ok for Cursor+Claude wiring", () => {
    root = tmpProject();
    installTripleHost(root);

    const cursorHooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as { hooks: Record<string, { command: string }[]> };
    for (const event of AUTOPILOT_EVENTS) {
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
    // Must not treat StopFailure as Stop (Stop is a prefix).
    expect(claudeStop.every((c) => /--event Stop(?:\s|$)/.test(c))).toBe(true);
    expect(claudeStop.some((c) => /--event StopFailure(?:\s|$)/.test(c))).toBe(
      false,
    );

    const codexRaw = fs.readFileSync(
      path.join(root, ".codex", "hooks.json"),
      "utf8",
    );
    expect(codexRaw).toMatch(/--platform codex(?:\s|$)/);
    expect(codexRaw).not.toMatch(/"timeout"\s*:/);
    const codexHooks = JSON.parse(codexRaw) as {
      hooks?: Record<
        string,
        { matcher?: string; hooks?: { command?: string; timeout?: number }[] }[]
      >;
    };
    expect(codexHooks.hooks?.StopFailure).toBeUndefined();
    const codexStopCmds = (codexHooks.hooks?.Stop ?? [])
      .flatMap((g) => g.hooks ?? [])
      .map((h) => h.command ?? "")
      .filter((c) => c.includes("autopilot-harness"));
    expect(codexStopCmds.length).toBeGreaterThanOrEqual(1);
    expect(codexStopCmds.every((c) => /--platform codex(?:\s|$)/.test(c))).toBe(
      true,
    );
    expect(codexStopCmds.every((c) => /--event Stop(?:\s|$)/.test(c))).toBe(
      true,
    );
    const codexPtu = codexHooks.hooks?.PostToolUse ?? [];
    expect(codexPtu.some((g) => g.matcher === "apply_patch|Edit|Write|exec|js")).toBe(
      true,
    );
    expect(
      codexPtu
        .flatMap((g) => g.hooks ?? [])
        .some(
          (h) =>
            typeof h.command === "string" &&
            /--platform codex(?:\s|$)/.test(h.command) &&
            /--event PostToolUse(?:\s|$)/.test(h.command),
        ),
    ).toBe(true);

    const cfg = fs.readFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "utf8",
    );
    expect(cfg).toMatch(/^\s*-\s*id:\s*cursor\s*$/m);
    expect(cfg).toMatch(/^\s*-\s*id:\s*claude-code\s*$/m);
    expect(cfg).toMatch(/^\s*-\s*id:\s*codex\s*$/m);
    expect(fs.existsSync(path.join(root, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".codex", "skills"))).toBe(false);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(true);
    const joined = lines.join("\n");
    // Dual-host Cursor+Claude must not go red when Codex is also present.
    expect(joined).not.toMatch(/\bFAIL\b/);
    expect(joined).toMatch(/OK\s+hooks\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+\.claude\/settings\.json Autopilot entries/);
    expect(joined).toMatch(/OK\s+\.codex\/hooks\.json Autopilot entries/);
    expect(joined).toMatch(/\/hooks trust/i);
  });

  it("lookalike Claude Stop shape + --platform codex follows Codex stamp (armed → block)", () => {
    root = tmpProject();
    installTripleHost(root);
    const cp = seedChecklist(root);
    const cid = "triple-codex-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "codex",
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
      "codex",
    );
    expect(r.status).toBe(0);
    expect(r.out.__parse_error).toBeUndefined();
    expect(r.out.decision).toBe("block");
    expect(typeof r.out.reason).toBe("string");
    expect(String(r.out.reason).length).toBeGreaterThan(0);
    expect(r.out.continue).toBeUndefined();
    expect(r.out.followup_message).toBeUndefined();
    // Codex Channel C only — no Claude additionalContext / Cursor followup.
    expect(r.out.hookSpecificOutput).toBeUndefined();
    expect(Object.keys(r.out).sort()).toEqual(["decision", "reason"]);

    const verify = new StateStore(root);
    expect(verify.getSession(cid)?.platform).toBe("codex");
    verify.close();
  });

  it("Codex stamp + Cursor-shaped aborted payload → halt {} (wrong payload abort)", () => {
    root = tmpProject();
    installTripleHost(root);
    const cp = seedChecklist(root);
    const cid = "triple-abort-aaaa-bbbb-cccc-ddddeeee0002";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "codex",
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

    // Wrong payload (Cursor aborted) under each host argv → halt {}; stamp stays.
    for (const platform of ["codex", "cursor", "claude-code"] as const) {
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
      expect(r.out).toEqual({});
      expect(r.out.decision).toBeUndefined();
      expect(r.out.followup_message).toBeUndefined();
      expect(r.out.__parse_error).toBeUndefined();
      const mid = new StateStore(root);
      expect(mid.getSession(cid)?.platform).toBe("codex");
      mid.close();
    }

    const verify = new StateStore(root);
    const sess = verify.getSession(cid);
    expect(sess?.platform).toBe("codex");
    expect(sess?.error_count ?? 0).toBe(0);
    verify.close();
  });

  it("wrong --platform on foreign stamp Stop does not wipe Cursor/Claude/Codex", () => {
    root = tmpProject();
    installTripleHost(root);
    const cp = seedChecklist(root);
    const codexCid = "triple-xf-aaaa-bbbb-cccc-ddddeeee0003";
    const cursorCid = "triple-xf-aaaa-bbbb-cccc-ddddeeee0013";
    const claudeCid = "triple-xf-aaaa-bbbb-cccc-ddddeeee0023";
    const store = new StateStore(root);
    for (const [cid, platform] of [
      [codexCid, "codex"],
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
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
      store.updateReviewChain(cid, { code_edited: 1 });
    }
    store.close();

    const assertStamp = (
      cid: string,
      platform: "codex" | "cursor" | "claude-code",
    ) => {
      const v = new StateStore(root);
      expect(v.getSession(cid)?.platform).toBe(platform);
      expect(v.getSession(cid)?.armed).toBe(1);
      v.close();
    };

    // Argv lies claude-code on Codex stamp; stamp must not be rewritten.
    const xfCodex = runHook(
      root,
      "Stop",
      {
        session_id: codexCid,
        hook_event_name: "Stop",
        stop_hook_active: false,
      },
      "claude-code",
    );
    expect(xfCodex.status).toBe(0);
    // Claude/Codex share decision:block; Cursor followup_message must stay absent.
    expect(xfCodex.out.followup_message).toBeUndefined();
    expect(xfCodex.out.__parse_error).toBeUndefined();
    assertStamp(codexCid, "codex");

    // Cursor stamp + Codex argv + Pascal lookalike — must not rewrite to codex.
    const xfCursor = runHook(
      root,
      "Stop",
      {
        session_id: cursorCid,
        hook_event_name: "Stop",
        stop_hook_active: false,
      },
      "codex",
    );
    expect(xfCursor.status).toBe(0);
    expect(xfCursor.out.followup_message).toBeUndefined();
    expect(xfCursor.out.__parse_error).toBeUndefined();
    assertStamp(cursorCid, "cursor");

    // Claude stamp + Codex argv — must not rewrite to codex.
    const xfClaude = runHook(
      root,
      "Stop",
      {
        session_id: claudeCid,
        hook_event_name: "Stop",
        stop_hook_active: false,
      },
      "codex",
    );
    expect(xfClaude.status).toBe(0);
    expect(xfClaude.out.followup_message).toBeUndefined();
    expect(xfClaude.out.__parse_error).toBeUndefined();
    assertStamp(claudeCid, "claude-code");

    // Cursor/Claude stamp + Codex argv + Cursor aborted → universal halt {}.
    for (const [cid, platform] of [
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
    ] as const) {
      const abort = runHook(
        root,
        "Stop",
        {
          conversation_id: cid,
          status: "aborted",
          hook_event_name: "stop",
          loop_count: 0,
        },
        "codex",
      );
      expect(abort.status).toBe(0);
      expect(abort.out).toEqual({});
      assertStamp(cid, platform);
    }
    assertStamp(codexCid, "codex");
  });

  it("Cursor/Claude sessions survive Codex PostToolUse cross-fire (wrong payload)", () => {
    root = tmpProject();
    installTripleHost(root);
    const cp = seedChecklist(root);
    const editPath = path.join(root, "src", "xf.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export {}\n");

    const cursorCid = "triple-cur-aaaa-bbbb-cccc-ddddeeee0004";
    const claudeCid = "triple-cla-aaaa-bbbb-cccc-ddddeeee0005";
    const codexCid = "triple-cdx-aaaa-bbbb-cccc-ddddeeee0006";

    const store = new StateStore(root);
    for (const [cid, platform] of [
      [cursorCid, "cursor"],
      [claudeCid, "claude-code"],
      [codexCid, "codex"],
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

    // Wrong payload shapes / host argv — fail-open {}, no stamp wipe.
    const xfCursor = runHook(
      root,
      "PostToolUse",
      { conversation_id: cursorCid, file_path: editPath },
      "codex",
    );
    expect(xfCursor.status).toBe(0);
    expect(xfCursor.out).toEqual({});
    expect(xfCursor.out.__parse_error).toBeUndefined();

    const xfClaude = runHook(
      root,
      "afterFileEdit",
      { conversation_id: claudeCid, file_path: editPath },
      "codex",
    );
    expect(xfClaude.status).toBe(0);
    expect(xfClaude.out).toEqual({});
    expect(xfClaude.out.__parse_error).toBeUndefined();

    // Reverse fail-open: Codex-shaped edit under Cursor argv (Cursor has no
    // PostToolUse handler) must not wipe Codex stamp. Same-shape Claude argv is
    // intentional host migration in core — not asserted here as "abort".
    const xfCodexViaCursor = runHook(
      root,
      "PostToolUse",
      {
        session_id: codexCid,
        tool_name: "Write",
        tool_input: { file_path: editPath },
      },
      "cursor",
    );
    expect(xfCodexViaCursor.status).toBe(0);
    expect(xfCodexViaCursor.out).toEqual({});
    expect(xfCodexViaCursor.out.__parse_error).toBeUndefined();

    const verify = new StateStore(root);
    expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
    expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
    expect(verify.getSession(codexCid)?.platform).toBe("codex");
    expect(verify.getReviewChain(cursorCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(claudeCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(codexCid)?.code_edited).toBe(1);
    verify.close();
  });

  it("Cursor+Claude dual-host non-regress when Codex hooks exist (submit shapes)", () => {
    root = tmpProject();
    installTripleHost(root);
    const cursorCid = "triple-sub-aaaa-bbbb-cccc-ddddeeee0007";
    const claudeCid = "triple-sub-aaaa-bbbb-cccc-ddddeeee0008";
    const codexCid = "triple-sub-aaaa-bbbb-cccc-ddddeeee0009";

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
  });
});
