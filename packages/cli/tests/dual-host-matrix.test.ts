/**
 * Dual-host Cursor non-regression matrix.
 * Run before every checklist advance that touches shared hook/vendor/state/init.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore, ensureAmbientReviewSession } from "@autopilot-harness/core";
import { installInitYes } from "../src/init/install.js";
import { upgradeProject } from "../src/upgrade.js";
import { uninstallProject } from "../src/uninstall.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-dual-host-"));
}

function hookPath(root: string): string {
  return path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs");
}

function runHook(
  root: string,
  event: string,
  payload: Record<string, unknown>,
  platform?: string,
): { status: number | null; out: Record<string, unknown>; stderr: string } {
  const args = [hookPath(root)];
  if (platform) {
    args.push("--platform", platform);
  }
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
  return { status: proc.status, out, stderr: proc.stderr ?? "" };
}

function seedChecklist(root: string, slug = "demo"): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, "- [ ] a — A\n- [ ] b — B\n");
  return cp;
}

function installDualHost(root: string): void {
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
    platform: "claude-code",
    surface: "cli",
    platforms: [{ id: "claude-code", surface: "cli" }],
    mergePlatforms: true,
    locale: "en",
    force: true,
  });
  expect(add.ok).toBe(true);
}

describe("dual-host Cursor non-regression matrix", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("install stamps --platform on Cursor + Claude Autopilot commands", () => {
    root = tmpProject();
    installDualHost(root);

    const hooks = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as { hooks: Record<string, { command: string }[]> };
    for (const event of ["beforeSubmitPrompt", "afterFileEdit", "stop"]) {
      const ap = hooks.hooks[event]?.filter((h) =>
        h.command.includes("autopilot-harness"),
      );
      expect(ap?.length).toBe(1);
      expect(ap![0].command).toMatch(/--platform cursor/);
      expect(ap![0].command).toMatch(new RegExp(`--event ${event}`));
    }

    const settings = JSON.parse(
      fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
    ) as {
      hooks: Record<string, { hooks?: { command?: string }[] }[]>;
    };
    for (const event of [
      "UserPromptSubmit",
      "PostToolUse",
      "Stop",
      "StopFailure",
    ]) {
      const cmds = (settings.hooks[event] ?? [])
        .flatMap((g) => g.hooks ?? [])
        .map((h) => h.command ?? "")
        .filter((c) => c.includes("autopilot-harness"));
      expect(cmds.length).toBeGreaterThanOrEqual(1);
      expect(cmds.every((c) => /--platform claude-code/.test(c))).toBe(true);
      expect(cmds.some((c) => c.includes(`--event ${event}`))).toBe(true);
    }
  });

  it("Stop cross-fire with --platform claude-code + Cursor aborted → {}", () => {
    root = tmpProject();
    installDualHost(root);
    const cp = seedChecklist(root);
    const cid = "dual-plat-aaaa-bbbb-cccc-ddddeeee0011";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain(cid, {
      pending_followup: "恢复：上一回合出错。继续当前规划。",
    });
    store.close();

    const r = runHook(
      root,
      "Stop",
      {
        conversation_id: cid,
        session_id: cid,
        status: "aborted",
        hook_event_name: "stop",
        loop_count: 0,
      },
      "claude-code",
    );
    expect(r.status).toBe(0);
    expect(r.out).toEqual({});
    expect(r.out.decision).toBeUndefined();
  });

  it("Cursor native stop with --platform cursor aborted → halt {}", () => {
    root = tmpProject();
    installDualHost(root);
    const cp = seedChecklist(root);
    const cid = "dual-plat-aaaa-bbbb-cccc-ddddeeee0012";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.close();

    const r = runHook(
      root,
      "stop",
      {
        conversation_id: cid,
        status: "aborted",
        loop_count: 0,
      },
      "cursor",
    );
    expect(r.status).toBe(0);
    expect(r.out).toEqual({});
  });

  it("malformed --platform without value does not swallow --event Stop", () => {
    root = tmpProject();
    installDualHost(root);
    const cp = seedChecklist(root);
    const cid = "dual-plat-aaaa-bbbb-cccc-ddddeeee0013";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.close();

    const proc = spawnSync(
      process.execPath,
      [hookPath(root), "--platform", "--event", "Stop"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          session_id: cid,
          status: "aborted",
          hook_event_name: "stop",
          loop_count: 0,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(proc.status).toBe(0);
    expect(JSON.parse(proc.stdout.trim() || "{}")).toEqual({});
  });

  it("Stop cross-fire: --event Stop + Cursor aborted → {} (no recover)", () => {
    root = tmpProject();
    installDualHost(root);
    const cp = seedChecklist(root);
    const cid = "dual-abort-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.updateReviewChain(cid, {
      pending_followup: "恢复：上一回合出错。继续当前规划。",
    });
    store.close();

    const r = runHook(root, "Stop", {
      conversation_id: cid,
      session_id: cid,
      status: "aborted",
      hook_event_name: "stop",
      loop_count: 0,
    });
    expect(r.status).toBe(0);
    expect(r.out).toEqual({});
    expect(r.out.decision).toBeUndefined();
    expect(r.out.reason).toBeUndefined();
    expect(r.out.followup_message).toBeUndefined();

    const verify = new StateStore(root);
    expect(verify.getSession(cid)?.error_count ?? 0).toBe(0);
    verify.close();
  });

  it("Cursor native stop aborted → halt {}", () => {
    root = tmpProject();
    installDualHost(root);
    const cp = seedChecklist(root);
    const cid = "dual-cstop-aaaa-bbbb-cccc-ddddeeee0002";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.close();

    const r = runHook(root, "stop", {
      conversation_id: cid,
      status: "aborted",
      loop_count: 0,
    });
    expect(r.status).toBe(0);
    expect(r.out).toEqual({});
    expect(r.out.followup_message).toBeUndefined();
  });

  it("Claude real Stop armed → decision:block + reason (not Cursor shape)", () => {
    root = tmpProject();
    installDualHost(root);
    const cp = seedChecklist(root);
    const cid = "dual-cstop-aaaa-bbbb-cccc-ddddeeee0003";
    const editPath = path.join(root, "src", "app.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export {}\n");

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "claude-code",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.close();

    expect(
      runHook(root, "PostToolUse", {
        session_id: cid,
        tool_name: "Edit",
        tool_input: { file_path: editPath },
      }).status,
    ).toBe(0);

    const r = runHook(root, "Stop", {
      session_id: cid,
      stop_hook_active: false,
    });
    expect(r.status).toBe(0);
    expect(r.out.decision).toBe("block");
    expect(typeof r.out.reason).toBe("string");
    expect(String(r.out.reason).length).toBeGreaterThan(0);
    expect(r.out.followup_message).toBeUndefined();
    expect(r.out.loop).toBeUndefined();
  });

  it("Submit fail-open shapes never swapped", () => {
    root = tmpProject();
    installDualHost(root);
    const cid = "dual-sub-aaaa-bbbb-cccc-ddddeeee0004";

    const cursor = runHook(root, "beforeSubmitPrompt", {
      conversation_id: cid,
      prompt: "hello cursor",
    });
    expect(cursor.status).toBe(0);
    expect(cursor.out.continue).toBe(true);
    expect(cursor.out.decision).toBeUndefined();

    const claude = runHook(root, "UserPromptSubmit", {
      session_id: cid + "c",
      prompt: "hello claude",
    });
    expect(claude.status).toBe(0);
    // Claude allow = {} — must not emit Cursor continue
    expect(claude.out.continue).toBeUndefined();
    expect(claude.out.decision).toBeUndefined();
  });

  it("Edit arming: afterFileEdit vs PostToolUse; wrong argv must not wipe platform", () => {
    root = tmpProject();
    installDualHost(root);
    const cp = seedChecklist(root);
    const editPath = path.join(root, "src", "svc.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export const x = 1\n");

    const cursorCid = "dual-edit-aaaa-bbbb-cccc-ddddeeee0005";
    const claudeCid = "dual-edit-aaaa-bbbb-cccc-ddddeeee0006";

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cursorCid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.upsertSession({
      conversation_id: claudeCid,
      project_root: root,
      code_root: root,
      platform: "claude-code",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.close();

    expect(
      runHook(root, "afterFileEdit", {
        conversation_id: cursorCid,
        file_path: editPath,
      }).status,
    ).toBe(0);
    expect(
      runHook(root, "PostToolUse", {
        session_id: claudeCid,
        tool_name: "Write",
        tool_input: { file_path: editPath },
      }).status,
    ).toBe(0);

    // Cross-fire: Claude argv + Cursor edit payload — must not crash / wipe hosts
    const xf = runHook(root, "PostToolUse", {
      conversation_id: cursorCid,
      file_path: editPath,
    });
    expect(xf.status).toBe(0);
    expect(xf.out).toEqual({});

    const verify = new StateStore(root);
    expect(verify.getSession(cursorCid)?.platform).toBe("cursor");
    expect(verify.getSession(claudeCid)?.platform).toBe("claude-code");
    expect(verify.getReviewChain(cursorCid)?.code_edited).toBe(1);
    expect(verify.getReviewChain(claudeCid)?.code_edited).toBe(1);
    verify.close();
  });

  it("Vendor dispatch exports distinct Claude vs Cursor stop handlers", () => {
    root = tmpProject();
    installDualHost(root);
    const vendor = path.join(
      root,
      ".autopilot",
      "bin",
      "vendor",
      "runtime.mjs",
    );
    const hookSrc = fs.readFileSync(hookPath(root), "utf8");
    const src = fs.readFileSync(vendor, "utf8");
    expect(src).toMatch(/handleClaudeStop/);
    expect(src).toMatch(/handleCursorStop/);
    // Bundled Claude abort normalizer present
    expect(src).toMatch(/normalizeClaudeStopStatus|statusRaw === \"aborted\"/);
    // Cursor stop must not fall through to Claude-only handleStop
    expect(hookSrc).toMatch(/handleBeforeSubmitPrompt === \"function\"/);
    expect(hookSrc).toMatch(
      /Never fall through to Claude-only package handleStop/,
    );
  });

  it("CLI lifecycle: add-platform / upgrade keep Cursor Autopilot hooks", () => {
    root = tmpProject();
    installDualHost(root);

    const hooksBefore = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as {
      hooks: { beforeSubmitPrompt?: { command: string }[]; stop?: unknown[] };
    };
    expect(
      hooksBefore.hooks.beforeSubmitPrompt?.some((h) =>
        h.command.includes("autopilot-harness"),
      ),
    ).toBe(true);

    const up = upgradeProject({ projectRoot: root });
    expect(up.ok).toBe(true);

    const hooksAfter = JSON.parse(
      fs.readFileSync(path.join(root, ".cursor", "hooks.json"), "utf8"),
    ) as {
      hooks: { beforeSubmitPrompt?: { command: string }[] };
    };
    expect(
      hooksAfter.hooks.beforeSubmitPrompt?.some((h) =>
        h.command.includes("autopilot-harness") &&
        h.command.includes("--platform cursor"),
      ),
    ).toBe(true);

    const settings = JSON.parse(
      fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
    ) as { env?: { CLAUDE_CODE_STOP_HOOK_BLOCK_CAP?: string } };
    expect(settings.env?.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP).toBe("0");

    // Uninstall Claude-only path is covered elsewhere; here assert Cursor still
    // present after dual install (uninstall all would remove both — skip wipe).
    expect(fs.existsSync(path.join(root, ".cursor", "hooks.json"))).toBe(true);
  });

  it("sessions.platform: Claude stamp stays; Cursor ambient revive does not wipe", () => {
    root = tmpProject();
    installDualHost(root);
    const cp = seedChecklist(root);

    const cid = "dual-plat-aaaa-bbbb-cccc-ddddeeee0007";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "claude-code",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    // Cursor path omits platform — must keep claude-code
    expect(ensureAmbientReviewSession(store, cid, root, "project")).toBe(true);
    expect(store.getSession(cid)?.platform).toBe("claude-code");
    store.close();
  });

  it("status+session_id without hook name stays Claude; conversation_id → Cursor", () => {
    root = tmpProject();
    installDualHost(root);
    const cp = seedChecklist(root);
    const editPath = path.join(root, "src", "disambig.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export {}\n");

    const claudeCid = "dual-dis-aaaa-bbbb-cccc-ddddeeee0009";
    const cursorCid = "dual-dis-aaaa-bbbb-cccc-ddddeeee0010";

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: claudeCid,
      project_root: root,
      code_root: root,
      platform: "claude-code",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.upsertSession({
      conversation_id: cursorCid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.close();

    expect(
      runHook(root, "PostToolUse", {
        session_id: claudeCid,
        tool_name: "Edit",
        tool_input: { file_path: editPath },
      }).status,
    ).toBe(0);

    // Claude-shaped: status completed + session_id only → decision:block
    const claude = runHook(root, "Stop", {
      session_id: claudeCid,
      status: "completed",
      stop_hook_active: false,
    });
    expect(claude.status).toBe(0);
    expect(claude.out.decision).toBe("block");
    expect(claude.out.followup_message).toBeUndefined();

    // Both ids + stop_hook_active → still Claude (not Cursor via conversation_id)
    const both = runHook(root, "Stop", {
      session_id: claudeCid,
      conversation_id: claudeCid,
      status: "completed",
      stop_hook_active: false,
    });
    expect(both.status).toBe(0);
    expect(both.out.decision).toBe("block");
    expect(both.out.followup_message).toBeUndefined();

    // Cursor-shaped: status aborted + conversation_id, no hook name → halt
    const cursor = runHook(root, "Stop", {
      conversation_id: cursorCid,
      status: "aborted",
      loop_count: 0,
    });
    expect(cursor.status).toBe(0);
    expect(cursor.out).toEqual({});
  });

  it("Claude Stop with status+hook_event_name Stop stays on Claude path", () => {
    root = tmpProject();
    installDualHost(root);
    const cp = seedChecklist(root);
    const cid = "dual-claude-aaaa-bbbb-cccc-ddddeeee0008";
    const editPath = path.join(root, "src", "keep.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export {}\n");

    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "claude-code",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.close();

    expect(
      runHook(root, "PostToolUse", {
        session_id: cid,
        tool_name: "Edit",
        tool_input: { file_path: editPath },
      }).status,
    ).toBe(0);

    // If status alone routed to Cursor, we'd lose decision:block.
    const r = runHook(root, "Stop", {
      session_id: cid,
      status: "completed",
      hook_event_name: "Stop",
      stop_hook_active: false,
    });
    expect(r.status).toBe(0);
    expect(r.out.decision).toBe("block");
    expect(typeof r.out.reason).toBe("string");
    expect(r.out.followup_message).toBeUndefined();
  });

  it("uninstall dual-host strips Autopilot Cursor hooks", () => {
    root = tmpProject();
    installDualHost(root);
    const result = uninstallProject({ projectRoot: root });
    expect(result.ok).toBe(true);
    const hooksPath = path.join(root, ".cursor", "hooks.json");
    if (fs.existsSync(hooksPath)) {
      const hooks = JSON.parse(fs.readFileSync(hooksPath, "utf8")) as {
        hooks?: { beforeSubmitPrompt?: { command: string }[] };
      };
      const left =
        hooks.hooks?.beforeSubmitPrompt?.filter((h) =>
          h.command.includes("autopilot-harness"),
        ) ?? [];
      expect(left).toEqual([]);
    }
  });
});
