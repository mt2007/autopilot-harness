import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ReviewEngine, StateStore } from "@autopilot-harness/core";
import {
  buildNeedPickMessage,
  buildPiConversationId,
  conversationIdFromPiPayload,
  filePathsFromPiToolInput,
  handlePiAgentSettled,
  handlePiBeforeAgentStart,
  handlePiInput,
  handlePiStop,
  handlePiSubmit,
  handlePiToolResult,
  handlePiUserInput,
  isPiEditTool,
  isPiUnsupportedAutopilotMode,
  PI_CONTINUE_CUSTOM_TYPE,
  PI_CONTINUE_DELIVER,
  PI_EDIT_TOOLS,
  PI_PLATFORM,
  PI_SOFT_MIN_NODE,
  PI_SOFT_MIN_VERSION,
  resolvePiWorkspaceRoot,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-pi-port-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

describe("port-pi adapters", () => {
  it("documents constants and aliases", () => {
    expect(PI_PLATFORM).toBe("pi");
    expect(PI_SOFT_MIN_VERSION).toBe("0.85.1");
    expect(PI_SOFT_MIN_NODE).toBe("22.19.0");
    expect(PI_CONTINUE_CUSTOM_TYPE).toBe("autopilot-harness");
    expect(PI_CONTINUE_DELIVER).toEqual({
      deliverAs: "followUp",
      triggerTurn: true,
    });
    expect([...PI_EDIT_TOOLS]).toEqual(["write", "edit"]);
    expect(handlePiSubmit).toBe(handlePiBeforeAgentStart);
    expect(handlePiStop).toBe(handlePiAgentSettled);
    expect(handlePiUserInput).toBe(handlePiInput);
    expect(isPiEditTool("write")).toBe(true);
    expect(isPiEditTool("edit")).toBe(true);
    expect(isPiEditTool("bash")).toBe(false);
    expect(isPiUnsupportedAutopilotMode("tui")).toBe(false);
    expect(isPiUnsupportedAutopilotMode("print")).toBe(true);
    expect(isPiUnsupportedAutopilotMode("json")).toBe(true);
  });

  it("builds conversation id preferring session file (R2)", () => {
    expect(buildPiConversationId("/tmp/s.jsonl", "abc")).toBe(
      "pi:/tmp/s.jsonl",
    );
    expect(buildPiConversationId(null, "abc")).toBe("pi:abc");
    expect(buildPiConversationId("", "")).toBe("");
    expect(buildPiConversationId("bad\nid", null)).toBe("");
    expect(
      conversationIdFromPiPayload({
        sessionFile: "/x.jsonl",
        sessionId: "id",
      }),
    ).toBe("pi:/x.jsonl");
  });

  it("resolves workspace root", () => {
    expect(
      resolvePiWorkspaceRoot({ installRoot: "/proj", cwd: "/other" }),
    ).toBe("/proj");
    expect(resolvePiWorkspaceRoot({ cwd: "/cwd" })).toBe("/cwd");
    expect(resolvePiWorkspaceRoot({})).toBeNull();
  });

  it("parses write/edit path from tool input", () => {
    expect(filePathsFromPiToolInput({ path: "src/a.ts" })).toEqual([
      "src/a.ts",
    ]);
    expect(filePathsFromPiToolInput({ path: "" })).toEqual([]);
    expect(filePathsFromPiToolInput(null)).toEqual([]);
    const resolved = filePathsFromPiToolInput(
      { path: "src/a.ts" },
      "/proj",
    );
    expect(resolved).toEqual([path.resolve("/proj", "src/a.ts")]);
  });

  it("marks harness-owned on extension input (no ON/RUN)", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    try {
      const r = handlePiInput(
        store,
        {
          text: "Autopilot ON",
          source: "extension",
          sessionId: "s1",
          mode: "tui",
        },
        root,
      );
      expect(r.harnessOwned).toBe(true);
      expect(store.getSession("pi:s1")).toBeNull();
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags unsupported print/json mode on input", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    try {
      expect(
        handlePiInput(
          store,
          { text: "hi", source: "interactive", sessionId: "s", mode: "print" },
          root,
        ).unsupportedMode,
      ).toBe(true);
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("applyOn via before_agent_start stamps platform pi", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    try {
      const r = handlePiBeforeAgentStart(
        store,
        {
          prompt: "Autopilot ON · demo brief",
          sessionId: "sess-on",
          mode: "tui",
        },
        root,
      );
      expect(r.message).toBeUndefined();
      const s = store.getSession("pi:sess-on");
      expect(s?.platform).toBe(PI_PLATFORM);
      expect(s?.phase).toBe("planning");
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("arms product write via tool_result", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const src = path.join(root, "src");
    fs.mkdirSync(src, { recursive: true });
    const file = path.join(src, "a.ts");
    fs.writeFileSync(file, "export const x = 1;\n");
    writeChecklist(root, "demo", "# Checklist\n\n- [ ] item-a — A\n");
    try {
      handlePiBeforeAgentStart(
        store,
        { prompt: "Autopilot RUN demo", sessionId: "sess-ed", mode: "tui" },
        root,
      );
      handlePiToolResult(
        store,
        {
          toolName: "write",
          input: { path: file },
          sessionId: "sess-ed",
        },
        root,
      );
      const chain = store.getReviewChain("pi:sess-ed");
      expect(chain?.code_edited).toBe(1);
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("R1: agent_settled without pending returns no continueMessage", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const engine = new ReviewEngine(store);
    try {
      handlePiBeforeAgentStart(
        store,
        { prompt: "Autopilot ON", sessionId: "idle", mode: "tui" },
        root,
      );
      const r = handlePiAgentSettled(
        engine,
        store,
        { sessionId: "idle", mode: "tui" },
        root,
      );
      expect(r.continueMessage).toBeUndefined();
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("R1: loop:false settled yields no continueMessage; loop:true yields message", () => {
    const root = tmpRoot();
    const store = new StateStore(root);
    const cid = "pi:sess-loop";
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      platform: PI_PLATFORM,
      phase: "executing",
    });
    try {
      const halt = handlePiAgentSettled(
        {
          handleStop: () => ({
            message: "Stuck: too many loops",
            loop: false,
          }),
        } as unknown as ReviewEngine,
        store,
        { sessionId: "sess-loop", mode: "tui" },
        root,
      );
      expect(halt.continueMessage).toBeUndefined();

      const cont = handlePiAgentSettled(
        {
          handleStop: () => ({
            message: "Review fix round 1 — keep going",
            loop: true,
          }),
        } as unknown as ReviewEngine,
        store,
        { sessionId: "sess-loop", mode: "tui" },
        root,
      );
      expect(cont.continueMessage).toMatch(/^Review fix round/);
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("harness followup before_agent_start does not clear chain_pending", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cid = "pi:sess-follow";
    const cp = writeChecklist(root, "trk", "- [ ] x — X\n");
    store.upsertSession({
      conversation_id: cid,
      project_root: root,
      code_root: root,
      phase: "executing",
      track_id: "trk",
      checklist_path: cp,
      platform: PI_PLATFORM,
    });
    store.updateReviewChain(cid, {
      chain_pending: 1,
      pending_followup: "Review fix round 1",
    });
    try {
      handlePiBeforeAgentStart(
        store,
        {
          prompt: "Review fix round 1 — keep going",
          sessionId: "sess-follow",
          mode: "tui",
        },
        root,
      );
      expect(store.getReviewChain(cid)?.chain_pending).toBe(1);
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("buildNeedPickMessage includes slugs", () => {
    const msg = buildNeedPickMessage("", [{ slug: "v0.14-pi" }]);
    expect(msg).toContain("v0.14-pi");
    expect(msg).toContain("/autopilot-run");
  });
});
