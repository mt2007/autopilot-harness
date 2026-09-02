import { describe, expect, it, vi } from "vitest";
import path from "node:path";
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
  it("normalizes padded projectRoot before path.resolve (avoids cwd-relative abs)", () => {
    const padded = "  /tmp/ap-sess-pad  ";
    const store = StateStore.openMemory(padded);
    expect(store.projectRoot).toBe(path.resolve("/tmp/ap-sess-pad"));
    store.close();
  });

  it("rejects blank / NUL projectRoot", () => {
    expect(() => StateStore.openMemory("   ")).toThrow(/Invalid project root/i);
    expect(() => StateStore.openMemory("bad\0root")).toThrow(
      /Invalid project root/i,
    );
  });

  it("upsertSession normalizes padded project_root / code_root", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-upsert-pad");
    const row = store.upsertSession({
      conversation_id: "c-pad",
      project_root: "  /tmp/ap-sess-upsert-pad  ",
      code_root: "  /tmp/ap-sess-upsert-pad  ",
      platform: "cursor",
      phase: "idle",
      armed: 0,
      paused: 0,
      track_id: "_pending",
      checklist_path: "",
    });
    expect(row.project_root).toBe(store.projectRoot);
    expect(row.code_root).toBe(store.projectRoot);
    // NUL / blank fall back to store.projectRoot (heal, do not poison DB).
    const healed = store.upsertSession({
      conversation_id: "c-pad",
      project_root: "bad\0root",
      code_root: "   ",
      phase: "planning",
    });
    expect(healed.project_root).toBe(store.projectRoot);
    expect(healed.code_root).toBe(store.projectRoot);
    store.close();
  });

  it("upsertSession pins escaping project_root; allows in-project code_root", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-pin-root");
    const outside = "/tmp/ap-sess-evil-outside";
    const row = store.upsertSession({
      conversation_id: "c-esc",
      project_root: outside,
      code_root: outside,
      platform: "cursor",
      phase: "idle",
      armed: 0,
      paused: 0,
      track_id: "_pending",
      checklist_path: "",
    });
    expect(row.project_root).toBe(store.projectRoot);
    expect(row.code_root).toBe(store.projectRoot);
    const wt = path.join(store.projectRoot, "worktrees", "s1");
    const withWt = store.upsertSession({
      conversation_id: "c-esc",
      project_root: store.projectRoot,
      code_root: wt,
      phase: "executing",
    });
    expect(withWt.project_root).toBe(store.projectRoot);
    expect(withWt.code_root).toBe(wt);
    // Relative code_root resolves against store (not cwd).
    const rel = store.upsertSession({
      conversation_id: "c-esc",
      project_root: store.projectRoot,
      code_root: "worktrees/s2",
      phase: "executing",
    });
    expect(rel.code_root).toBe(path.join(store.projectRoot, "worktrees", "s2"));
    store.close();
  });

  it("upsertSession clears checklist_path that escapes the store project", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-cl-pin");
    const outside = "/tmp/ap-sess-cl-evil/checklist.md";
    const row = store.upsertSession({
      conversation_id: "c-cl",
      project_root: store.projectRoot,
      code_root: store.projectRoot,
      platform: "cursor",
      phase: "idle",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: outside,
    });
    expect(row.checklist_path).toBe("");
    const rel = store.upsertSession({
      conversation_id: "c-cl",
      project_root: store.projectRoot,
      code_root: store.projectRoot,
      checklist_path: "plans/demo/checklist.md",
    });
    expect(rel.checklist_path).toBe("plans/demo/checklist.md");
    store.close();
  });

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
      pending_followup: "Review confirm 1/5 — stale",
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: new Date().toISOString(),
    });
    expect(store.resetReviewChain(id)).toBe(true);
    const chain = store.getReviewChain(id)!;
    expect(chain.fix_round).toBe(0);
    expect(chain.confirm_left).toBeNull();
    expect(chain.chain_pending).toBe(0);
    expect(chain.code_edited).toBe(0);
    expect(chain.item_confirm_complete).toBe(0);
    expect(chain.pending_followup).toBeNull();
    expect(chain.pending_followup_at).toBeNull();
    expect(chain.pending_redeliver_at).toBeNull();
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

  it("ensureReviewChain rejects invalid id and missing session", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-ensure-guard");
    expect(() => store.ensureReviewChain("")).toThrow(/Invalid conversation id/);
    expect(() => store.ensureReviewChain("   ")).toThrow(/Invalid conversation id/);
    expect(() => store.ensureReviewChain(" padded ")).toThrow(/Invalid conversation id/);
    expect(() => store.ensureReviewChain("bad\0id")).toThrow(/Invalid conversation id/);
    expect(() =>
      store.ensureReviewChain("mis-1111-2222-3333-444455556666"),
    ).toThrow(/No session for conversation/);
    expect(() =>
      store.updateReviewChain("mis-1111-2222-3333-444455556666", {
        chain_pending: 1,
      }),
    ).toThrow(/No session for conversation/);

    // Orphan chain row without a session must not be returned/updated.
    const orphanId = "orp-1111-2222-3333-444455556666";
    store.db
      .prepare(
        `INSERT INTO review_chains (conversation_id, fix_round, confirm_left, chain_pending, code_edited, item_confirm_complete, updated_at)
         VALUES (?, 0, NULL, 0, 0, 0, ?)`,
      )
      .run(orphanId, new Date().toISOString());
    expect(() => store.ensureReviewChain(orphanId)).toThrow(/No session for conversation/);
    expect(store.getReviewChain(orphanId)).toBeNull();
    expect(() =>
      store.updateReviewChain(orphanId, { chain_pending: 1 }),
    ).toThrow(/No session for conversation/);
    expect(store.getReviewChain(orphanId)).toBeNull();

    // Idempotent when session exists (concurrent INSERT OR IGNORE path).
    const id = "ok-1111-2222-3333-444455556666";
    seed(store, id);
    const a = store.ensureReviewChain(id);
    const b = store.ensureReviewChain(id);
    expect(a.conversation_id).toBe(id);
    expect(b.conversation_id).toBe(id);

    // Atomic orphan DELETE must not wipe a chain once a session exists again.
    store.db
      .prepare(
        `DELETE FROM review_chains
         WHERE conversation_id = ?
           AND NOT EXISTS (SELECT 1 FROM sessions WHERE conversation_id = ?)`,
      )
      .run(id, id);
    expect(store.getReviewChain(id)).not.toBeNull();

    // Retry path: session remains but chain row was deleted → recreate.
    store.db
      .prepare(`DELETE FROM review_chains WHERE conversation_id = ?`)
      .run(id);
    expect(store.getReviewChain(id)).toBeNull();
    const recreated = store.ensureReviewChain(id);
    expect(recreated.conversation_id).toBe(id);
    expect(store.getReviewChain(id)).not.toBeNull();

    expect(() => store.ensureReviewChain("bad\nid")).toThrow(
      /Invalid conversation id/,
    );
    expect(() =>
      store.upsertSession({
        conversation_id: "bad\nid",
        project_root: store.projectRoot,
        code_root: store.projectRoot,
      }),
    ).toThrow(/Invalid conversation id/);
    expect(() =>
      store.upsertSession({
        conversation_id: " padded ",
        project_root: store.projectRoot,
        code_root: store.projectRoot,
      }),
    ).toThrow(/Invalid conversation id/);
    store.close();
  });

  it("clearChainPending is column-only and no-ops without a chain row", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-clear-pending");
    const id = "clr-1111-2222-3333-444455556666";
    // No session / no chain → must not insert an orphan review_chains row.
    store.clearChainPending(id);
    expect(store.getReviewChain(id)).toBeNull();

    seed(store, id);
    store.updateReviewChain(id, {
      chain_pending: 1,
      confirm_left: 3,
      fix_round: 7,
      pending_followup: "Review confirm keep-me",
      pending_followup_at: "2026-01-01T00:00:00.000Z",
      pending_redeliver_at: "2026-01-01T00:00:01.000Z",
      code_edited: 1,
      item_confirm_complete: 1,
    });
    store.clearChainPending(id);
    const chain = store.getReviewChain(id)!;
    expect(chain.chain_pending).toBe(0);
    expect(chain.confirm_left).toBe(3);
    expect(chain.fix_round).toBe(7);
    expect(chain.pending_followup).toBe("Review confirm keep-me");
    expect(chain.pending_followup_at).toBe("2026-01-01T00:00:00.000Z");
    expect(chain.pending_redeliver_at).toBe("2026-01-01T00:00:01.000Z");
    expect(chain.code_edited).toBe(1);
    expect(chain.item_confirm_complete).toBe(1);
    store.close();
  });

  it("setPendingRedeliverHold is column-only (no confirm/pending clobber)", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-redeliver-hold");
    const id = "hold-1111-2222-3333-444455556666";
    store.setPendingRedeliverHold(id, "2026-01-01T00:00:09.000Z");
    expect(store.getReviewChain(id)).toBeNull();

    seed(store, id);
    store.updateReviewChain(id, {
      chain_pending: 1,
      confirm_left: 2,
      fix_round: 4,
      pending_followup: "自审确认 2/5（空值）",
      pending_followup_at: "2026-01-01T00:00:00.000Z",
      code_edited: 0,
      item_confirm_complete: 1,
    });
    store.setPendingRedeliverHold(id, "2026-01-01T00:00:09.000Z");
    const chain = store.getReviewChain(id)!;
    expect(chain.pending_redeliver_at).toBe("2026-01-01T00:00:09.000Z");
    expect(chain.chain_pending).toBe(0);
    expect(chain.confirm_left).toBe(2);
    expect(chain.pending_followup).toBe("自审确认 2/5（空值）");
    expect(chain.fix_round).toBe(4);
    expect(chain.item_confirm_complete).toBe(1);
    // Blank / NUL must no-op (do not clear a live hold with junk).
    store.setPendingRedeliverHold(id, "");
    store.setPendingRedeliverHold(id, "bad\0stamp");
    expect(store.getReviewChain(id)!.pending_redeliver_at).toBe(
      "2026-01-01T00:00:09.000Z",
    );
    store.clearPendingRedeliverHold(id);
    const cleared = store.getReviewChain(id)!;
    expect(cleared.pending_redeliver_at).toBeNull();
    expect(cleared.pending_followup).toBe("自审确认 2/5（空值）");
    expect(cleared.confirm_left).toBe(2);

    // Stamp-guarded clear: only the owning claim stamp may drop the hold.
    store.setPendingRedeliverHold(id, "2026-01-01T00:00:09.000Z");
    store.updateReviewChain(id, {
      pending_followup: "Recover: peer",
      pending_followup_at: "2026-01-01T00:00:01.000Z",
    });
    expect(
      store.clearPendingRedeliverHoldIfStamp(id, "2026-01-01T00:00:99.000Z"),
    ).toBe(false);
    expect(store.getReviewChain(id)!.pending_redeliver_at).toBe(
      "2026-01-01T00:00:09.000Z",
    );
    expect(
      store.clearPendingRedeliverHoldIfStamp(id, "2026-01-01T00:00:01.000Z"),
    ).toBe(true);
    expect(store.getReviewChain(id)!.pending_redeliver_at).toBeNull();
    expect(store.getReviewChain(id)!.pending_followup).toBe("Recover: peer");
    store.close();
  });

  it("savePendingFollowup ignores blank messages", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-blank-pending");
    const id = "blk-1111-2222-3333-444455556666";
    seed(store, id);
    store.ensureReviewChain(id);
    store.savePendingFollowup(id, "   ");
    expect(store.getReviewChain(id)!.pending_followup).toBeNull();
    store.savePendingFollowup(id, "\0");
    expect(store.getReviewChain(id)!.pending_followup).toBeNull();
    store.savePendingFollowup(id, "ok\0evil");
    expect(store.getReviewChain(id)!.pending_followup).toBeNull();
    store.savePendingFollowup(id, "Review confirm 1/5");
    expect(store.getReviewChain(id)!.pending_followup).toBe("Review confirm 1/5");
    store.close();
  });

  it("savePendingFollowup advances stamp ≥1ms on same-ms collision", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-stamp-bump");
    const id = "stb-1111-2222-3333-444455556666";
    seed(store, id);
    const frozen = "2026-06-15T12:00:00.000Z";
    store.updateReviewChain(id, {
      pending_followup: "Recover: first",
      pending_followup_at: frozen,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(frozen));
    try {
      store.savePendingFollowup(id, "Recover: peer refresh", { armChain: false });
      const at = store.getReviewChain(id)!.pending_followup_at!;
      expect(at).not.toBe(frozen);
      expect(Date.parse(at)).toBe(Date.parse(frozen) + 1);
      expect(store.getReviewChain(id)!.pending_followup).toBe(
        "Recover: peer refresh",
      );
    } finally {
      vi.useRealTimers();
    }
    store.close();
  });

  it("clearPendingFollowupIf only clears when live pending still matches", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-clear-if");
    const id = "cif-1111-2222-3333-444455556666";
    seed(store, id);
    store.ensureReviewChain(id);
    store.savePendingFollowup(id, "恢复：上一回合出错。继续。");
    expect(
      store.clearPendingFollowupIf(id, (m) => m.startsWith("恢复：")),
    ).toBe(true);
    expect(store.getReviewChain(id)!.pending_followup).toBeNull();

    store.savePendingFollowup(id, "自审确认 2/5 — 角度");
    expect(
      store.clearPendingFollowupIf(id, (m) => m.startsWith("恢复：")),
    ).toBe(false);
    expect(store.getReviewChain(id)!.pending_followup).toBe(
      "自审确认 2/5 — 角度",
    );

    // Re-check under exclusiveWrite: concurrent replace must not wipe confirm.
    store.exclusiveWrite(() => {
      store.savePendingFollowup(id, "恢复：stale snapshot");
      // Simulate "stale pred true" then live row already swapped to confirm:
      store.savePendingFollowup(id, "自审确认 3/5");
      const cleared = store.clearPendingFollowupIf(id, (m) =>
        m.startsWith("恢复："),
      );
      expect(cleared).toBe(false);
      return { commit: true, value: undefined };
    });
    expect(store.getReviewChain(id)!.pending_followup).toBe("自审确认 3/5");

    store.savePendingFollowup(id, "恢复：keep on pred throw");
    expect(
      store.clearPendingFollowupIf(id, () => {
        throw new Error("hostile pred");
      }),
    ).toBe(false);
    expect(store.getReviewChain(id)!.pending_followup).toBe(
      "恢复：keep on pred throw",
    );

    expect(
      store.clearPendingFollowupIf(id, () =>
        Promise.resolve(true) as unknown as boolean,
      ),
    ).toBe(false);
    expect(store.getReviewChain(id)!.pending_followup).toBe(
      "恢复：keep on pred throw",
    );
    store.close();
  });

  it("updateReviewChain clears blank/NUL pending_followup", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-nul-pending-merge");
    const id = "nul-1111-2222-3333-444455556666";
    seed(store, id);
    store.updateReviewChain(id, {
      pending_followup: "ok\0evil",
      pending_followup_at: "2026-01-01T00:00:00.000Z",
      chain_pending: 1,
    });
    const chain = store.getReviewChain(id)!;
    expect(chain.pending_followup).toBeNull();
    expect(chain.pending_followup_at).toBeNull();
    expect(chain.pending_redeliver_at).toBeNull();
    expect(chain.chain_pending).toBe(0);

    store.updateReviewChain(id, {
      pending_followup: "   ",
      chain_pending: 1,
      confirm_left: 2,
    });
    const blank = store.getReviewChain(id)!;
    expect(blank.pending_followup).toBeNull();
    expect(blank.chain_pending).toBe(0);
    expect(blank.confirm_left).toBe(2);
    store.close();
  });

  it("markCodeEdited / setChainPending do not create orphan chains", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-no-orphan-edit");
    const missing = "mis-1111-2222-3333-444455556666";
    store.markCodeEdited(missing);
    store.setChainPending(missing);
    store.savePendingFollowup(missing, "Review confirm orphan?");
    expect(store.getReviewChain(missing)).toBeNull();

    const id = "edt-1111-2222-3333-444455556666";
    seed(store, id);
    store.markCodeEdited(id);
    expect(store.getReviewChain(id)!.code_edited).toBe(1);
    store.setChainPending(id);
    expect(store.getReviewChain(id)!.chain_pending).toBe(1);
    store.close();
  });

  it("markCodeEdited is reentrant inside exclusiveWrite (no nest throw)", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-reentrant-edit");
    const id = "ren-1111-2222-3333-444455556666";
    seed(store, id);
    expect(() =>
      store.exclusiveWrite(() => {
        store.markCodeEdited(id);
        store.setChainPending(id);
        store.savePendingFollowup(id, "Review confirm nested");
        store.touchPendingRedeliver(id);
        return { commit: true, value: true };
      }),
    ).not.toThrow();
    const chain = store.getReviewChain(id)!;
    expect(chain.code_edited).toBe(1);
    expect(chain.chain_pending).toBe(1);
    expect(chain.pending_followup).toBe("Review confirm nested");
    expect(chain.pending_redeliver_at).toBeTruthy();
    store.close();
  });

  it("disarmSession halts without clobbering error_count", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-disarm");
    const id = "dis-1111-2222-3333-444455556666";
    seed(store, id);
    store.upsertSession({
      conversation_id: id,
      project_root: "/tmp/ap-sess-disarm",
      code_root: "/tmp/ap-sess-disarm",
      armed: 1,
      paused: 0,
      error_count: 2,
    });
    store.disarmSession(id);
    const s = store.getSession(id)!;
    expect(s.armed).toBe(0);
    expect(s.paused).toBe(1);
    expect(s.paused_reason).toBe("repeated_errors");
    expect(s.error_count).toBe(2);
    store.disarmSession("bad\nid");
    expect(store.getSession(id)!.armed).toBe(0);

    // Must not overwrite an existing pause reason (richer pause / concurrent stuck).
    store.upsertSession({
      conversation_id: id,
      project_root: "/tmp/ap-sess-disarm",
      code_root: "/tmp/ap-sess-disarm",
      armed: 1,
      paused: 1,
      paused_reason: "stuck",
      error_count: 2,
    });
    store.disarmSession(id);
    const kept = store.getSession(id)!;
    expect(kept.armed).toBe(0);
    expect(kept.paused).toBe(1);
    expect(kept.paused_reason).toBe("stuck");
    store.close();
  });

  it("touchPendingRedeliver does not resurrect chain_pending without pending", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-touch-pending");
    const id = "tch-1111-2222-3333-444455556666";
    seed(store, id);
    store.ensureReviewChain(id);
    store.neutralizeReviewChain(id);
    expect(store.getReviewChain(id)!.pending_followup).toBeNull();
    expect(store.getReviewChain(id)!.chain_pending).toBe(0);
    store.touchPendingRedeliver(id);
    const chain = store.getReviewChain(id)!;
    expect(chain.chain_pending).toBe(0);
    expect(chain.pending_redeliver_at).toBeNull();
    store.close();
  });

  it("touchPendingRedeliver keeps recover/stuck pending disarmed", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-touch-recover");
    const id = "tch-aaaa-bbbb-cccc-ddddeeeeffff";
    seed(store, id);
    store.ensureReviewChain(id);
    store.updateReviewChain(id, {
      pending_followup:
        "Recover: the previous turn ended with an error. Continue.",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
    });
    store.touchPendingRedeliver(id);
    expect(store.getReviewChain(id)!.chain_pending).toBe(0);
    expect(store.getReviewChain(id)!.pending_redeliver_at).toBeTruthy();

    store.updateReviewChain(id, {
      pending_followup: "卡住：连续多轮无进展。",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      pending_redeliver_at: null,
    });
    store.touchPendingRedeliver(id);
    expect(store.getReviewChain(id)!.chain_pending).toBe(0);
    store.close();
  });

  it("touchPendingRedeliver keeps done/review_complete pending disarmed", () => {
    const store = StateStore.openMemory("/tmp/ap-sess-touch-terminal");
    const id = "tch-1111-aaaa-bbbb-ccccddddeeee";
    seed(store, id);
    store.ensureReviewChain(id);
    store.updateReviewChain(id, {
      pending_followup:
        "All checklist items done. Confirm chain passed. Phase is done.",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
    });
    store.touchPendingRedeliver(id);
    expect(store.getReviewChain(id)!.chain_pending).toBe(0);

    store.updateReviewChain(id, {
      pending_followup:
        "Review complete. All 5 confirm rounds passed; the review chain has ended.",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      pending_redeliver_at: null,
    });
    store.touchPendingRedeliver(id);
    expect(store.getReviewChain(id)!.chain_pending).toBe(0);

    store.updateReviewChain(id, {
      pending_followup: "自审完成。连续 5 轮确认已通过，自审链已结束。",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      pending_redeliver_at: null,
    });
    store.touchPendingRedeliver(id);
    expect(store.getReviewChain(id)!.chain_pending).toBe(0);

    // E5/E0 advance stays disarmed: product edits re-arm via afterFileEdit.
    // Re-arming here would phantom-E3 after the Advance tip is answered.
    store.updateReviewChain(id, {
      pending_followup:
        "Advance checklist: confirm chain passed cleanly. Implement next: a — A.",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 0,
      pending_redeliver_at: null,
    });
    store.touchPendingRedeliver(id);
    expect(store.getReviewChain(id)!.chain_pending).toBe(0);

    store.updateReviewChain(id, {
      pending_followup: "推进下一项：自审确认已干净通过。然后实现下一项：a — A。",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 0,
      pending_redeliver_at: null,
    });
    store.touchPendingRedeliver(id);
    expect(store.getReviewChain(id)!.chain_pending).toBe(0);
    store.close();
  });
});
