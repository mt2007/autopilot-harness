import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  blockSubmit,
  buildNeedPickContext,
  FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE,
  FACTORY_DROID_DEGRADED_STOP_CONTINUE_CAP,
  FACTORY_DROID_ENV_CWD,
  FACTORY_DROID_ENV_PROJECT_DIR,
  FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN,
  FACTORY_DROID_STOP_CAP_RAISE_FOUND,
  FACTORY_PLATFORM,
  FACTORY_POST_TOOL_USE_MATCHER,
  filePathsFromFactoryEdit,
  handleFactoryPostToolUse,
  handleFactoryStop,
  handleFactoryUserPromptSubmit,
  handlePostToolUse,
  handleStop,
  handleUserPromptSubmit,
  injectNeedPickContext,
  isFactoryEditTool,
  isFactoryStopCompletionReason,
  isFactoryEmptyStdout,
  isFactoryUpsAllow,
  loopCountFromStopHookActive,
  MAX_NEED_PICK_SLUGS,
  MAX_APPLY_PATCH_PATHS,
  normalizeFactoryStopStatus,
  pathsFromApplyPatchCommand,
  resolveFactoryWorkspaceRoot,
  shouldYieldFactoryStopWhenActive,
  isFactoryStopHookActive,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-factory-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("port-factory-droid adapters", () => {
  it("documents Stop-cap constants; matcher; helpers; aliases", () => {
    expect(FACTORY_DROID_STOP_CAP_RAISE_FOUND).toBe(false);
    expect(FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN).toBe(false);
    expect(FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE).toBe(true);
    expect(FACTORY_DROID_DEGRADED_STOP_CONTINUE_CAP).toBe(1);
    expect(FACTORY_POST_TOOL_USE_MATCHER).toBe("Create|Edit|ApplyPatch");
    expect(FACTORY_PLATFORM).toBe("factory-droid");
    expect(FACTORY_DROID_ENV_PROJECT_DIR).toBe("FACTORY_PROJECT_DIR");
    expect(FACTORY_DROID_ENV_CWD).toBe("DROID_CWD");
    expect(loopCountFromStopHookActive({ stopHookActive: true })).toBe(1);
    expect(loopCountFromStopHookActive({ stop_hook_active: false })).toBe(0);
    expect(isFactoryEditTool("Create")).toBe(true);
    expect(isFactoryEditTool("Edit")).toBe(true);
    expect(isFactoryEditTool("ApplyPatch")).toBe(true);
    expect(isFactoryEditTool("apply_patch")).toBe(true);
    expect(isFactoryEditTool("Execute")).toBe(false);
    expect(handleFactoryUserPromptSubmit).toBe(handleUserPromptSubmit);
    expect(handleFactoryPostToolUse).toBe(handlePostToolUse);
    expect(handleFactoryStop).toBe(handleStop);
    expect(
      filePathsFromFactoryEdit({
        toolName: "Edit",
        toolInput: { file_path: "src/a.ts" },
      }),
    ).toEqual(["src/a.ts"]);
    expect(
      filePathsFromFactoryEdit({
        toolName: "Create",
        toolInput: JSON.stringify({ path: "src/b.ts" }),
      }),
    ).toEqual(["src/b.ts"]);
    expect(
      filePathsFromFactoryEdit({
        toolName: "Edit",
        toolInput: { path: "src/a\0.ts" },
      }),
    ).toEqual([]);
    expect(
      pathsFromApplyPatchCommand(
        "*** Update File: src/patched.ts\n@@\n-a\n+b\n",
      ),
    ).toEqual(["src/patched.ts"]);
    expect(
      filePathsFromFactoryEdit({
        toolName: "ApplyPatch",
        toolInput: {
          command: "*** Add File: src/new.ts\n@@\n+x\n",
        },
      }),
    ).toEqual(["src/new.ts"]);
    expect(
      filePathsFromFactoryEdit({
        toolName: "ApplyPatch",
        toolInput: {
          patch: "*** Update File: src/via-patch.ts\n@@\n-a\n+b\n",
        },
      }),
    ).toEqual(["src/via-patch.ts"]);
    expect(
      filePathsFromFactoryEdit({
        toolName: "ApplyPatch",
        toolInput: "*** Update File: bad\0path.ts\n",
      }),
    ).toEqual([]);
    const manyPatch = Array.from(
      { length: MAX_APPLY_PATCH_PATHS + 5 },
      (_, i) => `*** Update File: f${i}.ts`,
    ).join("\n");
    expect(pathsFromApplyPatchCommand(manyPatch).length).toBe(
      MAX_APPLY_PATCH_PATHS,
    );
    expect(
      isFactoryStopHookActive({
        stop_hook_active: false,
        stopHookActive: true,
      }),
    ).toBe(true);
    expect(loopCountFromStopHookActive({ stopHookActive: true })).toBe(1);
    expect(
      loopCountFromStopHookActive({
        stop_hook_active: false,
        stopHookActive: true,
      }),
    ).toBe(1);
    expect(shouldYieldFactoryStopWhenActive({ stopHookActive: true })).toBe(
      false,
    );
    expect(
      shouldYieldFactoryStopWhenActive({ stop_hook_active: true }, false),
    ).toBe(true);
    expect(
      shouldYieldFactoryStopWhenActive(
        { stop_hook_active: false, stopHookActive: true },
        false,
      ),
    ).toBe(true);
    expect(
      shouldYieldFactoryStopWhenActive({ stop_hook_active: false }, false),
    ).toBe(false);
    expect(normalizeFactoryStopStatus({ status: "aborted" })).toBe("aborted");
    expect(isFactoryStopCompletionReason({ reason: "end_turn" })).toBe(true);
    expect(isFactoryStopCompletionReason({ reason: "channel_closed" })).toBe(
      false,
    );
    expect(isFactoryStopCompletionReason({})).toBe(true);
  });

  it("resolveFactoryWorkspaceRoot prefers installRoot then env then stdin", () => {
    expect(
      resolveFactoryWorkspaceRoot({
        installRoot: "/inst",
        env: {
          [FACTORY_DROID_ENV_PROJECT_DIR]: "/proj",
          [FACTORY_DROID_ENV_CWD]: "/dcwd",
        },
        stdinCwd: "/stdin",
      }),
    ).toBe("/inst");
    expect(
      resolveFactoryWorkspaceRoot({
        env: { [FACTORY_DROID_ENV_PROJECT_DIR]: "/proj" },
        stdinCwd: "/stdin",
      }),
    ).toBe("/proj");
    expect(
      resolveFactoryWorkspaceRoot({
        env: { [FACTORY_DROID_ENV_CWD]: "/dcwd" },
        stdinCwd: "/stdin",
      }),
    ).toBe("/dcwd");
    expect(resolveFactoryWorkspaceRoot({ stdinCwd: "/stdin" })).toBe("/stdin");
    expect(resolveFactoryWorkspaceRoot({})).toBeNull();
    expect(
      resolveFactoryWorkspaceRoot({
        env: { [FACTORY_DROID_ENV_PROJECT_DIR]: "/bad\0root" },
        stdinCwd: "/stdin",
      }),
    ).toBe("/stdin");
    expect(
      resolveFactoryWorkspaceRoot({
        env: { [FACTORY_DROID_ENV_PROJECT_DIR]: "/bad\nroot" },
        stdinCwd: "/stdin",
      }),
    ).toBe("/stdin");
  });

  it("needPick prefer inject; block fallback; allow is empty fields", () => {
    const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 10 }, (_, i) => ({
      slug: `plan-${i}`,
    }));
    const ctx = buildNeedPickContext("", many);
    expect(ctx).toMatch(/Select a plan/);
    expect((ctx.match(/plan-\d+/g) ?? []).length).toBe(MAX_NEED_PICK_SLUGS);

    const injected = injectNeedPickContext(ctx, many);
    expect(injected.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(injected.hookSpecificOutput?.additionalContext).toMatch(/Select/);
    expect(injected.decision).toBeUndefined();
    expect(isFactoryUpsAllow(injected)).toBe(false);

    const blocked = blockSubmit(ctx, "fallback");
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toMatch(/Select a plan/);
    expect(isFactoryUpsAllow(blocked)).toBe(false);

    expect(isFactoryUpsAllow({})).toBe(true);
    expect(isFactoryEmptyStdout({})).toBe(true);
    expect(isFactoryUpsAllow({ reason: "orphan" })).toBe(false);
    expect(isFactoryUpsAllow({ reason: "   " })).toBe(false);
    expect(
      isFactoryEmptyStdout({
        continue: false,
        stopReason: "Stuck: x",
      }),
    ).toBe(false);
    expect(isFactoryEmptyStdout(null)).toBe(false);
    expect(isFactoryUpsAllow).toBe(isFactoryEmptyStdout);
  });

  it("UPS ON empty allow; RUN needPick returns inject", () => {
    const root = tmpRoot();
    writeChecklist(root, "alpha", "# Checklist\n\n- [ ] item-a — A\n");
    writeChecklist(root, "beta", "# Checklist\n\n- [ ] item-b — B\n");
    const store = new StateStore(root);
    const cid = "sess-run";

    const on = handleUserPromptSubmit(
      store,
      { session_id: cid, prompt: "Autopilot ON" },
      root,
    );
    expect(isFactoryUpsAllow(on)).toBe(true);
    expect(store.getSession(cid)?.phase).toBe("planning");
    expect(store.getSession(cid)?.platform).toBe(FACTORY_PLATFORM);

    const run = handleUserPromptSubmit(
      store,
      { session_id: cid, prompt: "Autopilot RUN" },
      root,
    );
    expect(run.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(run.hookSpecificOutput?.additionalContext).toMatch(/alpha|beta/);
    expect(run.decision).toBeUndefined();

    store.close();
  });

  it("harness followup UPS does not clear chain_pending", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cid = "sess-follow";
    const cp = writeChecklist(root, "trk", "- [ ] x — X\n");
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      phase: "executing",
      track_id: "trk",
      checklist_path: cp,
      platform: FACTORY_PLATFORM,
    });
    store.updateReviewChain(cid, {
      chain_pending: 1,
      pending_followup: "Review fix round 1",
    });
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);

    const out = handleUserPromptSubmit(
      store,
      {
        sessionId: cid,
        prompt: "Review fix round 1 — keep going",
      },
      root,
    );
    expect(isFactoryUpsAllow(out)).toBe(true);
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);

    // zh Stop→UPS followup must also stay harness-owned.
    store.updateReviewChain(cid, {
      chain_pending: 1,
      pending_followup: "自审修复第 1 轮",
    });
    handleUserPromptSubmit(
      store,
      {
        sessionId: cid,
        prompt: "自审修复第 1 轮（无硬顶；确认阶段需连续 5 轮无改动）。",
      },
      root,
    );
    expect(store.getReviewChain(cid)?.chain_pending).toBe(1);

    handleUserPromptSubmit(
      store,
      { sessionId: cid, prompt: "hello ordinary chat" },
      root,
    );
    expect(store.getReviewChain(cid)?.chain_pending ?? 0).toBe(0);
    store.close();
  });

  it("PostToolUse arms Edit; never returns decision", () => {
    const root = tmpRoot();
    const cp = writeChecklist(
      root,
      "demo",
      "# Checklist\n\n- [ ] a — A\n- [ ] b — B\n",
    );
    const store = new StateStore(root);
    const cid = "sess-edit";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: FACTORY_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
    });

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const file = path.join(root, "src", "x.ts");
    fs.writeFileSync(file, "export const x = 1;\n");

    handlePostToolUse(
      store,
      {
        sessionId: cid,
        toolName: "Edit",
        toolInput: { file_path: file },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited).toBe(1);

    // plans/** is .autopilotignore — must not arm code_edited.
    store.updateReviewChain(cid, { code_edited: 0 });
    handlePostToolUse(
      store,
      {
        sessionId: cid,
        toolName: "Edit",
        toolInput: { file_path: path.join(root, "plans", "demo", "plan.md") },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited ?? 0).toBe(0);
    store.close();
  });

  it("empty session_id is a no-op", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const eng = new ReviewEngine(store, {
      confirmRounds: 5,
      reviewScope: "executing_only",
      verifyEnabled: false,
      verifyCommands: [],
      maxIdleStops: 5,
      maxErrorsBeforePause: 0,
      projectRoot: root,
      recoverDebounceMs: 0,
    });
    expect(handleStop(eng, { session_id: "", reason: "end_turn" })).toEqual(
      {},
    );
    expect(
      handleUserPromptSubmit(store, { session_id: "", prompt: "x" }, root),
    ).toEqual({});
    expect(isFactoryUpsAllow({})).toBe(true);
    store.close();
  });

  it("PostToolUse arms ApplyPatch paths", () => {
    const root = tmpRoot();
    const cp = writeChecklist(
      root,
      "demo-ap",
      "# Checklist\n\n- [ ] a — A\n",
    );
    const store = new StateStore(root);
    const cid = "sess-apply-patch";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: FACTORY_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo-ap",
    });

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const file = path.join(root, "src", "patched.ts");
    fs.writeFileSync(file, "export const p = 1;\n");

    handlePostToolUse(
      store,
      {
        sessionId: cid,
        toolName: "ApplyPatch",
        toolInput: {
          command: `*** Update File: ${file}\n@@\n-a\n+b\n`,
        },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited).toBe(1);
    store.close();
  });

  it("Stop returns decision:block + reason when review armed", () => {
    const root = tmpRoot();
    const cp = writeChecklist(
      root,
      "demo",
      "# Checklist\n\n- [ ] a — A\n- [ ] b — B\n",
    );
    const store = new StateStore(root);
    const cid = "sess-stop";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: FACTORY_PLATFORM,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
    });

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const file = path.join(root, "src", "y.ts");
    fs.writeFileSync(file, "export const y = 1;\n");

    handlePostToolUse(
      store,
      {
        sessionId: cid,
        toolName: "Create",
        toolInput: { file_path: file },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited).toBe(1);

    store.updateReviewChain(cid, { code_edited: 1 });
    const engine = new ReviewEngine(store, { projectRoot: root });
    const cont = handleStop(engine, {
      sessionId: cid,
      stop_hook_active: false,
      reason: "end_turn",
    });
    expect(cont.decision).toBe("block");
    expect(cont.reason).toBeTruthy();
    expect(cont).not.toHaveProperty("hookSpecificOutput");

    const again = handleStop(engine, {
      sessionId: cid,
      stop_hook_active: true,
      reason: "end_turn",
    });
    // Multi allowed by default — may still block while chain pending.
    expect(
      again.decision === "block" || Object.keys(again).length === 0,
    ).toBe(true);

    const skipped = handleStop(engine, {
      sessionId: cid,
      stop_hook_active: false,
      reason: "channel_closed",
    });
    expect(skipped).toEqual({});

    // loop:false hard-stop → continue:false + stopReason (not Silence {}).
    const haltMapped = (() => {
      const stub = {
        handleStop: () => ({
          kind: "stuck" as const,
          message: "Stuck: test halt",
          loop: false,
        }),
      } as unknown as ReviewEngine;
      return handleStop(stub, { sessionId: cid, reason: "end_turn" });
    })();
    expect(haltMapped.continue).toBe(false);
    expect(haltMapped.stopReason).toMatch(/Stuck/);
    expect(haltMapped.decision).toBeUndefined();
    expect(haltMapped).not.toEqual({});

    store.close();
  });
});
