import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import { handleSubagentStop } from "../../ports/cursor/src/index.js";
import { installInitYes } from "../src/init/install.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-cursor-substop-"));
}

function seed(
  store: StateStore,
  id: string,
  patch: { paused?: number } = {},
): void {
  store.upsertSession({
    conversation_id: id,
    project_root: store.projectRoot,
    code_root: store.projectRoot,
    platform: "cursor",
    track_id: "demo",
    track_title: "Demo",
    phase: "executing",
    paused: patch.paused ?? 0,
    armed: 1,
    checklist_path: "plans/demo/checklist.md",
  });
}

describe("Cursor handleSubagentStop", () => {
  it("arms existing parent when product files dirty; never invents; returns {}", () => {
    const root = tmpRoot();
    try {
      const store = StateStore.openMemory(root);
      seed(store, "parent-a", { paused: 1 });
      const out = handleSubagentStop(
        store,
        {
          conversation_id: "child-a",
          parent_conversation_id: "parent-a",
          modified_files: ["src/feature.ts"],
          status: "completed",
        },
        root,
      );
      expect(out).toEqual({});
      expect(store.getReviewChain("parent-a")?.code_edited).toBe(1);
      expect(store.getSession("parent-a")?.paused).toBe(1);
      expect(store.getSession("child-a")).toBeNull();
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("no-ops on missing parent / ghost parent / ignored-only files", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(path.join(root, ".autopilotignore"), ".cursor/**\n");
      const store = StateStore.openMemory(root);
      seed(store, "parent-b");

      expect(
        handleSubagentStop(
          store,
          {
            conversation_id: "child",
            modified_files: ["src/a.ts"],
          },
          root,
        ),
      ).toEqual({});
      expect(store.getReviewChain("parent-b")?.code_edited ?? 0).toBe(0);

      expect(
        handleSubagentStop(
          store,
          {
            conversation_id: "child",
            parent_conversation_id: "ghost",
            modified_files: ["src/a.ts"],
          },
          root,
        ),
      ).toEqual({});
      expect(store.getSession("ghost")).toBeNull();

      expect(
        handleSubagentStop(
          store,
          {
            conversation_id: "child",
            parent_conversation_id: "parent-b",
            modified_files: [".cursor/hooks.json"],
          },
          root,
        ),
      ).toEqual({});
      expect(store.getReviewChain("parent-b")?.code_edited ?? 0).toBe(0);
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fail-open: still returns {} when mark path throws", () => {
    const root = tmpRoot();
    try {
      const store = StateStore.openMemory(root);
      seed(store, "parent-c");
      // Force markCodeEdited throw while getSession still works (closed db
      // fails earlier inside resolveSubagentStopArmTarget).
      store.markCodeEdited = () => {
        throw new Error("forced mark failure");
      };
      expect(
        handleSubagentStop(
          store,
          {
            conversation_id: "child",
            parent_conversation_id: "parent-c",
            modified_files: ["src/a.ts"],
          },
          root,
        ),
      ).toEqual({});
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("arms when parent === conversation_id (host parent-context echo)", () => {
    const root = tmpRoot();
    try {
      const store = StateStore.openMemory(root);
      seed(store, "same-id");
      const out = handleSubagentStop(
        store,
        {
          conversation_id: "same-id",
          parent_conversation_id: "same-id",
          modified_files: ["src/a.ts"],
        },
        root,
      );
      expect(out).toEqual({});
      expect(store.getReviewChain("same-id")?.code_edited).toBe(1);
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fail-open: null / array / non-object payload → {}", () => {
    const root = tmpRoot();
    try {
      const store = StateStore.openMemory(root);
      seed(store, "parent-d");
      for (const bad of [null, undefined, [], "x", 1] as unknown[]) {
        expect(
          handleSubagentStop(
            store,
            bad as Parameters<typeof handleSubagentStop>[1],
            root,
          ),
        ).toEqual({});
      }
      expect(store.getReviewChain("parent-d")?.code_edited ?? 0).toBe(0);
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("hook dispatch: cursor stamp arms parent; stdout {}; never followup", () => {
    const root = tmpRoot();
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "cursor",
          surface: "ide",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      const seedStore = new StateStore(root);
      seed(seedStore, "parent-hook");
      seedStore.close();

      const proc = spawnSync(
        process.execPath,
        [
          path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs"),
          "--platform",
          "cursor",
          "--event",
          "subagentStop",
        ],
        {
          cwd: root,
          input: JSON.stringify({
            conversation_id: "child-hook",
            parent_conversation_id: "parent-hook",
            modified_files: ["src/feature.ts"],
            status: "completed",
          }),
          encoding: "utf8",
          timeout: 15_000,
        },
      );
      expect(proc.status).toBe(0);
      expect(proc.stdout.trim()).toBe("{}");
      const out = JSON.parse(proc.stdout.trim() || "{}") as Record<
        string,
        unknown
      >;
      expect(out.followup_message).toBeUndefined();
      expect(out.loop).toBeUndefined();

      const after = new StateStore(root);
      expect(after.getReviewChain("parent-hook")?.code_edited).toBe(1);
      expect(after.getSession("child-hook")).toBeNull();
      after.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("hook dispatch: non-cursor stamp does not arm parent", () => {
    const root = tmpRoot();
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "cursor",
          surface: "ide",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      const seedStore = new StateStore(root);
      seed(seedStore, "parent-xf");
      seedStore.close();

      const proc = spawnSync(
        process.execPath,
        [
          path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs"),
          "--platform",
          "claude-code",
          "--event",
          "subagentStop",
        ],
        {
          cwd: root,
          input: JSON.stringify({
            conversation_id: "child-xf",
            parent_conversation_id: "parent-xf",
            modified_files: ["src/feature.ts"],
            status: "completed",
          }),
          encoding: "utf8",
          timeout: 15_000,
        },
      );
      expect(proc.status).toBe(0);
      expect(proc.stdout.trim()).toBe("{}");

      const after = new StateStore(root);
      expect(after.getReviewChain("parent-xf")?.code_edited ?? 0).toBe(0);
      after.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
