import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MULTI_PLAN_EDIT_TRACK,
  applyRun,
  extractPlansSlugFromPath,
  isBoundRunTrackId,
  isProductCodeEdit,
  notePlansDirEdit,
  StateStore,
} from "../src/index.js";
import { handleAfterFileEdit } from "../../ports/cursor/src/index.js";
import { handlePostToolUse } from "../../ports/claude-code/src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-plans-bind-"));
}

function writePlanFile(root: string, slug: string, name: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, `# ${slug}\n`);
  return fp;
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
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
    const a = writePlanFile(root, "alpha", "plan.md");
    const b = writePlanFile(root, "beta", "plan.md");

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
    const b = writePlanFile(root, "beta", "plan.md");
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
    const a = writePlanFile(root, "alpha", "plan.md");
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

  it("bind-plans-dedicated-path: Cursor afterFileEdit binds without product-code gate", () => {
    const a = writePlanFile(root, "alpha", "checklist.md");
    const b = writePlanFile(root, "beta", "plan.md");
    // Contract: plans/** are ignored for product-code / review arming.
    expect(isProductCodeEdit(a, { projectRoot: root })).toBe(false);
    expect(isProductCodeEdit(b, { projectRoot: root })).toBe(false);

    handleAfterFileEdit(
      store,
      { conversation_id: "cur-1", file_path: a },
      root,
    );
    expect(store.getSession("cur-1")!.track_id).toBe("alpha");
    expect(store.getReviewChain("cur-1")?.code_edited ?? 0).toBe(0);

    handleAfterFileEdit(
      store,
      { conversation_id: "cur-1", file_path: b },
      root,
    );
    expect(store.getSession("cur-1")!.track_id).toBe(MULTI_PLAN_EDIT_TRACK);
    expect(store.getReviewChain("cur-1")?.code_edited ?? 0).toBe(0);
  });

  it("bind-plans-dedicated-path: relative plans path still binds (Cursor-shaped)", () => {
    writePlanFile(root, "alpha", "plan.md");
    expect(
      isProductCodeEdit("plans/alpha/plan.md", { projectRoot: root }),
    ).toBe(false);
    handleAfterFileEdit(
      store,
      { conversation_id: "rel-1", file_path: "plans/alpha/plan.md" },
      root,
    );
    expect(store.getSession("rel-1")!.track_id).toBe("alpha");
  });

  it("bind-plans-dedicated-path: non-plans and unsafe slug paths do not bind", () => {
    expect(
      extractPlansSlugFromPath(path.join(root, "src", "app.ts"), root),
    ).toBeNull();
    expect(extractPlansSlugFromPath("plans/Not_Safe/plan.md", root)).toBeNull();

    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "app.ts"), "export {}\n");
    handleAfterFileEdit(
      store,
      { conversation_id: "skip-1", file_path: path.join(root, "src", "app.ts") },
      root,
    );
    // Product edits may ambient-create a session — but must not plans-bind a slug.
    expect(
      isBoundRunTrackId(store.getSession("skip-1")?.track_id ?? null),
    ).toBe(false);

    handleAfterFileEdit(
      store,
      { conversation_id: "skip-2", file_path: "plans/Not_Safe/plan.md" },
      root,
    );
    expect(store.getSession("skip-2")).toBeFalsy();
  });

  it("bind-plans-dedicated-path: Claude PostToolUse binds without product-code gate", () => {
    const a = writePlanFile(root, "alpha", "plan.md");
    const b = writePlanFile(root, "beta", "brief.md");
    expect(isProductCodeEdit(a, { projectRoot: root })).toBe(false);

    handlePostToolUse(
      store,
      {
        session_id: "cl-1",
        tool_name: "Edit",
        tool_input: { file_path: a },
      },
      root,
    );
    expect(store.getSession("cl-1")!.track_id).toBe("alpha");
    expect(store.getReviewChain("cl-1")?.code_edited ?? 0).toBe(0);

    handlePostToolUse(
      store,
      {
        session_id: "cl-1",
        tool_name: "Write",
        tool_input: { file_path: b },
      },
      root,
    );
    expect(store.getSession("cl-1")!.track_id).toBe(MULTI_PLAN_EDIT_TRACK);
  });

  it("bind-plans-dedicated-path: single bound slug auto-runs on bare RUN amid multi runnable", () => {
    writeChecklist(root, "alpha", `- [ ] a — A\n`);
    writeChecklist(root, "beta", `- [ ] b — B\n`);
    const a = path.join(root, "plans", "alpha", "plan.md");
    handleAfterFileEdit(
      store,
      { conversation_id: "bind-run", file_path: a },
      root,
    );
    expect(store.getSession("bind-run")!.track_id).toBe("alpha");

    const r = applyRun(store, "bind-run", root);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.track_id).toBe("alpha");
      expect(r.session.phase).toBe("executing");
      expect(r.session.armed).toBe(1);
    }
  });
});
