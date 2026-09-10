import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MULTI_PLAN_EDIT_TRACK,
  extractPlansSlugFromPath,
  isBoundRunTrackId,
  notePlansDirEdit,
  StateStore,
} from "../src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-plans-bind-"));
}

describe("plans-bind", () => {
  let root: string;
  let store: StateStore;

  beforeEach(() => {
    root = tmpRoot();
    store = StateStore.openMemory(root);
  });
  afterEach(() => store.close());

  it("extractPlansSlugFromPath reads plans/<slug>/…", () => {
    expect(
      extractPlansSlugFromPath(
        path.join(root, "plans", "foo", "checklist.md"),
        root,
      ),
    ).toBe("foo");
    expect(
      extractPlansSlugFromPath(path.join(root, "src", "index.ts"), root),
    ).toBeNull();
  });

  it("isBoundRunTrackId rejects _pending and _multi", () => {
    expect(isBoundRunTrackId("demo")).toBe(true);
    expect(isBoundRunTrackId("_pending")).toBe(false);
    expect(isBoundRunTrackId(MULTI_PLAN_EDIT_TRACK)).toBe(false);
  });

  it("notePlansDirEdit binds first slug then dirties on second", () => {
    const a = path.join(root, "plans", "alpha", "plan.md");
    const b = path.join(root, "plans", "beta", "plan.md");
    fs.mkdirSync(path.dirname(a), { recursive: true });
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.writeFileSync(a, "# a\n");
    fs.writeFileSync(b, "# b\n");

    notePlansDirEdit(store, "c1", root, a);
    expect(store.getSession("c1")!.track_id).toBe("alpha");

    notePlansDirEdit(store, "c1", root, a);
    expect(store.getSession("c1")!.track_id).toBe("alpha");

    notePlansDirEdit(store, "c1", root, b);
    expect(store.getSession("c1")!.track_id).toBe(MULTI_PLAN_EDIT_TRACK);

    notePlansDirEdit(store, "c1", root, a);
    expect(store.getSession("c1")!.track_id).toBe(MULTI_PLAN_EDIT_TRACK);
  });

  it("notePlansDirEdit does not mutate track_id while executing", () => {
    const a = path.join(root, "plans", "alpha", "plan.md");
    const b = path.join(root, "plans", "beta", "plan.md");
    fs.mkdirSync(path.dirname(a), { recursive: true });
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.writeFileSync(a, "# a\n");
    fs.writeFileSync(b, "# b\n");
    store.upsertSession({
      conversation_id: "c-exec",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      track_id: "alpha",
      checklist_path: path.join(root, "plans", "alpha", "checklist.md"),
    });
    notePlansDirEdit(store, "c-exec", root, b);
    expect(store.getSession("c-exec")!.track_id).toBe("alpha");
    expect(store.getSession("c-exec")!.phase).toBe("executing");
  });

  it("notePlansDirEdit does not bind while mid-pick", () => {
    const a = path.join(root, "plans", "alpha", "plan.md");
    fs.mkdirSync(path.dirname(a), { recursive: true });
    fs.writeFileSync(a, "# a\n");
    store.upsertSession({
      conversation_id: "c-pick",
      project_root: root,
      code_root: root,
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "_pending",
      pending_action: "run",
      track_candidates_json: "[]",
      checklist_path: "",
    });
    notePlansDirEdit(store, "c-pick", root, a);
    expect(store.getSession("c-pick")!.track_id).toBe("_pending");
    expect(store.getSession("c-pick")!.pending_action).toBe("run");
  });
});
