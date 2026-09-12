import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  allowNeedPickContext,
  KIMI_PLATFORM,
  filePathsFromKimiEdit,
  handlePostToolUse,
  handleStop,
  handleUserPromptSubmit,
  isKimiEditTool,
  loopCountFromStopHookActive,
  MAX_NEED_PICK_SLUGS,
  MAX_APPLY_PATCH_PATHS,
  MAX_HOOK_STDIO_CHARS,
  normalizeKimiStopStatus,
  pathsFromApplyPatchCommand,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-kimi-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("port-kimi-code adapters", () => {
  it("maps stop_hook_active and edit helpers; parses paths", () => {
    expect(loopCountFromStopHookActive({ stop_hook_active: true })).toBe(1);
    expect(loopCountFromStopHookActive({ stopHookActive: false })).toBe(0);
    expect(isKimiEditTool("Write")).toBe(true);
    expect(isKimiEditTool("Edit")).toBe(true);
    expect(isKimiEditTool("StrReplace")).toBe(true);
    expect(isKimiEditTool("Bash")).toBe(false);

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
      filePathsFromKimiEdit({
        tool_name: "Write",
        tool_input: { file_path: "src/w.ts" },
      }),
    ).toEqual(["src/w.ts"]);
    expect(
      filePathsFromKimiEdit({
        tool_name: "Edit",
        tool_input: { path: "src/e.ts" },
      }),
    ).toEqual(["src/e.ts"]);
    expect(
      filePathsFromKimiEdit({
        tool_name: "Write",
        tool_input: { file_path: "bad\0path.ts" },
      }),
    ).toEqual([]);
    expect(normalizeKimiStopStatus({ status: "aborted" })).toBe("aborted");
    expect(
      normalizeKimiStopStatus(
        { error: "User aborted/interrupted manually." },
        { status: "error" },
      ),
    ).toBe("aborted");
  });

  it("needPick uses exit 0 + stdout only; caps slug list", () => {
    const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 10 }, (_, i) => ({
      slug: `plan-${i}`,
    }));
    const out = allowNeedPickContext("", many);
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toBeUndefined();
    expect(out.stdout ?? "").toMatch(/Select a plan/);
    expect(out.stdout ?? "").toMatch(/plan-0/);
    expect(out.stdout ?? "").not.toMatch(
      new RegExp(`plan-${MAX_NEED_PICK_SLUGS}\\b`),
    );
  });

  it("ON stamps platform as kimi-code; does not trust cwd", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    expect(
      handleUserPromptSubmit(
        store,
        {
          session_id: "kimi-s1",
          prompt: "/autopilot-on plat-tag",
          cwd: "/tmp/hostile-elsewhere",
        },
        root,
      ),
    ).toEqual({ exitCode: 0 });
    expect(store.getSession("kimi-s1")?.platform).toBe(KIMI_PLATFORM);
    expect(store.getSession("kimi-s1")?.phase).toBe("planning");
    expect(store.getSession("kimi-s1")?.project_root).toBe(root);
    store.close();
  });

  it("fail-closes ON while executing with exit 2 + stderr", () => {
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
      expect(blocked.exitCode).toBe(2);
      expect(blocked.stderr).toBeTruthy();
      expect(store.getSession("s1")?.platform).toBe(KIMI_PLATFORM);
      expect(store.getSession("s1")?.project_root).toBe(root);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      store.close();
    }
  });

  it("bare RUN with multiple plans uses Channel A (exit 0 + stdout)", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    writeChecklist(root, "alpha", `- [ ] a — A\n`);
    writeChecklist(root, "beta", `- [ ] b — B\n`);
    const out = handleUserPromptSubmit(
      store,
      { session_id: "pick1", prompt: "/autopilot-run" },
      root,
    );
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toBeUndefined();
    expect(out.stdout).toMatch(/alpha|beta/);
    store.close();
  });

  it("Write product path arms code_edited; plans path does not", () => {
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
      platform: KIMI_PLATFORM,
    });

    handlePostToolUse(
      store,
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: { file_path: "src/x.ts" },
      },
      root,
    );
    expect(store.getReviewChain("s1")?.code_edited).toBe(1);

    store.updateReviewChain("s1", { code_edited: 0 });
    handlePostToolUse(
      store,
      {
        session_id: "s1",
        tool_name: "Write",
        tool_input: { file_path: "plans/demo/plan.md" },
      },
      root,
    );
    expect(store.getReviewChain("s1")?.code_edited ?? 0).toBe(0);
    store.close();
  });

  it("Stop continues with exit 2+stderr; loop:false hard-stops with exit 0", () => {
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
      platform: KIMI_PLATFORM,
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
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toBeTruthy();
    expect(out.stdout).toBeUndefined();

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
    expect(haltMapped.exitCode).toBe(0);
    expect(haltMapped.stderr).toBeUndefined();
    expect(haltMapped.stdout).toBeUndefined();

    const huge = handleStop(
      {
        handleStop: () => ({
          kind: "fix",
          message: "Z".repeat(MAX_HOOK_STDIO_CHARS + 80),
          loop: true,
        }),
      } as unknown as ReviewEngine,
      { session_id: "s1" },
    );
    expect(huge.exitCode).toBe(2);
    expect((huge.stderr ?? "").length).toBeLessThanOrEqual(MAX_HOOK_STDIO_CHARS);
    expect(huge.stderr?.endsWith("…")).toBe(true);
    store.close();
  });

  it("empty session_id is a no-op allow", () => {
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
    expect(handleStop(eng, { session_id: "" })).toEqual({ exitCode: 0 });
    expect(
      handleUserPromptSubmit(store, { session_id: "", prompt: "x" }, root),
    ).toEqual({ exitCode: 0 });
    store.close();
  });
});
