import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import { installInitYes } from "../src/init/install.js";
import { runDoctor } from "../src/status-doctor.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-hook-vendor-"));
}

describe("hook vendor runtime", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("init copies vendor and hook runs without project node_modules", () => {
    root = tmpProject();
    const result = installInitYes({
      projectRoot: root,
      platform: "cursor",
      surface: "ide",
      locale: "en",
      force: false,
    });
    expect(result.ok).toBe(true);

    const vendor = path.join(
      root,
      ".autopilot",
      "bin",
      "vendor",
      "runtime.mjs",
    );
    const mig = path.join(
      root,
      ".autopilot",
      "bin",
      "vendor",
      "migrations",
      "001_initial.sql",
    );
    expect(fs.existsSync(vendor)).toBe(true);
    expect(fs.existsSync(mig)).toBe(true);
    // Empty consumer project: no node_modules with @autopilot-harness/*
    expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);

    const doctor = runDoctor(root);
    expect(doctor.lines.join("\n")).toMatch(/OK\s+hook vendor runtime/);

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const cid = "hook-vend-aaaa-bbbb-cccc-ddddeeee0001";
    const proc = spawnSync(
      process.execPath,
      [hook, "--event", "beforeSubmitPrompt"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          prompt: "hello from smoke",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(proc.status).toBe(0);
    const out = JSON.parse(proc.stdout.trim() || "{}") as {
      continue?: boolean;
    };
    expect(out.continue).toBe(true);
    // Vendor path opened state.db (fail-open would not create it).
    expect(fs.existsSync(path.join(root, ".autopilot", "state.db"))).toBe(true);
  });

  it("Claude UserPromptSubmit / Stop dispatch via same vendor (no Cursor regression)", () => {
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

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const cid = "hook-claude-aaaa-bbbb-cccc-ddddeeee0099";

    const submit = spawnSync(
      process.execPath,
      [hook, "--event", "UserPromptSubmit"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          prompt: "hello claude submit",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(submit.status).toBe(0);
    const submitOut = JSON.parse(submit.stdout.trim() || "{}") as {
      continue?: boolean;
      decision?: string;
    };
    // Claude fail-open / allow = {} (not Cursor { continue: true })
    expect(submitOut.continue).toBeUndefined();
    expect(submitOut.decision).toBeUndefined();

    const editPath = path.join(root, "src", "app.ts");
    fs.mkdirSync(path.dirname(editPath), { recursive: true });
    fs.writeFileSync(editPath, "export {}\n");
    fs.mkdirSync(path.join(root, "plans", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "plans", "demo", "checklist.md"),
      "- [ ] a — A\n- [ ] b — B\n",
    );

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
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    store.close();

    const postEdit = spawnSync(
      process.execPath,
      [hook, "--event", "PostToolUse"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: cid,
          tool_name: "Edit",
          tool_input: { file_path: editPath },
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(postEdit.status).toBe(0);
    expect(JSON.parse(postEdit.stdout.trim() || "{}")).toEqual({});

    const verify = new StateStore(root);
    expect(verify.getReviewChain(cid)?.code_edited).toBe(1);
    verify.close();

    const stop = spawnSync(process.execPath, [hook, "--event", "Stop"], {
      cwd: root,
      input: JSON.stringify({
        session_id: cid,
        stop_hook_active: false,
      }),
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(stop.status).toBe(0);
    const stopOut = JSON.parse(stop.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      followup_message?: string;
      loop?: boolean;
    };
    expect(stopOut.decision).toBe("block");
    expect(stopOut.reason).toBeTruthy();
    // Must not emit Cursor-shaped stop stdout
    expect(stopOut.followup_message).toBeUndefined();
    expect(stopOut.loop).toBeUndefined();

    // Cursor IDE may cross-fire --event Stop with aborted status; must halt.
    const abortCid = "hook-claude-aaaa-bbbb-cccc-ddddeeee0097";
    const storeAbort = new StateStore(root);
    storeAbort.upsertSession({
      conversation_id: abortCid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    storeAbort.close();
    const abortStop = spawnSync(process.execPath, [hook, "--event", "Stop"], {
      cwd: root,
      input: JSON.stringify({
        conversation_id: abortCid,
        session_id: abortCid,
        status: "aborted",
        hook_event_name: "stop",
        loop_count: 0,
      }),
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(abortStop.status).toBe(0);
    expect(JSON.parse(abortStop.stdout.trim() || "{}")).toEqual({});
    const abortVerify = new StateStore(root);
    expect(abortVerify.getSession(abortCid)?.error_count ?? 0).toBe(0);
    abortVerify.close();

    const failCid = "hook-claude-aaaa-bbbb-cccc-ddddeeee0098";
    const store2 = new StateStore(root);
    store2.upsertSession({
      conversation_id: failCid,
      project_root: root,
      code_root: root,
      platform: "claude-code",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    store2.close();

    const stopFail = spawnSync(
      process.execPath,
      [hook, "--event", "StopFailure"],
      {
        cwd: root,
        input: JSON.stringify({
          session_id: failCid,
          stop_hook_active: false,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(stopFail.status).toBe(0);
    const failOut = JSON.parse(stopFail.stdout.trim() || "{}") as {
      decision?: string;
      reason?: string;
      followup_message?: string;
      loop?: boolean;
    };
    // StopFailure → Claude-shaped recover (not Cursor followup_message)
    expect(failOut.followup_message).toBeUndefined();
    expect(failOut.loop).toBeUndefined();
    expect(failOut.decision).toBe("block");
    expect(failOut.reason).toMatch(/Recover|恢复/i);
  });

  it("stop hook reads confirm_rounds + locale from config.yml", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "zh-CN",
        force: false,
      }).ok,
    ).toBe(true);

    const configPath = path.join(root, ".autopilot", "config.yml");
    let config = fs.readFileSync(configPath, "utf8");
    config = config.replace(/confirm_rounds:\s*\d+/, "confirm_rounds: 3");
    fs.writeFileSync(configPath, config);

    const cid = "hook-cfg-aaaa-bbbb-cccc-ddddeeee0002";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    store.updateReviewChain(cid, {
      chain_pending: 1,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      fix_round: 0,
    });
    store.close();

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const proc = spawnSync(
      process.execPath,
      [hook, "--event", "stop"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          status: "completed",
          loop_count: 1,
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(proc.status).toBe(0);
    const out = JSON.parse(proc.stdout.trim() || "{}") as {
      followup_message?: string;
      loop?: boolean;
    };
    expect(out.loop).toBe(true);
    expect(out.followup_message).toBeTruthy();
    expect(out.followup_message).toMatch(/1\/3/);
    expect(out.followup_message).toMatch(/自审确认|正确性与不变量/);
  });

  it("beforeSubmitPrompt ordinary chat keeps pending_followup (E8 vendor)", () => {
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

    const cid = "hook-e8-aaaa-bbbb-cccc-ddddeeee0003";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "demo",
      checklist_path: path.join(root, "plans", "demo", "checklist.md"),
    });
    store.updateReviewChain(cid, {
      chain_pending: 1,
      confirm_left: 2,
      pending_followup: "Review confirm 3/5 undelivered vendor-e8",
      pending_followup_at: new Date().toISOString(),
    });
    store.close();

    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    const proc = spawnSync(
      process.execPath,
      [hook, "--event", "beforeSubmitPrompt"],
      {
        cwd: root,
        input: JSON.stringify({
          conversation_id: cid,
          prompt: "hello ordinary chat",
        }),
        encoding: "utf8",
        timeout: 15_000,
      },
    );
    expect(proc.status).toBe(0);

    const store2 = new StateStore(root);
    const chain = store2.getReviewChain(cid)!;
    expect(chain.chain_pending).toBe(0);
    expect(chain.pending_followup).toBe(
      "Review confirm 3/5 undelivered vendor-e8",
    );
    expect(chain.confirm_left).toBe(2);
    store2.close();
  });

  it("shipped vendor savePendingFollowup rejects NUL pending", () => {
    const runtime = path.join(
      process.cwd(),
      "packages/cli/assets/vendor/runtime.mjs",
    );
    const src = fs.readFileSync(runtime, "utf8");
    expect(src).toMatch(/msg\.includes\("\\0"\)/);
    expect(src).toMatch(/pending_followup\.includes\("\\0"\)/);
    // ensureReviewChain must re-read chain after session check (not stale pre-check row).
    expect(src).toMatch(
      /NOT EXISTS \(SELECT 1 FROM sessions WHERE conversation_id = \?\)[\s\S]*?let ensured = this\.getReviewChain\(conversationId\)/,
    );
    expect(src).toMatch(
      /upsertSession\(partial\) \{\s*if \(this\.isInvalidConversationId\(partial\.conversation_id\)\)/,
    );
    expect(src).toMatch(/isConversationIdOk\(input\.conversationId\)/);
    expect(src).toMatch(/msg\.includes\("No session for conversation"\)/);
    expect(src).toMatch(/msg\.includes\("Invalid conversation id"\)/);
    expect(src).toMatch(/afterFollowupCommitted/);
    // handleErrorStop: pause-threshold upsert failure → column pause + neutralize.
    expect(src).toMatch(/pauseSessionForRepeatedErrors\(/);
    expect(src).toMatch(/neutralizeReviewChain\(session\.conversation_id\)/);
    expect(src).toMatch(/disarmSession\(session\.conversation_id\)/);
    // Halt package: atomic exclusiveWrite first; per-step try only in catch fallback.
    expect(src).toMatch(
      /exclusiveWrite\(\(\) => \{\s*this\.store\.pauseSessionForRepeatedErrors/,
    );
    expect(src).toMatch(
      /paused_reason = COALESCE\(paused_reason, 'repeated_errors'\)/,
    );
    expect(src).toMatch(
      /pending_redeliver_at = \?,[\s\S]*?chain_pending = CASE[\s\S]*?ELSE 1[\s\S]*?AND pending_followup IS NOT NULL[\s\S]*?AND trim\(pending_followup\) != ''/,
    );
    expect(src).toMatch(
      /kind: "stuck",\s*message: this\.render\("stuck", \{\}\),\s*loop: false/,
    );
    expect(src).toMatch(
      /if \(!action\.loop\) \{\s*return \{ followup_message: action\.message \};/,
    );
  });

  it("doctor FAILs when vendor runtime is missing", () => {
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
    fs.rmSync(path.join(root, ".autopilot", "bin", "vendor"), {
      recursive: true,
      force: true,
    });
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/hook vendor runtime missing/i);
  });

  it("doctor FAILs when vendor runtime is a symlink", () => {
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
    const vendor = path.join(
      root,
      ".autopilot",
      "bin",
      "vendor",
      "runtime.mjs",
    );
    const outside = path.join(root, "outside-runtime.mjs");
    fs.renameSync(vendor, outside);
    fs.symlinkSync(outside, vendor);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/symlink|hook vendor/i);
  });

  it("doctor FAILs when hook binary is a dangling symlink (not treated as missing)", () => {
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
    const hook = path.join(
      root,
      ".autopilot",
      "bin",
      "autopilot-harness-hook.mjs",
    );
    fs.rmSync(hook, { force: true });
    fs.symlinkSync(path.join(root, "missing-hook.mjs"), hook);
    const { ok, lines } = runDoctor(root);
    expect(ok).toBe(false);
    expect(lines.join("\n")).toMatch(/symlink|hook binary/i);
    expect(lines.join("\n")).not.toMatch(/hook binary missing/i);
  });

  it("init --force refuses when .autopilot/bin is a symlink", () => {
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
    const bin = path.join(root, ".autopilot", "bin");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-evil-bin-"));
    try {
      const outsideBin = path.join(outside, "bin");
      fs.renameSync(bin, outsideBin);
      fs.symlinkSync(outsideBin, bin);
      const result = installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: true,
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).toMatch(/symlink|realpath/i);
      const doctor = runDoctor(root);
      expect(doctor.ok).toBe(false);
      expect(doctor.lines.join("\n")).toMatch(/hook bin|symlink|realpath/i);
      expect(doctor.lines.join("\n")).not.toMatch(
        /OK\s+autopilot-harness-hook\.mjs/,
      );
      expect(doctor.lines.join("\n")).not.toMatch(/OK\s+hook vendor runtime/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
