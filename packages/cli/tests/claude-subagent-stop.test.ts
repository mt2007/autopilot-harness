import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import { handleSubagentStop } from "../../ports/claude-code/src/index.js";
import { installInitYes } from "../src/init/install.js";
import { CLAUDE_AUTOPILOT_EVENTS } from "../src/init/claude-settings-merge.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-claude-substop-"));
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
    platform: "claude-code",
    track_id: "demo",
    track_title: "Demo",
    phase: "executing",
    paused: patch.paused ?? 0,
    armed: 1,
    checklist_path: "plans/demo/checklist.md",
  });
}

describe("Claude handleSubagentStop", () => {
  it("arms session_id parent when product dirty; never invents; returns {}", () => {
    const root = tmpRoot();
    try {
      const store = StateStore.openMemory(root);
      seed(store, "parent-a", { paused: 1 });
      // Claude often omits parent_* and puts the parent/root id in session_id.
      const out = handleSubagentStop(
        store,
        {
          session_id: "parent-a",
          modified_files: ["src/feature.ts"],
          status: "completed",
        },
        root,
      );
      expect(out).toEqual({});
      expect(store.getReviewChain("parent-a")?.code_edited).toBe(1);
      expect(store.getSession("parent-a")?.paused).toBe(1);
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("no-ops on missing parent session / ignored-only files", () => {
    const root = tmpRoot();
    try {
      fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
      fs.writeFileSync(path.join(root, ".autopilotignore"), ".claude/**\n");
      const store = StateStore.openMemory(root);
      seed(store, "parent-b");

      expect(
        handleSubagentStop(
          store,
          {
            session_id: "ghost",
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
            session_id: "parent-b",
            modified_files: [".claude/settings.json"],
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

  it("prefer explicit parent_* over session_id when distinct", () => {
    const root = tmpRoot();
    try {
      const store = StateStore.openMemory(root);
      seed(store, "parent-c");
      const out = handleSubagentStop(
        store,
        {
          session_id: "child-c",
          parent_session_id: "parent-c",
          modified_files: ["lib/x.ts"],
        },
        root,
      );
      expect(out).toEqual({});
      expect(store.getReviewChain("parent-c")?.code_edited).toBe(1);
      expect(store.getSession("child-c")).toBeNull();
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("empty modified_files without git dirty → no-op; blank parent_* falls back to session_id", () => {
    const root = tmpRoot();
    try {
      const store = StateStore.openMemory(root);
      seed(store, "parent-e");
      expect(
        handleSubagentStop(
          store,
          {
            session_id: "parent-e",
            modified_files: [],
          },
          root,
        ),
      ).toEqual({});
      expect(store.getReviewChain("parent-e")?.code_edited ?? 0).toBe(0);

      const out = handleSubagentStop(
        store,
        {
          session_id: "parent-e",
          parent_session_id: "   ",
          modified_files: ["src/z.ts"],
        },
        root,
      );
      expect(out).toEqual({});
      expect(store.getReviewChain("parent-e")?.code_edited).toBe(1);
      store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fail-open: null payload / mark throw → {}", () => {
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
      expect(
        handleSubagentStop(
          store,
          {
            session_id: "   ",
            modified_files: ["src/a.ts"],
          },
          root,
        ),
      ).toEqual({});
      expect(store.getReviewChain("parent-d")?.code_edited ?? 0).toBe(0);
      store.markCodeEdited = () => {
        throw new Error("forced mark failure");
      };
      expect(
        handleSubagentStop(
          store,
          {
            session_id: "parent-d",
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

  it("hook dispatch: claude stamp arms parent; stdout {}; never decision:block", () => {
    const root = tmpRoot();
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "claude-code",
          surface: "cli",
          locale: "en",
          force: false,
        }).ok,
      ).toBe(true);
      const settings = JSON.parse(
        fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"),
      ) as { hooks: Record<string, unknown> };
      for (const event of CLAUDE_AUTOPILOT_EVENTS) {
        expect(settings.hooks[event]).toBeDefined();
      }

      const seedStore = new StateStore(root);
      seed(seedStore, "parent-hook");
      seedStore.close();

      const proc = spawnSync(
        process.execPath,
        [
          path.join(root, ".autopilot", "bin", "autopilot-harness-hook.mjs"),
          "--platform",
          "claude-code",
          "--event",
          "SubagentStop",
        ],
        {
          cwd: root,
          input: JSON.stringify({
            session_id: "parent-hook",
            modified_files: ["src/feature.ts"],
            hook_event_name: "SubagentStop",
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
      expect(out.decision).toBeUndefined();
      expect(out.followup_message).toBeUndefined();

      const after = new StateStore(root);
      expect(after.getReviewChain("parent-hook")?.code_edited).toBe(1);
      after.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("hook dispatch: non-claude stamp does not arm parent", () => {
    const root = tmpRoot();
    try {
      expect(
        installInitYes({
          projectRoot: root,
          platform: "claude-code",
          surface: "cli",
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
          "cursor",
          "--event",
          "SubagentStop",
        ],
        {
          cwd: root,
          input: JSON.stringify({
            session_id: "parent-xf",
            modified_files: ["src/feature.ts"],
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
