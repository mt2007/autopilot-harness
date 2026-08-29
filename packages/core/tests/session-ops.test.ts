import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state-store.js";

function seed(
  store: StateStore,
  id: string,
  patch: Partial<{
    track_id: string;
    track_title: string;
    session_title: string;
    phase: "idle" | "planning" | "executing" | "done";
    paused: number;
  }> = {},
): void {
  store.upsertSession({
    conversation_id: id,
    project_root: store.projectRoot,
    code_root: store.projectRoot,
    platform: "cursor",
    track_id: patch.track_id ?? "demo",
    track_title: patch.track_title ?? "Demo track",
    session_title: patch.session_title ?? null,
    phase: patch.phase ?? "planning",
    paused: patch.paused ?? 0,
    armed: 0,
    checklist_path: "plans/demo/checklist.md",
  });
}

describe("StateStore session ops", () => {
  it("lists sessions", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-list");
    seed(store, "aaa-1111-bbbb-cccc-ddddeeee0001", { session_title: "Old" });
    seed(store, "aaa-1111-bbbb-cccc-ddddeeee0002", { session_title: "New" });
    const rows = store.listSessions();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.conversation_id).sort()).toEqual([
      "aaa-1111-bbbb-cccc-ddddeeee0001",
      "aaa-1111-bbbb-cccc-ddddeeee0002",
    ]);
    store.close();
  });

  it("resolves exact and unique prefix ids", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-resolve");
    const id = "abcdef12-3456-7890-abcd-ef1234567890";
    seed(store, id);
    expect(store.resolveSessionId(id)).toEqual({ ok: true, id });
    expect(store.resolveSessionId("abcdef12")).toEqual({ ok: true, id });
    expect(store.resolveSessionId("nope").ok).toBe(false);
    expect(store.resolveSessionId("   ").ok).toBe(false);
    expect(store.resolveSessionId("ab\ncd").ok).toBe(false);
    store.close();
  });

  it("rejects ambiguous prefixes", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-ambig");
    seed(store, "abcdef12-aaaa-bbbb-cccc-111111111111");
    seed(store, "abcdef12-aaaa-bbbb-cccc-222222222222");
    const r = store.resolveSessionId("abcdef12");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ambiguous/i);
    store.close();
  });

  it("renames with source=user", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-rename");
    const id = "ren-1111-2222-3333-444455556666";
    seed(store, id, { session_title: "Platform name" });
    const row = store.renameSession(id, "My custom title");
    expect(row).not.toBeNull();
    expect(row!.session_title).toBe("My custom title");
    expect(row!.session_title_source).toBe("user");
    expect(row!.title_updated_at).toBeTruthy();
    expect(() => store.renameSession(id, "  ")).toThrow(/non-empty/i);
    expect(() => store.renameSession(id, "x".repeat(201))).toThrow(/200/);
    expect(() => store.renameSession(id, "bad\ntitle")).toThrow(/control/i);
    expect(store.getSession(id)!.session_title).toBe("My custom title");
    store.close();
  });

  it("INSERT persists title fields; user titles survive platform upsert", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-title-guard");
    const id = "ttl-1111-2222-3333-444455556666";
    store.upsertSession({
      conversation_id: id,
      project_root: store.projectRoot,
      code_root: store.projectRoot,
      session_title: "From platform",
      session_title_source: "platform",
      track_title: "Track A",
      track_id: "track-a",
      checklist_path: "plans/track-a/checklist.md",
      armed: 0,
    });
    const inserted = store.getSession(id)!;
    expect(inserted.session_title).toBe("From platform");
    expect(inserted.session_title_source).toBe("platform");
    expect(inserted.track_title).toBe("Track A");

    store.renameSession(id, "User wins");
    store.upsertSession({
      conversation_id: id,
      project_root: store.projectRoot,
      code_root: store.projectRoot,
      session_title: "Platform overwrite attempt",
      session_title_source: "platform",
      phase: "executing",
    });
    const guarded = store.getSession(id)!;
    expect(guarded.session_title).toBe("User wins");
    expect(guarded.session_title_source).toBe("user");
    expect(guarded.phase).toBe("executing");

    // Spread-style upsert that re-carries source=user must still not clobber.
    store.upsertSession({
      ...guarded,
      conversation_id: id,
      project_root: store.projectRoot,
      code_root: store.projectRoot,
      session_title: "Spread clobber attempt",
    });
    expect(store.getSession(id)!.session_title).toBe("User wins");

    // Stale in-memory "platform" merge must not win if row is already source=user
    // (simulates upsert that read before rename, writes after rename).
    store.upsertSession({
      conversation_id: id,
      project_root: store.projectRoot,
      code_root: store.projectRoot,
      session_title: "Late platform write",
      session_title_source: "platform",
      title_updated_at: "2000-01-01T00:00:00.000Z",
      phase: "planning",
    });
    const afterLate = store.getSession(id)!;
    expect(afterLate.session_title).toBe("User wins");
    expect(afterLate.session_title_source).toBe("user");
    expect(afterLate.phase).toBe("planning");
    store.close();
  });

  it("upsert cannot grant source=user (renameSession only)", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-no-elevate");
    const id = "elv-1111-2222-3333-444455556666";
    store.upsertSession({
      conversation_id: id,
      project_root: store.projectRoot,
      code_root: store.projectRoot,
      session_title: "Claim user",
      session_title_source: "user",
      track_id: "t",
      checklist_path: "plans/t/checklist.md",
      armed: 0,
    });
    expect(store.getSession(id)!.session_title_source).toBe("platform");
    store.upsertSession({
      conversation_id: id,
      project_root: store.projectRoot,
      code_root: store.projectRoot,
      session_title: "Still claim",
      session_title_source: "user",
    });
    expect(store.getSession(id)!.session_title_source).toBe("platform");
    expect(store.getSession(id)!.session_title).toBe("Still claim");
    store.close();
  });

  it("purges session and review chain", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-purge");
    const id = "pur-1111-2222-3333-444455556666";
    seed(store, id);
    store.ensureReviewChain(id);
    store.updateReviewChain(id, { fix_round: 2, chain_pending: 1 });
    expect(store.purgeSession(id)).toBe(true);
    expect(store.getSession(id)).toBeNull();
    expect(store.getReviewChain(id)).toBeNull();
    expect(store.purgeSession(id)).toBe(false);
    store.close();
  });

  it("purgeSession ifRow guard skips delete when predicate fails", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-purge-if");
    const id = "pif-1111-2222-3333-444455556666";
    seed(store, id);
    store.upsertSession({
      conversation_id: id,
      project_root: store.projectRoot,
      code_root: store.projectRoot,
      armed: 1,
      phase: "executing",
    });
    expect(
      store.purgeSession(id, (row) => row.armed !== 1),
    ).toBe(false);
    expect(store.getSession(id)).not.toBeNull();
    expect(
      store.purgeSession(id, (row) => row.armed === 1),
    ).toBe(true);
    expect(store.getSession(id)).toBeNull();
    store.close();
  });

  it("resetReviewChain clears review fields like REPLAN", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-reset");
    const id = "rst-1111-2222-3333-444455556666";
    seed(store, id);
    store.updateReviewChain(id, {
      fix_round: 3,
      confirm_left: 2,
      chain_pending: 1,
      code_edited: 1,
      item_confirm_complete: 1,
    });
    expect(store.resetReviewChain(id)).toBe(true);
    const chain = store.getReviewChain(id)!;
    expect(chain.fix_round).toBe(0);
    expect(chain.confirm_left).toBeNull();
    expect(chain.chain_pending).toBe(0);
    expect(chain.code_edited).toBe(0);
    expect(chain.item_confirm_complete).toBe(0);
    expect(store.getSession(id)).not.toBeNull();
    expect(store.resetReviewChain("missing-id")).toBe(false);
    store.close();
  });

  it("resetReviewChain does not create orphan chain without session", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-reset-orphan");
    const id = "orp-1111-2222-3333-444455556666";
    seed(store, id);
    store.ensureReviewChain(id);
    expect(store.purgeSession(id)).toBe(true);
    expect(store.resetReviewChain(id)).toBe(false);
    expect(store.getReviewChain(id)).toBeNull();
    store.close();
  });
});
