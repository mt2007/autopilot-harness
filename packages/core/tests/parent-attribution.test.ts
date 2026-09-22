import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StateStore } from "../src/state-store.js";
import {
  extractParentConversationId,
  hasProductDirtyFromFilesOrGit,
  resolveEditArmTarget,
  resolveSubagentStopArmTarget,
} from "../src/parent-attribution.js";

function seed(
  store: StateStore,
  id: string,
  patch: { paused?: number; phase?: "idle" | "planning" | "executing" | "done" } = {},
): void {
  store.upsertSession({
    conversation_id: id,
    project_root: store.projectRoot,
    code_root: store.projectRoot,
    platform: "cursor",
    track_id: "demo",
    track_title: "Demo",
    phase: patch.phase ?? "executing",
    paused: patch.paused ?? 0,
    armed: 1,
    checklist_path: "plans/demo/checklist.md",
  });
}

describe("extractParentConversationId", () => {
  it("reads Cursor parent_conversation_id / camelCase", () => {
    expect(
      extractParentConversationId({ parent_conversation_id: "parent-a" }),
    ).toBe("parent-a");
    expect(
      extractParentConversationId({ parentConversationId: " parent-b " }),
    ).toBe("parent-b");
  });

  it("reads Claude-shaped parent_session_id without treating it as current sid", () => {
    expect(
      extractParentConversationId({
        session_id: "child",
        parent_session_id: "parent-c",
      }),
    ).toBe("parent-c");
  });

  it("returns null for blank / missing / NUL", () => {
    expect(extractParentConversationId({})).toBeNull();
    expect(extractParentConversationId({ parent_conversation_id: "  " })).toBeNull();
    expect(
      extractParentConversationId({ parent_conversation_id: "bad\0id" }),
    ).toBeNull();
    expect(
      extractParentConversationId({ parent_conversation_id: "bad\nid" }),
    ).toBeNull();
    expect(extractParentConversationId(null)).toBeNull();
    expect(
      extractParentConversationId(
        // @ts-expect-error intentional non-object
        ["parent-a"],
      ),
    ).toBeNull();
  });
});

describe("resolveEditArmTarget", () => {
  it("no parent → self (today cid)", () => {
    const store = StateStore.openMemory("/tmp/ap-parent-edit-self");
    seed(store, "child-1");
    expect(
      resolveEditArmTarget(store, {
        conversationId: "child-1",
        parentConversationId: null,
      }),
    ).toEqual({ kind: "self", conversationId: "child-1" });
    store.close();
  });

  it("parent present + existing session → parent", () => {
    const store = StateStore.openMemory("/tmp/ap-parent-edit-parent");
    seed(store, "parent-1");
    seed(store, "child-2");
    expect(
      resolveEditArmTarget(store, {
        conversationId: "child-2",
        parentConversationId: "parent-1",
      }),
    ).toEqual({ kind: "parent", conversationId: "parent-1" });
    store.close();
  });

  it("parent present but missing session → noop (does not invent)", () => {
    const store = StateStore.openMemory("/tmp/ap-parent-edit-noop");
    seed(store, "child-3");
    expect(
      resolveEditArmTarget(store, {
        conversationId: "child-3",
        parentConversationId: "ghost-parent",
      }),
    ).toEqual({ kind: "noop", reason: "missing_parent_session" });
    expect(store.getSession("ghost-parent")).toBeNull();
    store.close();
  });

  it("parent equals self → self (echoed parent id is not a cross-session link)", () => {
    const store = StateStore.openMemory("/tmp/ap-parent-edit-same");
    seed(store, "same-id");
    expect(
      resolveEditArmTarget(store, {
        conversationId: "same-id",
        parentConversationId: "same-id",
      }),
    ).toEqual({ kind: "self", conversationId: "same-id" });
    store.close();
  });

  it("blank self + existing distinct parent → parent (exist-only)", () => {
    const store = StateStore.openMemory("/tmp/ap-parent-edit-blank-self");
    seed(store, "parent-only");
    expect(
      resolveEditArmTarget(store, {
        conversationId: "  ",
        parentConversationId: "parent-only",
      }),
    ).toEqual({ kind: "parent", conversationId: "parent-only" });
    store.close();
  });
});

describe("resolveSubagentStopArmTarget", () => {
  it("missing parent → noop", () => {
    const store = StateStore.openMemory("/tmp/ap-parent-stop-noparent");
    seed(store, "cid");
    expect(
      resolveSubagentStopArmTarget(store, {
        conversationId: "cid",
        parentConversationId: null,
        projectRoot: store.projectRoot,
        modifiedFiles: ["src/a.ts"],
      }),
    ).toEqual({ kind: "noop", reason: "missing_parent" });
    store.close();
  });

  it("parent missing session → noop", () => {
    const store = StateStore.openMemory("/tmp/ap-parent-stop-ghost");
    expect(
      resolveSubagentStopArmTarget(store, {
        conversationId: "child",
        parentConversationId: "ghost",
        projectRoot: store.projectRoot,
        modifiedFiles: ["src/a.ts"],
      }),
    ).toEqual({ kind: "noop", reason: "missing_parent_session" });
    store.close();
  });

  it("product dirty via modified_files → arm parent (paused sticky ok)", () => {
    const store = StateStore.openMemory("/tmp/ap-parent-stop-files");
    seed(store, "parent-p", { paused: 1, phase: "executing" });
    const target = resolveSubagentStopArmTarget(store, {
      conversationId: "child",
      parentConversationId: "parent-p",
      projectRoot: store.projectRoot,
      modifiedFiles: ["src/feature.ts"],
    });
    expect(target).toEqual({ kind: "parent", conversationId: "parent-p" });
    store.markCodeEdited("parent-p");
    expect(store.getReviewChain("parent-p")?.code_edited).toBe(1);
    expect(store.getSession("parent-p")?.paused).toBe(1);
    store.close();
  });

  it("parent equals conversation_id still arms when session exists (host parent context)", () => {
    const store = StateStore.openMemory("/tmp/ap-parent-stop-echo");
    seed(store, "parent-echo");
    expect(
      resolveSubagentStopArmTarget(store, {
        conversationId: "parent-echo",
        parentConversationId: "parent-echo",
        projectRoot: store.projectRoot,
        modifiedFiles: ["src/a.ts"],
      }),
    ).toEqual({ kind: "parent", conversationId: "parent-echo" });
    store.close();
  });

  it("ignored-only modified_files + clean git → noop (not dirty)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-parent-clean-"));
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".autopilotignore"),
        ".cursor/**\n",
        "utf8",
      );
      const store = StateStore.openMemory(root);
      seed(store, "parent-clean");
      expect(
        resolveSubagentStopArmTarget(store, {
          conversationId: "child",
          parentConversationId: "parent-clean",
          projectRoot: root,
          modifiedFiles: [".cursor/hooks.json"],
        }),
      ).toEqual({ kind: "noop", reason: "not_product_dirty" });
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("empty modified_files still probes git (does not short-circuit)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-parent-git-"));
    try {
      // Not a git repo → hasDirtyProductCode fail-closed false; empty files → not dirty.
      const store = StateStore.openMemory(root);
      seed(store, "parent-git");
      expect(
        resolveSubagentStopArmTarget(store, {
          conversationId: "child",
          parentConversationId: "parent-git",
          projectRoot: root,
          modifiedFiles: [],
        }),
      ).toEqual({ kind: "noop", reason: "not_product_dirty" });
      // Explicit product path in files still arms without needing git.
      expect(
        resolveSubagentStopArmTarget(store, {
          conversationId: "child",
          parentConversationId: "parent-git",
          projectRoot: root,
          modifiedFiles: ["lib/x.ts"],
        }),
      ).toEqual({ kind: "parent", conversationId: "parent-git" });
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("hasProductDirtyFromFilesOrGit", () => {
  it("true when any modified file is product", () => {
    expect(
      hasProductDirtyFromFilesOrGit("/tmp/ap-any", ["src/a.ts", ".cursor/x"]),
    ).toBe(true);
  });

  it("caps modified_files scan by index (non-strings cannot bypass)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-parent-cap-"));
    try {
      // 200 non-strings then a product path — must not scan past the cap;
      // git unavailable → false (union still probed after the capped file walk).
      const padded: unknown[] = Array.from({ length: 200 }, () => 1);
      padded.push("src/late.ts");
      expect(
        hasProductDirtyFromFilesOrGit(root, padded as string[]),
      ).toBe(false);
      // Product within the first 200 still wins.
      const early: unknown[] = Array.from({ length: 199 }, () => 1);
      early.push("src/early.ts");
      expect(
        hasProductDirtyFromFilesOrGit(root, early as string[]),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("false when files empty and git clean/unavailable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-parent-union-"));
    try {
      expect(hasProductDirtyFromFilesOrGit(root, [])).toBe(false);
      expect(hasProductDirtyFromFilesOrGit(root, null)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Cursor afterFileEdit parent attribution", () => {
  it("arms existing parent; ghost parent no-ops; no parent arms self", async () => {
    const { handleAfterFileEdit } = await import(
      "../../ports/cursor/src/index.js"
    );
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cur-parent-"));
    try {
      fs.mkdirSync(path.join(root, "src"), { recursive: true });
      const product = path.join(root, "src", "a.ts");
      fs.writeFileSync(product, "export {}\n");

      const store = StateStore.openMemory(root);
      seed(store, "parent-cur", { paused: 1 });

      handleAfterFileEdit(
        store,
        {
          conversation_id: "child-cur",
          parent_conversation_id: "parent-cur",
          file_path: product,
        },
        root,
      );
      expect(store.getReviewChain("parent-cur")?.code_edited).toBe(1);
      expect(store.getSession("child-cur")).toBeNull();

      store.updateReviewChain("parent-cur", { code_edited: 0 });
      handleAfterFileEdit(
        store,
        {
          conversation_id: "child-cur",
          parent_conversation_id: "ghost",
          file_path: product,
        },
        root,
      );
      expect(store.getSession("ghost")).toBeNull();
      expect(store.getReviewChain("parent-cur")?.code_edited ?? 0).toBe(0);

      seed(store, "solo-cur");
      handleAfterFileEdit(
        store,
        { conversation_id: "solo-cur", file_path: product },
        root,
      );
      expect(store.getReviewChain("solo-cur")?.code_edited).toBe(1);
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
