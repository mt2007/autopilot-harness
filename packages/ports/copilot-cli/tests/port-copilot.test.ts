import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  buildNeedPickContext,
  COPILOT_PLATFORM,
  COPILOT_POST_TOOL_USE_MATCHER,
  COPILOT_STOP_CAP_RAISE_FOUND,
  filePathsFromCopilotEdit,
  handlePostToolUse,
  handleStop,
  handleUserPromptSubmit,
  handleUserPromptTransformed,
  isCopilotEditTool,
  loopCountFromStopHookActive,
  MAX_NEED_PICK_SLUGS,
  MAX_GATE_FILE_BYTES,
  normalizeCopilotStopStatus,
  safeGateFileId,
  stashSubmitGate,
  submitGateFilePath,
  takeSubmitGate,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-copilot-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("port-copilot-cli adapters", () => {
  it("documents no Stop-cap raise; edit matcher; helpers", () => {
    expect(COPILOT_STOP_CAP_RAISE_FOUND).toBe(false);
    expect(COPILOT_POST_TOOL_USE_MATCHER).toBe("edit|create");
    expect(loopCountFromStopHookActive({ stop_hook_active: true })).toBe(1);
    expect(loopCountFromStopHookActive({ stopHookActive: false })).toBe(0);
    expect(isCopilotEditTool("edit")).toBe(true);
    expect(isCopilotEditTool("Create")).toBe(true);
    expect(isCopilotEditTool("bash")).toBe(false);
    expect(
      filePathsFromCopilotEdit({
        tool_name: "edit",
        tool_input: { path: "src/a.ts" },
      }),
    ).toEqual(["src/a.ts"]);
    expect(
      filePathsFromCopilotEdit({
        tool_name: "create",
        toolArgs: JSON.stringify({ filePath: "src/b.ts" }),
      }),
    ).toEqual(["src/b.ts"]);
    expect(
      filePathsFromCopilotEdit({
        tool_name: "edit",
        tool_input: { path: "bad\0path.ts" },
      }),
    ).toEqual([]);
    expect(normalizeCopilotStopStatus({ status: "aborted" })).toBe("aborted");
    expect(safeGateFileId("a/b")).not.toBe(safeGateFileId("a_b"));
  });

  it("needPick context caps slugs; file gate stash UPS→Transform", () => {
    const many = Array.from({ length: MAX_NEED_PICK_SLUGS + 10 }, (_, i) => ({
      slug: `plan-${i}`,
    }));
    const ctx = buildNeedPickContext("", many);
    expect(ctx).toMatch(/Select a plan/);
    expect((ctx.match(/plan-\d+/g) ?? []).length).toBe(MAX_NEED_PICK_SLUGS);

    const root = tmpRoot();
    const cid = "sess-gate";
    stashSubmitGate(root, cid, "busy: other track", "block");
    expect(fs.existsSync(submitGateFilePath(root, cid))).toBe(true);
    const taken = takeSubmitGate(root, cid);
    expect(taken).toEqual({ kind: "block", text: "busy: other track" });
    expect(fs.existsSync(submitGateFilePath(root, cid))).toBe(false);
  });

  it("UPS ON side-effects; Transform injects stashed needPick (prepend)", () => {
    const root = tmpRoot();
    writeChecklist(root, "alpha", "# Checklist\n\n- [ ] item-a — A\n");
    writeChecklist(root, "beta", "# Checklist\n\n- [ ] item-b — B\n");
    const store = new StateStore(root);
    const cid = "sess-run";

    const on = handleUserPromptSubmit(
      store,
      { sessionId: cid, prompt: "Autopilot ON" },
      root,
    );
    expect(on._stashedGate).toBeUndefined();
    expect(store.getSession(cid)?.phase).toBe("planning");

    const run = handleUserPromptSubmit(
      store,
      { sessionId: cid, prompt: "Autopilot RUN" },
      root,
    );
    expect(run._stashedGate).toMatch(/Select a plan|alpha|beta/i);

    const tr = handleUserPromptTransformed(
      store,
      {
        sessionId: cid,
        prompt: "Autopilot RUN",
        transformedPrompt: "Autopilot RUN",
      },
      root,
    );
    expect(tr.modifiedTransformedPrompt).toMatch(/\[Autopilot\]/);
    expect(tr.modifiedTransformedPrompt).toMatch(/Select a plan|alpha|beta/i);
    expect(tr.modifiedTransformedPrompt).toMatch(/Autopilot RUN/);
    expect(fs.existsSync(submitGateFilePath(root, cid))).toBe(false);
    store.close();
  });

  it("Transform block gate replaces prompt (no leftover user RUN)", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const cid = "sess-busy";
    stashSubmitGate(root, cid, "State database is busy", "block");
    const tr = handleUserPromptTransformed(
      store,
      {
        sessionId: cid,
        prompt: "Autopilot RUN",
        transformedPrompt: "Autopilot RUN",
      },
      root,
    );
    expect(tr.modifiedTransformedPrompt).toMatch(/State database is busy/);
    expect(tr.modifiedTransformedPrompt).not.toMatch(/Autopilot RUN/);
    store.close();
  });

  it("successful UPS clears stale gate; invalid JSON object gate is ignored", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const cid = "sess-stale";
    stashSubmitGate(root, cid, "stale busy", "block");
    expect(fs.existsSync(submitGateFilePath(root, cid))).toBe(true);

    handleUserPromptSubmit(
      store,
      { sessionId: cid, prompt: "hello unrelated" },
      root,
    );
    expect(fs.existsSync(submitGateFilePath(root, cid))).toBe(false);

    const file = submitGateFilePath(root, cid);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ kind: "nope", text: "x" }), "utf8");
    const tr = handleUserPromptTransformed(
      store,
      { sessionId: cid, transformedPrompt: "keep me" },
      root,
    );
    expect(tr.modifiedTransformedPrompt).toBeUndefined();
    store.close();
  });

  it("rejects empty projectRoot and oversized gate files without throwing", () => {
    expect(() => stashSubmitGate("", "cid", "x", "block")).not.toThrow();
    const root = tmpRoot();
    const cid = "sess-big";
    const file = submitGateFilePath(root, cid);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "x".repeat(MAX_GATE_FILE_BYTES + 8), "utf8");
    expect(takeSubmitGate(root, cid)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("stash overwrites an existing gate file (Windows-safe replace)", () => {
    const root = tmpRoot();
    const cid = "sess-ow";
    stashSubmitGate(root, cid, "first", "block");
    stashSubmitGate(root, cid, "second", "needPick");
    const taken = takeSubmitGate(root, cid);
    expect(taken).toEqual({ kind: "needPick", text: "second" });
  });

  it("stashSubmitGate never throws on null/illegal message or kind", () => {
    const root = tmpRoot();
    expect(() =>
      stashSubmitGate(root, "cid", undefined as unknown as string, "block"),
    ).not.toThrow();
    const text = stashSubmitGate(
      root,
      "cid2",
      null as unknown as string,
      "nope" as unknown as "block",
    );
    expect(text).toMatch(/Autopilot rejected/);
    const taken = takeSubmitGate(root, "cid2");
    expect(taken?.kind).toBe("block");
  });

  it("PostToolUse arms edit path; Stop returns decision block; hard-stop is empty", () => {
    const root = tmpRoot();
    const cp = writeChecklist(
      root,
      "t1",
      "# Checklist\n\n- [ ] port-item — do thing\n",
    );
    const store = new StateStore(root);
    const cid = "sess-stop";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: COPILOT_PLATFORM,
      phase: "executing",
      armed: 1,
      checklist_path: cp,
      track_id: "t1",
    });

    const src = path.join(root, "src");
    fs.mkdirSync(src, { recursive: true });
    const file = path.join(src, "x.ts");
    fs.writeFileSync(file, "export const x = 1;\n");

    handlePostToolUse(
      store,
      {
        sessionId: cid,
        toolName: "edit",
        tool_input: { path: file },
      },
      root,
    );
    expect(store.getReviewChain(cid)?.code_edited).toBe(1);

    const engine = new ReviewEngine(store, { projectRoot: root });
    const stop = handleStop(engine, {
      sessionId: cid,
      stop_hook_active: false,
    });
    expect(stop.decision).toBe("block");
    expect(stop.reason).toBeTruthy();
    expect(stop.continue).toBeUndefined();
    store.close();
  });
});
