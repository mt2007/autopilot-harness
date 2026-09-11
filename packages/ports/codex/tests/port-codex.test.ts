import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  allowNeedPickContext,
  CODEX_PLATFORM,
  filePathsFromCodexEdit,
  handlePostToolUse,
  handleStop,
  handleUserPromptSubmit,
  isCodexEditTool,
  loopCountFromStopHookActive,
  MAX_NEED_PICK_SLUGS,
  MAX_APPLY_PATCH_PATHS,
  normalizeCodexStopStatus,
  pathsFromApplyPatchCommand,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-codex-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("port-codex adapters", () => {
  it("maps stop_hook_active and edit helpers; parses apply_patch command", () => {
    expect(loopCountFromStopHookActive({ stop_hook_active: true })).toBe(1);
    expect(loopCountFromStopHookActive({ stopHookActive: false })).toBe(0);
    expect(isCodexEditTool("apply_patch")).toBe(true);
    expect(isCodexEditTool("Edit")).toBe(true);
    expect(isCodexEditTool("Write")).toBe(true);
    expect(isCodexEditTool("Bash")).toBe(false);

    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@",
      "-old",
      "+new",
      "*** Add File: lib/b.ts",
      "+x",
      "*** End Patch",
    ].join("\n");
    expect(pathsFromApplyPatchCommand(patch)).toEqual([
      "src/a.ts",
      "lib/b.ts",
    ]);
    expect(
      pathsFromApplyPatchCommand(
        "*** Rename File: old/a.ts -> new/b.ts\n",
      ),
    ).toEqual(["old/a.ts", "new/b.ts"]);
    expect(
      pathsFromApplyPatchCommand("*** Update File: bad\0path.ts\n"),
    ).toEqual([]);
    const manyHeaders = Array.from(
      { length: 300 },
      (_, i) => `*** Update File: f${i}.ts`,
    ).join("\n");
    expect(pathsFromApplyPatchCommand(manyHeaders).length).toBe(
      MAX_APPLY_PATCH_PATHS,
    );
    expect(
      filePathsFromCodexEdit({
        tool_name: "apply_patch",
        tool_input: { command: patch },
      }),
    ).toEqual(["src/a.ts", "lib/b.ts"]);
    expect(
      filePathsFromCodexEdit({
        tool_name: "apply_patch",
        tool_input: patch,
      }),
    ).toEqual(["src/a.ts", "lib/b.ts"]);
    expect(
      filePathsFromCodexEdit({
        tool_name: "Write",
        tool_input: { file_path: "src/w.ts" },
      }),
    ).toEqual(["src/w.ts"]);
    // Write with a bare string must not be treated as apply_patch command.
    expect(
      filePathsFromCodexEdit({
        tool_name: "Write",
        tool_input: "*** Update File: nope.ts\n",
      }),
    ).toEqual([]);
    expect(
      filePathsFromCodexEdit({
        tool_name: "apply_patch",
        tool_input: { command: "" },
      }),
    ).toEqual([]);
    expect(normalizeCodexStopStatus({ status: "aborted" })).toBe("aborted");
    expect(
      normalizeCodexStopStatus(
        { error: "User aborted/interrupted manually." },
        { status: "error" },
      ),
    ).toBe("aborted");
  });

  it("needPick uses additionalContext only; caps slug list", () => {
    const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 10 }, (_, i) => ({
      slug: `plan-${i}`,
    }));
    const out = allowNeedPickContext("", many);
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    const ctx = out.hookSpecificOutput?.additionalContext ?? "";
    expect(ctx).toMatch(/Select a plan/);
    expect(ctx).toMatch(/plan-0/);
    expect(ctx).not.toMatch(
      new RegExp(`plan-${MAX_NEED_PICK_SLUGS}\\b`),
    );
  });

  it("ON stamps platform as codex; ignores permission_mode plan", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    expect(
      handleUserPromptSubmit(
        store,
        {
          session_id: "codex-s1",
          prompt: "/autopilot-on plat-tag",
          permission_mode: "plan",
        },
        root,
      ),
    ).toEqual({});
    expect(store.getSession("codex-s1")?.platform).toBe(CODEX_PLATFORM);
    expect(store.getSession("codex-s1")?.phase).toBe("planning");
    store.close();
  });

  it("fail-closes ON while executing; ignores hostile cwd", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "s1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
    });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-hostile-"));
    try {
      const blocked = handleUserPromptSubmit(
        store,
        {
          session_id: "s1",
          prompt: "/autopilot-on nope",
          cwd: outside,
        },
        root,
      );
      expect(blocked.decision).toBe("block");
      expect(store.getSession("s1")?.platform).toBe(CODEX_PLATFORM);
      expect(store.getSession("s1")?.project_root).toBe(root);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      store.close();
    }
  });

  it("bare RUN with multiple plans uses Channel A (no decision:block)", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    writeChecklist(root, "alpha", `- [ ] a — A\n`);
    writeChecklist(root, "beta", `- [ ] b — B\n`);
    const out = handleUserPromptSubmit(
      store,
      { session_id: "pick1", prompt: "/autopilot-run" },
      root,
    );
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/alpha|beta/);
    store.close();
  });

  it("apply_patch product path arms code_edited; plans path does not", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "x.ts"), "export {}\n");
    store.upsertSession({
      conversation_id: "s1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
      platform: CODEX_PLATFORM,
    });

    handlePostToolUse(
      store,
      {
        session_id: "s1",
        tool_name: "apply_patch",
        tool_input: {
          command: "*** Update File: src/x.ts\n@@\n-a\n+b\n",
        },
      },
      root,
    );
    expect(store.getReviewChain("s1")?.code_edited).toBe(1);

    store.updateReviewChain("s1", { code_edited: 0 });
    handlePostToolUse(
      store,
      {
        session_id: "s1",
        tool_name: "apply_patch",
        tool_input: {
          command: "*** Update File: plans/demo/plan.md\n@@\n-a\n+b\n",
        },
      },
      root,
    );
    expect(store.getReviewChain("s1")?.code_edited ?? 0).toBe(0);
    store.close();
  });

  it("Stop continues with decision:block+reason only; loop:false hard-stops", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "s1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      checklist_path: cp,
      track_id: "demo",
      platform: CODEX_PLATFORM,
    });
    store.updateReviewChain("s1", { code_edited: 1 });

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

    const out = handleStop(eng, {
      session_id: "s1",
      stop_hook_active: false,
    });
    expect(out.decision).toBe("block");
    expect(out.reason).toBeTruthy();
    expect(out.continue).toBeUndefined();

    const haltMapped = handleStop(
      {
        handleStop: () => ({
          kind: "stuck",
          message: "Stuck: test halt",
          loop: false,
        }),
      } as unknown as ReviewEngine,
      { session_id: "s1" },
    );
    expect(haltMapped.continue).toBe(false);
    expect(haltMapped.decision).toBeUndefined();
    expect(haltMapped.stopReason).toMatch(/Stuck/);
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
    expect(handleStop(eng, { session_id: "" })).toEqual({});
    expect(
      handleUserPromptSubmit(store, { session_id: "", prompt: "x" }, root),
    ).toEqual({});
    store.close();
  });
});
