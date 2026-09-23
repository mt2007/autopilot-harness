import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyOff,
  applyOn,
  applyResume,
  applyResumeReview,
  canEnterExecuting,
  countUnchecked,
  evaluateVerifyReport,
  firstUnchecked,
  getCurrentSchemaVersion,
  getLatestSchemaVersion,
  isHarnessFollowupMessage,
  isLastUnchecked,
  isProductCodeEdit,
  isRealpathInsideProject,
  isRecoverOrStuckFollowupMessage,
  isRunnableTrack,
  listTracks,
  migrate,
  parseChecklist,
  parseSchemaVersionValue,
  parseTrigger,
  readTranscriptTail,
  automationFollowupPresent,
  ReviewEngine,
  StateStore,
  type FollowupAction,
} from "../src/index.js";
import {
  handleAfterFileEdit,
  handleBeforeSubmitPrompt,
  handleStop,
} from "../../ports/cursor/src/index.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-p0-"));
}

function writeChecklist(root: string, slug: string, body: string): string {
  const dir = path.join(root, "plans", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
  const cp = path.join(dir, "checklist.md");
  fs.writeFileSync(cp, body);
  return cp;
}

function sessionExecuting(
  store: StateStore,
  root: string,
  cid: string,
  checklistPath: string,
  opts?: { armed?: number; paused?: number; paused_reason?: string | null },
) {
  return store.upsertSession({
    conversation_id: cid,
    project_root: root,
    code_root: root,
    platform: "cursor",
    phase: "executing",
    armed: opts?.armed ?? 1,
    paused: opts?.paused ?? 0,
    paused_reason: opts?.paused_reason ?? null,
    track_id: "demo",
    checklist_path: checklistPath,
  });
}

function engine(store: StateStore, root: string, overrides?: Partial<ConstructorParameters<typeof ReviewEngine>[1]>) {
  return new ReviewEngine(store, {
    confirmRounds: 5,
    reviewScope: "executing_only",
    verifyEnabled: false,
    verifyCommands: [],
    maxIdleStops: 5,
    maxErrorsBeforePause: 3,
    projectRoot: root,
    // Unit tests skip wall-clock recover debounce unless overridden.
    recoverDebounceMs: 0,
    ...overrides,
  });
}

function stop(
  eng: ReviewEngine,
  cid: string,
  loopCount = 1,
): FollowupAction | null {
  return eng.handleStop({ conversationId: cid, status: "completed", loopCount });
}

describe("F-CM ChecklistMd", () => {
  it("parses id — title and slugifies without separator", () => {
    const root = tmpRoot();
    const cp = writeChecklist(
      root,
      "demo",
      `## Executing\n\n- [ ] add-model — Add Comment model\n- [ ] UI component without sep\n- [x] done-item — Done\n`,
    );
    const cl = parseChecklist(cp);
    expect(cl.items).toHaveLength(3);
    expect(cl.items[0]!.id).toBe("add-model");
    expect(cl.items[0]!.idFromSeparator).toBe(true);
    expect(cl.items[1]!.id).toBe("ui-component-without-sep");
    expect(cl.items[1]!.idFromSeparator).toBe(false);
    expect(countUnchecked(cl)).toBe(2);
    expect(firstUnchecked(cl)!.id).toBe("add-model");
    expect(isLastUnchecked(cl)).toBe(false);
  });
});

describe("F-VR verify-report", () => {
  it("fails on missing/bad/mismatch; skips when no required", () => {
    const root = tmpRoot();
    const cp = writeChecklist(root, "demo", `- [ ] item-a — A\n`);
    const item = firstUnchecked(parseChecklist(cp))!;
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });

    expect(
      evaluateVerifyReport({
        enabled: false,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).outcome,
    ).toBe("skip");

    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: false }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).outcome,
    ).toBe("skip");

    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).outcome,
    ).toBe("fail");

    fs.writeFileSync(reportPath, "{not json");
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).outcome,
    ).toBe("fail");

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "wrong",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
        commands: [{ id: "test", exitCode: 0 }],
      }),
    );
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).reason,
    ).toBe("itemId mismatch");

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "item-a",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
        commands: [{ id: "test" }],
      }),
    );
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).reason,
    ).toMatch(/exitCode/);

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "item-a",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
      }),
    );
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).reason,
    ).toMatch(/commands/);

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "item-a",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
        commands: [null, { id: "test", exitCode: NaN }],
      }),
    );
    expect(
      evaluateVerifyReport({
        enabled: true,
        commands: [{ id: "test", required: true }],
        reportPath,
        currentItem: item,
        checklistPath: cp,
      }).reason,
    ).toMatch(/exitCode/);
  });
});

describe("F-CED code-edit-detector", () => {
  it("excludes plans/docs/md/autopilot; includes .ts", () => {
    expect(isProductCodeEdit("plans/foo/checklist.md")).toBe(false);
    expect(isProductCodeEdit("docs/readme.md")).toBe(true);
    expect(isProductCodeEdit(".autopilot/config.yml")).toBe(false);
    expect(isProductCodeEdit(".cursor/hooks.json")).toBe(false);
    expect(isProductCodeEdit("README.md")).toBe(true);
    expect(isProductCodeEdit("src/index.ts")).toBe(true);
    expect(isProductCodeEdit("package.json")).toBe(true);
    expect(isProductCodeEdit("logo.png")).toBe(false);
    expect(isProductCodeEdit("notes.txt")).toBe(false);
  });

  it("treats common non-JS languages as product code", () => {
    expect(isProductCodeEdit("lib/main.dart")).toBe(true);
    expect(isProductCodeEdit("src/Main.scala")).toBe(true);
    expect(isProductCodeEdit("lib/app.ex")).toBe(true);
    expect(isProductCodeEdit("src/App.vue")).toBe(true);
    expect(isProductCodeEdit("infra/main.tf")).toBe(true);
    expect(isProductCodeEdit("api/schema.proto")).toBe(true);
    expect(isProductCodeEdit("Cargo.toml")).toBe(true);
    expect(isProductCodeEdit("services/config.yaml")).toBe(true);
  });
});

describe("F-MIG migrate", () => {
  it("empty db runs migrations → latest; migrate is idempotent", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const latest = getLatestSchemaVersion();
    expect(latest).toBeGreaterThanOrEqual(3);
    expect(store.getSchemaVersion()).toBe(latest);
    expect(migrate(store.db)).toBe(latest);
    expect(store.getSchemaVersion()).toBe(latest);
    store.close();
  });

  it("corrupt schema_version is read as 0 (not NaN / not treated as latest)", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    store.db
      .prepare(
        "INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('schema_version', ?)",
      )
      .run("nope");
    expect(store.getSchemaVersion()).toBe(0);
    expect(getCurrentSchemaVersion(store.db)).toBe(0);
    store.close();
  });

  it("parseSchemaVersionValue rejects partial / non-integer tokens", () => {
    expect(parseSchemaVersionValue(null)).toBe(0);
    expect(parseSchemaVersionValue("")).toBe(0);
    expect(parseSchemaVersionValue("nope")).toBe(0);
    expect(parseSchemaVersionValue("-1")).toBe(0);
    expect(parseSchemaVersionValue("2.9")).toBe(0);
    expect(parseSchemaVersionValue("2abc")).toBe(0);
    expect(parseSchemaVersionValue(" 2 ")).toBe(2);
    expect(parseSchemaVersionValue("0")).toBe(0);
    expect(parseSchemaVersionValue(2)).toBe(2);
  });
});

describe("review-engine P0 matrix", () => {
  let root: string;
  let store: StateStore;
  let cp: string;

  beforeEach(() => {
    root = tmpRoot();
    store = StateStore.openMemory(root);
    cp = writeChecklist(
      root,
      "demo",
      `- [ ] item-a — First\n- [ ] item-b — Second\n`,
    );
    sessionExecuting(store, root, "c1", cp);
    store.ensureReviewChain("c1");
  });

  afterEach(() => {
    store.close();
  });

  it("F-E3E4: five confirms, no duplicate 1/5; E3 sets left=rounds-1", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", { chain_pending: 1, confirm_left: null, code_edited: 0 });
    const confirms: number[] = [];
    const a1 = stop(eng, "c1");
    expect(a1?.kind).toMatch(/confirm/);
    expect(a1?.meta?.n).toBe(1);
    confirms.push(a1!.meta!.n as number);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(4);

    for (let i = 0; i < 4; i++) {
      const a = stop(eng, "c1");
      expect(a?.kind).toMatch(/confirm/);
      confirms.push(a!.meta!.n as number);
    }
    expect(confirms).toEqual([1, 2, 3, 4, 5]);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(0);
  });

  it("F-E4E5: E4 1→0 does not advance same stop; next stop E5", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", {
      confirm_left: 1,
      chain_pending: 1,
      code_edited: 0,
      item_confirm_complete: 0,
    });
    const a = stop(eng, "c1");
    expect(a?.kind).toBe("review.confirm_final");
    expect(a?.meta?.n).toBe(5);
    expect(store.getReviewChain("c1")!.confirm_left).toBe(0);
    // same chain state would advance on NEXT stop
    const b = stop(eng, "c1");
    expect(b?.kind).toBe("advance");
  });

  it("F-NULL: confirm_left NULL does not enter E5; missing soft evidence → need_evidence", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    // E0 soft path: no matching verify-last.json → nudge (never silent null / never E5)
    const a = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
    });
    expect(a?.kind).toBe("need_evidence");
    expect(a?.message ?? "").toMatch(/item-a|Need evidence|需要完成证据/);
    const chain = store.getReviewChain("c1")!;
    expect(chain.confirm_left).toBeNull();
    expect(chain.item_confirm_complete).toBe(0);
    expect(chain.chain_pending).toBe(0);
    expect(chain.pending_followup?.trim()).toBeTruthy();
  });

  it("F-E0-NUDGE: stale itemId soft report nudges; matching itemId then advances", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
      reviewing_item_id: "item-a",
    });
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    // Stale prior item — general mismatch class (not only "file missing")
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "cli-files-dedupe", ok: true }),
    );
    const nudge = stop(eng, "c1", 0);
    expect(nudge?.kind).toBe("need_evidence");
    expect(store.getReviewChain("c1")!.chain_pending).toBe(0);

    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-a", ok: true }),
    );
    const advanced = stop(eng, "c1", 0);
    expect(advanced?.kind).toBe("advance");
    expect(advanced?.message ?? "").toMatch(/item-b/);
  });

  it("F-E0-NUDGE: repeated missing evidence emits stuck without hard pause (C2)", () => {
    const eng = engine(store, root, { maxIdleStops: 2 });
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      item_confirm_complete: 0,
    });
    expect(stop(eng, "c1", 0)?.kind).toBe("need_evidence");
    expect(store.getSession("c1")!.idle_stop_count).toBe(1);
    const stuck = stop(eng, "c1", 0);
    expect(stuck?.kind).toBe("stuck");
    expect(stuck?.loop).toBe(true);
    // stuck_soft copy: tip still classifies as stuck, but does not demand RESUME.
    expect(stuck?.message ?? "").toMatch(/^Stuck:/);
    expect(stuck?.message ?? "").toMatch(/not required|stays armed/i);
    expect(isRecoverOrStuckFollowupMessage(stuck?.message ?? "")).toBe(true);
    const sess = store.getSession("c1")!;
    expect(sess.idle_stop_count).toBe(2);
    // Soft idle stuck: nudge only — keep armed/unpaused so the agent can retry.
    expect(sess.paused).toBe(0);
    expect(sess.paused_reason).toBeNull();
    expect(sess.armed).toBe(1);

    // Soft stuck tip must not require RESUME: clear tip + soft evidence → advance
    store.updateReviewChain("c1", {
      pending_followup: null,
      pending_followup_at: null,
      pending_redeliver_at: null,
      chain_pending: 0,
    });
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-a", ok: true }),
    );
    const advanced = stop(eng, "c1", 0);
    expect(advanced?.kind).toBe("advance");
    expect(store.getSession("c1")!.idle_stop_count).toBe(0);
    expect(store.getSession("c1")!.paused).toBe(0);
    expect(store.getSession("c1")!.armed).toBe(1);
  });

  it("F-E0-NUDGE: soft stuck tip blocks soft advance until cleared (C2 tip ownership)", () => {
    const eng = engine(store, root, { maxIdleStops: 1 });
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      item_confirm_complete: 0,
    });
    const stuck = stop(eng, "c1", 0);
    expect(stuck?.kind).toBe("stuck");
    expect(isRecoverOrStuckFollowupMessage(stuck?.message ?? "")).toBe(true);
    expect(store.getSession("c1")!.paused).toBe(0);
    expect(store.getSession("c1")!.armed).toBe(1);
    const tip = store.getReviewChain("c1")!.pending_followup!;
    expect(tip).toBeTruthy();

    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-a", ok: true }),
    );
    // No transcript_path: undelivered stuck tip → refuse soft advance (not silent advance).
    expect(stop(eng, "c1", 0)).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBe(tip);
    expect(store.getSession("c1")!.idle_stop_count).toBe(1);
    expect(firstUnchecked(parseChecklist(cp))!.id).toBe("item-a");

    // Transcript without tip delivered → redeliver stuck; stay armed.
    const transcript = path.join(root, "transcript.jsonl");
    fs.writeFileSync(
      transcript,
      JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "text", text: "working…" }] },
      }) + "\n",
    );
    const again = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(again?.kind).toBe("stuck");
    expect(again?.meta?.redeliver).toBe(true);
    expect(again?.message).toBe(tip);
    expect(store.getSession("c1")!.paused).toBe(0);
    expect(store.getSession("c1")!.armed).toBe(1);
  });

  it("F-E0-NUDGE: soft stuck tip wins over sticky code_edited until cleared (C2)", () => {
    const eng = engine(store, root, { maxIdleStops: 1 });
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      item_confirm_complete: 0,
    });
    const stuck = stop(eng, "c1", 0);
    expect(stuck?.kind).toBe("stuck");
    const tip = store.getReviewChain("c1")!.pending_followup!;

    // Product edit arms sticky code_edited while soft stuck tip still owns the chain.
    store.updateReviewChain("c1", { code_edited: 1, fix_round: 0 });
    expect(stop(eng, "c1", 0)).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBe(tip);

    const transcript = path.join(root, "transcript-code.jsonl");
    fs.writeFileSync(
      transcript,
      JSON.stringify({
        role: "assistant",
        message: { content: [{ type: "text", text: "edited" }] },
      }) + "\n",
    );
    const redelivered = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(redelivered?.kind).toBe("stuck");
    expect(redelivered?.meta?.redeliver).toBe(true);
    expect(redelivered?.message).toBe(tip);
    // Sticky edit preserved for after tip clears.
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);
    expect(store.getSession("c1")!.armed).toBe(1);
    expect(store.getSession("c1")!.paused).toBe(0);
  });

  it("F-DIRTY-STOP: shell-dirty product path arms fix instead of soft need_evidence", () => {
    // Tier-B honesty (0.17): hosts without a usable SubagentStop do **not** get a
    // fake subagent-stop hook. This case models a **child / shell / unmatched tool**
    // that changed product files while the **parent** never saw afterFileEdit /
    // PostToolUse — closeout is parent Stop **dirty-arm** (git product dirty vs HEAD)
    // via ReviewEngine.maybeArmCodeEditedFromDirtyTree, then the normal fix tip.
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    // Product write with **no** edit-hook arm (code_edited stays 0 until Stop).
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    const dirtyCp = writeChecklist(
      dirtyRoot,
      "dirty-demo",
      `- [ ] item-a — First\n- [ ] item-b — Second\n`,
    );
    sessionExecuting(dirtyStore, dirtyRoot, "dirty1", dirtyCp);
    dirtyStore.ensureReviewChain("dirty1");
    dirtyStore.updateReviewChain("dirty1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const eng = engine(dirtyStore, dirtyRoot);
    const out = eng.handleStop({
      conversationId: "dirty1",
      status: "completed",
      loopCount: 0,
    });
    expect(out?.kind).toBe("review.fix");
    const chain = dirtyStore.getReviewChain("dirty1")!;
    // e2Fix clears code_edited when the fix tip is committed (same as afterFileEdit path).
    expect(chain.code_edited).toBe(0);
    expect(chain.fix_round).toBeGreaterThan(0);
    expect(chain.chain_pending).toBe(1);
    dirtyStore.close();
  });

  it("F-DIRTY-STOP: only .autopilotignore dirt stays on soft need_evidence (A)", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(
      path.join(dirtyRoot, ".autopilotignore"),
      "plans/**\n.autopilot/**\n",
    );
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    // Dirt only under ignored .autopilot/ — must not arm product code_edited.
    // Use .ts so this asserts `.autopilot/**` (fixture ignore replaces defaults;
    // default `*.txt` would not apply here).
    fs.mkdirSync(path.join(dirtyRoot, ".autopilot"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, ".autopilot", "scratch.ts"), "export {};\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    const dirtyCp = writeChecklist(
      dirtyRoot,
      "ignore-dirty",
      `- [ ] item-a — First\n- [ ] item-b — Second\n`,
    );
    sessionExecuting(dirtyStore, dirtyRoot, "ig1", dirtyCp);
    dirtyStore.ensureReviewChain("ig1");
    dirtyStore.updateReviewChain("ig1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const eng = engine(dirtyStore, dirtyRoot);
    const out = eng.handleStop({
      conversationId: "ig1",
      status: "completed",
      loopCount: 0,
    });
    expect(out?.kind).toBe("need_evidence");
    expect(dirtyStore.getReviewChain("ig1")!.code_edited).toBe(0);
    expect(dirtyStore.getReviewChain("ig1")!.fix_round).toBe(0);
    dirtyStore.close();
  });

  it("F-DIRTY-STOP: dirty_unarmed refuses soft even with matching verify-last", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    const dirtyCp = writeChecklist(
      dirtyRoot,
      "dirty-unarmed",
      `- [ ] item-a — First\n- [ ] item-b — Second\n`,
    );
    sessionExecuting(dirtyStore, dirtyRoot, "du1", dirtyCp);
    dirtyStore.ensureReviewChain("du1");
    dirtyStore.updateReviewChain("du1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    fs.mkdirSync(path.join(dirtyRoot, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(dirtyRoot, ".autopilot", "verify-last.json"),
      JSON.stringify({
        itemId: "item-a",
        ok: true,
        at: new Date().toISOString(),
      }),
    );
    // Simulate arm failure: dirty tree seen but code_edited never sticks.
    const markSpy = vi
      .spyOn(StateStore.prototype, "markCodeEdited")
      .mockImplementation(() => {});
    try {
      const eng = engine(dirtyStore, dirtyRoot);
      const out = eng.handleStop({
        conversationId: "du1",
        status: "completed",
        loopCount: 0,
      });
      expect(out).toBeNull();
      expect(dirtyStore.getReviewChain("du1")!.code_edited).toBe(0);
    } finally {
      markSpy.mockRestore();
      dirtyStore.close();
    }
  });

  it("F-DIRTY-AMBIENT: project idle+armed dirty arms fix (no checklist executing)", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    dirtyStore.upsertSession({
      conversation_id: "amb1",
      project_root: dirtyRoot,
      code_root: dirtyRoot,
      platform: "cursor",
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    dirtyStore.ensureReviewChain("amb1");
    dirtyStore.updateReviewChain("amb1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "project" });
    const out = eng.handleStop({
      conversationId: "amb1",
      status: "completed",
      loopCount: 0,
    });
    expect(out?.kind).toBe("review.fix");
    const chain = dirtyStore.getReviewChain("amb1")!;
    expect(chain.fix_round).toBeGreaterThan(0);
    expect(chain.chain_pending).toBe(1);
    dirtyStore.close();
  });

  it("F-DIRTY-AMBIENT: no-session + product dirty ensures ambient then fix", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    expect(dirtyStore.getSession("nosess1")).toBeFalsy();
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "project" });
    const out = eng.handleStop({
      conversationId: "nosess1",
      status: "completed",
      loopCount: 0,
      platform: "codex",
    });
    expect(out?.kind).toBe("review.fix");
    const sess = dirtyStore.getSession("nosess1")!;
    expect(sess.phase).toBe("idle");
    expect(sess.armed).toBe(1);
    expect(sess.platform).toBe("codex");
    expect(dirtyStore.getReviewChain("nosess1")!.fix_round).toBeGreaterThan(0);
    dirtyStore.close();
  });

  it("F-DIRTY-AMBIENT: executing_only ignores ambient dirty (no session → null)", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "executing_only" });
    const out = eng.handleStop({
      conversationId: "eo-amb",
      status: "completed",
      loopCount: 0,
    });
    expect(out).toBeNull();
    expect(dirtyStore.getSession("eo-amb")).toBeFalsy();
    dirtyStore.close();
  });

  it("F-DIRTY-AMBIENT: executing_only + idle armed session ignores product dirty", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    dirtyStore.upsertSession({
      conversation_id: "eo-idle",
      project_root: dirtyRoot,
      code_root: dirtyRoot,
      platform: "cursor",
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    dirtyStore.ensureReviewChain("eo-idle");
    dirtyStore.updateReviewChain("eo-idle", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "executing_only" });
    const out = eng.handleStop({
      conversationId: "eo-idle",
      status: "completed",
      loopCount: 0,
    });
    expect(out).toBeNull();
    expect(dirtyStore.getReviewChain("eo-idle")!.code_edited).toBe(0);
    expect(dirtyStore.getReviewChain("eo-idle")!.fix_round).toBe(0);
    dirtyStore.close();
  });

  it("F-DIRTY-AMBIENT: ignore-only dirt on ambient idle stays null (no fix)", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(
      path.join(dirtyRoot, ".autopilotignore"),
      "plans/**\n.autopilot/**\n",
    );
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.mkdirSync(path.join(dirtyRoot, ".autopilot"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, ".autopilot", "scratch.ts"), "export {};\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    dirtyStore.upsertSession({
      conversation_id: "amb-ig",
      project_root: dirtyRoot,
      code_root: dirtyRoot,
      platform: "cursor",
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    dirtyStore.ensureReviewChain("amb-ig");
    dirtyStore.updateReviewChain("amb-ig", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "project" });
    const out = eng.handleStop({
      conversationId: "amb-ig",
      status: "completed",
      loopCount: 0,
    });
    expect(out).toBeNull();
    expect(dirtyStore.getReviewChain("amb-ig")!.fix_round).toBe(0);
    dirtyStore.close();
  });

  it("F-DIRTY-AMBIENT: aborted stop must not ensure session from product dirty", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "project" });
    const out = eng.handleStop({
      conversationId: "abort-dirty",
      status: "aborted",
      loopCount: 0,
    });
    expect(out).toBeNull();
    expect(dirtyStore.getSession("abort-dirty")).toBeFalsy();
    dirtyStore.close();
  });

  it("F-DIRTY-AMBIENT: planning + product dirty arms fix", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    dirtyStore.upsertSession({
      conversation_id: "amb-plan",
      project_root: dirtyRoot,
      code_root: dirtyRoot,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    dirtyStore.ensureReviewChain("amb-plan");
    dirtyStore.updateReviewChain("amb-plan", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "project" });
    const out = eng.handleStop({
      conversationId: "amb-plan",
      status: "completed",
      loopCount: 0,
    });
    expect(out?.kind).toBe("review.fix");
    const planChain = dirtyStore.getReviewChain("amb-plan")!;
    expect(planChain.fix_round).toBeGreaterThan(0);
    expect(planChain.chain_pending).toBe(1);
    dirtyStore.close();
  });

  it("F-DIRTY-AMBIENT: idle+armed=0 + product dirty stays null", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    dirtyStore.upsertSession({
      conversation_id: "amb-disarmed",
      project_root: dirtyRoot,
      code_root: dirtyRoot,
      platform: "cursor",
      phase: "idle",
      armed: 0,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    dirtyStore.ensureReviewChain("amb-disarmed");
    dirtyStore.updateReviewChain("amb-disarmed", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "project" });
    const out = eng.handleStop({
      conversationId: "amb-disarmed",
      status: "completed",
      loopCount: 0,
    });
    expect(out).toBeNull();
    expect(dirtyStore.getReviewChain("amb-disarmed")!.code_edited).toBe(0);
    expect(dirtyStore.getReviewChain("amb-disarmed")!.fix_round).toBe(0);
    dirtyStore.close();
  });

  it("F-DIRTY-AMBIENT: done + product dirty stays null (no E2)", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    dirtyStore.upsertSession({
      conversation_id: "amb-done",
      project_root: dirtyRoot,
      code_root: dirtyRoot,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    dirtyStore.ensureReviewChain("amb-done");
    dirtyStore.updateReviewChain("amb-done", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "project" });
    const out = eng.handleStop({
      conversationId: "amb-done",
      status: "completed",
      loopCount: 0,
    });
    expect(out).toBeNull();
    expect(dirtyStore.getSession("amb-done")!.phase).toBe("done");
    expect(dirtyStore.getReviewChain("amb-done")!.code_edited).toBe(0);
    expect(dirtyStore.getReviewChain("amb-done")!.fix_round).toBe(0);
    dirtyStore.close();
  });

  it("F-DIRTY-AMBIENT: paused idle+armed + product dirty stays null", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 2;\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    dirtyStore.upsertSession({
      conversation_id: "amb-paused",
      project_root: dirtyRoot,
      code_root: dirtyRoot,
      platform: "cursor",
      phase: "idle",
      armed: 1,
      paused: 1,
      paused_reason: "human_gate",
      checklist_path: "",
      track_id: "",
    });
    dirtyStore.ensureReviewChain("amb-paused");
    dirtyStore.updateReviewChain("amb-paused", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "project" });
    const out = eng.handleStop({
      conversationId: "amb-paused",
      status: "completed",
      loopCount: 0,
    });
    expect(out).toBeNull();
    expect(dirtyStore.getSession("amb-paused")!.paused).toBe(1);
    expect(dirtyStore.getReviewChain("amb-paused")!.code_edited).toBe(0);
    expect(dirtyStore.getReviewChain("amb-paused")!.fix_round).toBe(0);
    dirtyStore.close();
  });

  it("F-DIRTY-AMBIENT: no-session + clean tree stays null (no ensure)", () => {
    const cleanRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: cleanRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(cleanRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(cleanRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(cleanRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);

    const cleanStore = StateStore.openMemory(cleanRoot);
    expect(cleanStore.getSession("nosess-clean")).toBeFalsy();
    const eng = engine(cleanStore, cleanRoot, { reviewScope: "project" });
    const out = eng.handleStop({
      conversationId: "nosess-clean",
      status: "completed",
      loopCount: 0,
    });
    expect(out).toBeNull();
    expect(cleanStore.getSession("nosess-clean")).toBeFalsy();
    cleanStore.close();
  });

  it("F-DIRTY-AMBIENT: no-session + ignore-only dirt stays null (no ensure)", () => {
    const dirtyRoot = tmpRoot();
    const run = (args: string[]) => {
      const r = spawnSync("git", args, {
        cwd: dirtyRoot,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
        shell: false,
      });
      expect(r.status, r.stderr || r.stdout || "").toBe(0);
    };
    run(["init"]);
    run(["config", "user.email", "t@example.com"]);
    run(["config", "user.name", "T"]);
    fs.mkdirSync(path.join(dirtyRoot, "packages"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, "packages", "x.ts"), "export const n = 1;\n");
    fs.writeFileSync(path.join(dirtyRoot, ".autopilotignore"), "plans/**\n.autopilot/**\n");
    run(["add", "-A"]);
    run(["commit", "-m", "init"]);
    fs.mkdirSync(path.join(dirtyRoot, ".autopilot"), { recursive: true });
    fs.writeFileSync(path.join(dirtyRoot, ".autopilot", "scratch.ts"), "export {};\n");

    const dirtyStore = StateStore.openMemory(dirtyRoot);
    expect(dirtyStore.getSession("nosess-ig")).toBeFalsy();
    const eng = engine(dirtyStore, dirtyRoot, { reviewScope: "project" });
    const out = eng.handleStop({
      conversationId: "nosess-ig",
      status: "completed",
      loopCount: 0,
    });
    expect(out).toBeNull();
    expect(dirtyStore.getSession("nosess-ig")).toBeFalsy();
    dirtyStore.close();
  });

  it("F-E0-NUDGE: sticky reviewing_item_id binds need_evidence after premature [x]", () => {
    const stickyCp = writeChecklist(
      root,
      "e0-nudge-sticky",
      `- [ ] item-a — First\n- [ ] item-b — Second\n`,
    );
    sessionExecuting(store, root, "e0ns1", stickyCp);
    store.ensureReviewChain("e0ns1");
    store.updateReviewChain("e0ns1", {
      reviewing_item_id: "item-a",
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      chain_pending: 0,
    });
    fs.writeFileSync(
      stickyCp,
      `- [x] item-a — First\n- [ ] item-b — Second\n`,
    );
    const eng = engine(store, root);
    const nudge = eng.handleStop({
      conversationId: "e0ns1",
      status: "completed",
      loopCount: 0,
    });
    expect(nudge?.kind).toBe("need_evidence");
    expect(nudge?.message ?? "").toMatch(/item-a/);
    expect(nudge?.meta?.currentId).toBe("item-a");
    expect(store.getReviewChain("e0ns1")!.chain_pending).toBe(0);
  });

  it("F-E0-NUDGE: evidence appearing before retry advances (no silent null)", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      item_confirm_complete: 0,
      reviewing_item_id: "item-a",
    });
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    // First stop: no evidence → need_evidence
    expect(stop(eng, "c1", 0)?.kind).toBe("need_evidence");
    // Agent writes matching soft evidence, then stop again → advance
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-a", ok: true }),
    );
    const advanced = stop(eng, "c1", 0);
    expect(advanced?.kind).toBe("advance");
    expect(advanced?.message ?? "").toMatch(/item-b/);
  });

  it("F-E0-STICKY: soft advance still uses sticky after premature [x]", () => {
    const cp = writeChecklist(
      root,
      "e0-sticky",
      `- [ ] item-a — First\n- [ ] item-b — Second\n`,
    );
    sessionExecuting(store, root, "e0s1", cp);
    store.ensureReviewChain("e0s1");
    store.updateReviewChain("e0s1", {
      reviewing_item_id: "item-a",
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      chain_pending: 0,
    });
    // Premature check — firstUnchecked becomes item-b; soft must still bind item-a.
    fs.writeFileSync(
      cp,
      `- [x] item-a — First\n- [ ] item-b — Second\n`,
    );
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-a", ok: true, at: new Date().toISOString() }),
    );
    const eng = engine(store, root);
    const a = eng.handleStop({
      conversationId: "e0s1",
      status: "completed",
      loopCount: 0,
    });
    expect(a?.kind).toBe("advance");
    expect(a?.message ?? "").toMatch(/item-b/);
    expect(a?.message ?? "").toMatch(/item-a/);
    expect(store.getReviewChain("e0s1")!.reviewing_item_id).toBe("item-b");
  });

  it("F-E0: soft evidence itemId match advances without confirm", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-a", ok: true, at: new Date().toISOString() }),
    );
    const a = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
    });
    expect(a?.kind).toBe("advance");
    expect(a?.message).toMatch(/item-b|Second/);
    // Soft path must not leave stranded at-E5 (would skip evidence next stop).
    const chain = store.getReviewChain("c1")!;
    expect(chain.confirm_left).toBeNull();
    expect(chain.item_confirm_complete).toBe(0);
    expect(chain.chain_pending).toBe(0);
  });

  it("F-E0: consecutive soft advances without confirm between items", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-a", ok: true }),
    );
    expect(
      eng.handleStop({ conversationId: "c1", status: "completed", loopCount: 0 })
        ?.kind,
    ).toBe("advance");
    expect(store.getReviewChain("c1")!.chain_pending).toBe(0);

    // Agent checked off item-a (simulate) and wrote evidence for item-b.
    fs.writeFileSync(
      cp,
      `- [x] item-a — First\n- [ ] item-b — Second\n`,
    );
    store.updateReviewChain("c1", {
      pending_followup: null,
      pending_followup_at: null,
    });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-b", ok: true }),
    );
    const b = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
    });
    expect(b?.kind).toBe("done");
    expect(b?.kind).not.toMatch(/confirm/);
  });

  it("F-E0: required verify pass advances without confirm", () => {
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "item-a",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
        commands: [{ id: "test", exitCode: 0 }],
      }),
    );
    const eng = engine(store, root, {
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      verifyReportPath: reportPath,
    });
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const a = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
    });
    expect(a?.kind).toBe("advance");
    const chain = store.getReviewChain("c1")!;
    expect(chain.confirm_left).toBeNull();
    expect(chain.item_confirm_complete).toBe(0);
    expect(chain.chain_pending).toBe(0);
  });

  it("F-E0: ok false / stale itemId → need_evidence (not silent null)", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-a", ok: false }),
    );
    expect(
      eng.handleStop({ conversationId: "c1", status: "completed", loopCount: 0 })
        ?.kind,
    ).toBe("need_evidence");

    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-b", ok: true }),
    );
    expect(
      eng.handleStop({ conversationId: "c1", status: "completed", loopCount: 0 })
        ?.kind,
    ).toBe("need_evidence");
  });

  it("F-E0: required verify fail then code edit still E2 first", () => {
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const eng = engine(store, root, {
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      verifyReportPath: reportPath,
    });
    store.updateReviewChain("c1", {
      confirm_left: null,
      chain_pending: 0,
      code_edited: 0,
      fix_round: 0,
      item_confirm_complete: 0,
    });
    const fail = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
    });
    expect(fail?.kind).toBe("verify_fix");
    expect(store.getReviewChain("c1")!.item_confirm_complete).toBe(1);

    store.markCodeEdited("c1");
    const fix = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
    });
    expect(fix?.kind).toBe("review.fix");
  });

  it("F-E0: mid-confirm does not take no-code path", () => {
    const eng = engine(store, root);
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({ itemId: "item-a", ok: true }),
    );
    store.updateReviewChain("c1", {
      confirm_left: 3,
      chain_pending: 1,
      code_edited: 0,
      fix_round: 2,
      item_confirm_complete: 0,
    });
    const a = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
    });
    expect(a?.kind).toMatch(/confirm/);
    expect(a?.kind).not.toBe("advance");
  });

  // Commerce M2 class: mid-fix error recover clears chain_pending; if
  // code_edited was lost, a later completed stop must not soft-done on stale
  // verify-last (last checklist item). Prefer re-arm fix; never emit done.
  it("F-ERR-EXEC-RECOVER-NO-E0-DONE: post-recover mid-fix must not soft-done", () => {
    const lastCp = writeChecklist(
      root,
      "recover-no-e0",
      `- [x] done-a — A\n- [ ] last-item — Last\n`,
    );
    sessionExecuting(store, root, "c-rec-e0", lastCp);
    store.ensureReviewChain("c-rec-e0");
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "last-item",
        ok: true,
        at: "2026-09-08T02:18:00.000Z",
      }),
    );
    // Post-recover residue: fix in flight, markers cleared (armChain=false).
    store.updateReviewChain("c-rec-e0", {
      fix_round: 14,
      chain_pending: 0,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      reviewing_item_id: "last-item",
      pending_followup: null,
      pending_followup_at: null,
    });
    const eng = engine(store, root, {
      verifyEnabled: true,
      verifyCommands: [{ id: "build", run: "true", required: false }],
    });
    const out = eng.handleStop({
      conversationId: "c-rec-e0",
      status: "completed",
      loopCount: 0,
    });
    expect(out?.kind).not.toBe("done");
    expect(out?.kind).not.toBe("advance");
    // Residue re-arms code_edited → E2 (not E3 confirm / not E0 soft-done).
    expect(out?.kind).toBe("review.fix");
    expect(out?.meta?.fixRound).toBe(15);
    expect(store.getSession("c-rec-e0")!.phase).toBe("executing");
  });

  it("F-ERR-RESIDUE-E2-MISS-RECOVER: residue E2 TOCTOU must redeliver recover", () => {
    const cp = writeChecklist(
      root,
      "residue-e2-miss",
      `- [ ] item-a — A\n- [ ] item-b — B\n`,
    );
    sessionExecuting(store, root, "c-res-e2-miss", cp);
    store.ensureReviewChain("c-res-e2-miss");
    const recoverPending =
      "Recover: the previous turn ended with an error. Continue the current task.";
    // Residue-eligible: fix_round>0, markers cleared — will rearm then e2Fix.
    store.updateReviewChain("c-res-e2-miss", {
      fix_round: 14,
      chain_pending: 0,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: null,
      pending_followup_at: null,
      pending_redeliver_at: null,
    });
    const transcript = path.join(root, "t-res-e2-miss.jsonl");
    fs.writeFileSync(transcript, "");
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    const origEx = store.exclusiveWrite.bind(store);
    let writes = 0;
    store.exclusiveWrite = ((fn: Parameters<typeof origEx>[0]) => {
      writes += 1;
      // write 1: residue rearm. write 2: e2Fix — stamp recover before e2 body.
      if (writes === 2) {
        const ts = new Date().toISOString();
        store.db
          .prepare(
            `UPDATE review_chains SET
              pending_followup = ?, pending_followup_at = ?,
              pending_redeliver_at = NULL, code_edited = 1
             WHERE conversation_id = ?`,
          )
          .run(recoverPending, ts, "c-res-e2-miss");
      }
      return origEx(fn);
    }) as typeof store.exclusiveWrite;
    try {
      const out = eng.handleStop({
        conversationId: "c-res-e2-miss",
        status: "completed",
        loopCount: 0,
        transcriptPath: transcript,
      });
      expect(out?.kind).toBe("recover");
      expect(out?.message).toBe(recoverPending);
      expect(writes).toBeGreaterThanOrEqual(2);
    } finally {
      store.exclusiveWrite = origEx;
    }
  });

  it("F-ERR-EXEC-RECOVER-NO-E0-CLOBBER: undelivered recover must not be overwritten by E0", () => {
    const cp = writeChecklist(
      root,
      "recover-no-e0-clobber",
      `- [ ] item-a — A\n- [ ] item-b — B\n`,
    );
    sessionExecuting(store, root, "c-rec-e0c", cp);
    store.ensureReviewChain("c-rec-e0c");
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "item-a",
        ok: true,
        at: "2026-09-08T02:18:00.000Z",
      }),
    );
    const recoverPending =
      "Recover: the previous turn ended with an error. Continue the current task.";
    store.updateReviewChain("c-rec-e0c", {
      fix_round: 0,
      chain_pending: 0,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      reviewing_item_id: "item-a",
      pending_followup: recoverPending,
      pending_followup_at: new Date().toISOString(),
    });
    const eng = engine(store, root, {
      verifyEnabled: true,
      verifyCommands: [{ id: "build", run: "true", required: false }],
    });
    const out = eng.handleStop({
      conversationId: "c-rec-e0c",
      status: "completed",
      loopCount: 0,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c-rec-e0c")!.pending_followup).toBe(
      recoverPending,
    );
    expect(store.getSession("c-rec-e0c")!.phase).toBe("executing");
  });

  it("F-ERR-EXEC-RECOVER-FIX-ROUND: executing error with fix_round>0 re-arms code_edited", () => {
    const cp = writeChecklist(
      root,
      "exec-fix-round",
      `- [ ] item-a — A\n- [ ] item-b — B\n`,
    );
    sessionExecuting(store, root, "c-exec-fr", cp);
    store.ensureReviewChain("c-exec-fr");
    store.updateReviewChain("c-exec-fr", {
      fix_round: 14,
      chain_pending: 0,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: null,
    });
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    const recover = eng.handleStop({
      conversationId: "c-exec-fr",
      status: "error",
      loopCount: 0,
    });
    expect(recover?.kind).toBe("recover");
    expect(store.getReviewChain("c-exec-fr")!.code_edited).toBe(1);
    expect(store.getReviewChain("c-exec-fr")!.chain_pending).toBe(0);

    // Recover tip answered — sticky residue-E2 may open the next fix round.
    store.updateReviewChain("c-exec-fr", {
      pending_followup: null,
      pending_followup_at: null,
    });

    const after = eng.handleStop({
      conversationId: "c-exec-fr",
      status: "completed",
      loopCount: 0,
    });
    expect(after?.kind).toBe("review.fix");
    expect(after?.meta?.fixRound).toBe(15);
  });

  it("F-ERR-EXEC-ABORT-AFTER-RECOVER: abort clearing code_edited must not soft-done", () => {
    const lastCp = writeChecklist(
      root,
      "abort-after-recover",
      `- [x] done-a — A\n- [ ] last-item — Last\n`,
    );
    sessionExecuting(store, root, "c-abort-rec", lastCp);
    store.ensureReviewChain("c-abort-rec");
    store.updateReviewChain("c-abort-rec", {
      fix_round: 14,
      chain_pending: 0,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      reviewing_item_id: "last-item",
      pending_followup: null,
    });
    const eng = engine(store, root, {
      maxErrorsBeforePause: 0,
      verifyEnabled: true,
      verifyCommands: [{ id: "build", run: "true", required: false }],
    });
    expect(
      eng.handleStop({
        conversationId: "c-abort-rec",
        status: "error",
        loopCount: 0,
      })?.kind,
    ).toBe("recover");
    expect(store.getReviewChain("c-abort-rec")!.code_edited).toBe(1);

    // Host Stop races: drops recover pending + sticky edit marker.
    expect(
      eng.handleStop({
        conversationId: "c-abort-rec",
        status: "aborted",
        loopCount: 0,
      }),
    ).toBeNull();
    expect(store.getReviewChain("c-abort-rec")!.code_edited).toBe(0);
    expect(store.getReviewChain("c-abort-rec")!.fix_round).toBe(14);

    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "last-item",
        ok: true,
        at: "2026-09-08T02:18:00.000Z",
      }),
    );
    const out = eng.handleStop({
      conversationId: "c-abort-rec",
      status: "completed",
      loopCount: 0,
    });
    expect(out?.kind).not.toBe("done");
    expect(out?.kind).not.toBe("advance");
    // Abort cleared code_edited; residue must re-arm E2, not soft-done / confirm.
    expect(out?.kind).toBe("review.fix");
    expect(out?.meta?.fixRound).toBe(15);
    expect(store.getSession("c-abort-rec")!.phase).toBe("executing");
  });

  it("F-ERR-EXEC-READY-E3-RECOVER: about-to-confirm must resume E4 not another fix", () => {
    const cp = writeChecklist(
      root,
      "exec-ready-e3",
      `- [ ] item-a — A\n- [ ] item-b — B\n`,
    );
    sessionExecuting(store, root, "c-exec-e3", cp);
    store.ensureReviewChain("c-exec-e3");
    // Fix tip already delivered: chain_pending armed, pending cleared, awaiting E3.
    store.updateReviewChain("c-exec-e3", {
      fix_round: 3,
      chain_pending: 1,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: null,
      pending_followup_at: null,
    });
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    const recover = eng.handleStop({
      conversationId: "c-exec-e3",
      status: "error",
      loopCount: 0,
    });
    expect(recover?.kind).toBe("recover");
    const mid = store.getReviewChain("c-exec-e3")!;
    expect(mid.code_edited).toBe(0);
    expect(mid.chain_pending).toBe(0);
    // Ambient-parity: arm confirm_left=rounds so E4 emits 1/N after recover.
    expect(mid.confirm_left).toBe(5);

    store.updateReviewChain("c-exec-e3", {
      pending_followup: null,
      pending_followup_at: null,
    });

    const after = eng.handleStop({
      conversationId: "c-exec-e3",
      status: "completed",
      loopCount: 0,
    });
    expect(after?.kind).toBe("review.confirm");
    expect(after?.meta?.n).toBe(1);
    expect(store.getReviewChain("c-exec-e3")!.confirm_left).toBe(4);
  });

  it("F-ERR-EXEC-READY-E3-COMPENSATE: claim failure still arms confirm_left", () => {
    const cp = writeChecklist(
      root,
      "exec-ready-e3-comp",
      `- [ ] item-a — A\n- [ ] item-b — B\n`,
    );
    sessionExecuting(store, root, "c-exec-e3c", cp);
    store.ensureReviewChain("c-exec-e3c");
    store.updateReviewChain("c-exec-e3c", {
      fix_round: 3,
      chain_pending: 1,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: null,
      pending_followup_at: null,
    });
    const eng = engine(store, root, { maxErrorsBeforePause: 0, sleepSync: () => {} });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn: Parameters<typeof orig>[0]) => {
      writes += 1;
      // First exclusiveWrite is the recover claim — fail it so compensate runs.
      if (writes === 1) throw new Error("claim boom");
      return orig(fn);
    }) as typeof store.exclusiveWrite;
    try {
      const recover = eng.handleStop({
        conversationId: "c-exec-e3c",
        status: "error",
        loopCount: 0,
      });
      expect(recover?.kind).toBe("recover");
      const mid = store.getReviewChain("c-exec-e3c")!;
      expect(mid.code_edited).toBe(0);
      expect(mid.chain_pending).toBe(0);
      expect(mid.confirm_left).toBe(5);

      store.updateReviewChain("c-exec-e3c", {
        pending_followup: null,
        pending_followup_at: null,
      });

      const after = eng.handleStop({
        conversationId: "c-exec-e3c",
        status: "completed",
        loopCount: 0,
      });
      expect(after?.kind).toBe("review.confirm");
      expect(after?.meta?.n).toBe(1);
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-EXEC-READY-E3-LEGACY-EMIT: compensate write fail still arms via locked adjust", () => {
    const cp = writeChecklist(
      root,
      "exec-ready-e3-legacy",
      `- [ ] item-a — A\n- [ ] item-b — B\n`,
    );
    sessionExecuting(store, root, "c-exec-e3l", cp);
    store.ensureReviewChain("c-exec-e3l");
    store.updateReviewChain("c-exec-e3l", {
      fix_round: 3,
      chain_pending: 1,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: null,
      pending_followup_at: null,
    });
    const eng = engine(store, root, { maxErrorsBeforePause: 0, sleepSync: () => {} });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn: Parameters<typeof orig>[0]) => {
      writes += 1;
      // 1: claim fails → compensate. 2: first compensate txn fails → full locked
      // retry (write 3) must arm confirm_left + stamp recover together.
      if (writes <= 2) throw new Error("write boom");
      return orig(fn);
    }) as typeof store.exclusiveWrite;
    try {
      const recover = eng.handleStop({
        conversationId: "c-exec-e3l",
        status: "error",
        loopCount: 0,
      });
      expect(recover?.kind).toBe("recover");
      expect(store.getReviewChain("c-exec-e3l")!.confirm_left).toBe(5);
      expect(store.getReviewChain("c-exec-e3l")!.code_edited).toBe(0);
      expect(store.getReviewChain("c-exec-e3l")!.chain_pending).toBe(0);
      expect(store.getReviewChain("c-exec-e3l")!.pending_followup).toMatch(
        /恢复|Recover/,
      );
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("F-ERR-EXEC-READY-E3-UNLOCKED-EMIT: true legacy emit must not orphan confirm_left", () => {
    const cp = writeChecklist(
      root,
      "exec-ready-e3-unlock",
      `- [ ] item-a — A\n- [ ] item-b — B\n`,
    );
    sessionExecuting(store, root, "c-exec-e3u", cp);
    store.ensureReviewChain("c-exec-e3u");
    store.updateReviewChain("c-exec-e3u", {
      fix_round: 3,
      chain_pending: 1,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: null,
      pending_followup_at: null,
    });
    const eng = engine(store, root, { maxErrorsBeforePause: 0, sleepSync: () => {} });
    let writes = 0;
    const orig = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = ((fn: Parameters<typeof orig>[0]) => {
      writes += 1;
      // Claim + both writeRecover attempts fail → degraded stamp+clear (no adjust).
      // Must NOT leave confirm_left armed (readyForE3 only runs inside writeRecover).
      if (writes <= 3) throw new Error("write boom");
      return orig(fn);
    }) as typeof store.exclusiveWrite;
    try {
      const recover = eng.handleStop({
        conversationId: "c-exec-e3u",
        status: "error",
        loopCount: 0,
      });
      expect(recover?.kind).toBe("recover");
      const chain = store.getReviewChain("c-exec-e3u")!;
      expect(chain.pending_followup).toMatch(/恢复|Recover/);
      expect(chain.confirm_left).toBeNull();
      expect(chain.chain_pending).toBe(0);
    } finally {
      store.exclusiveWrite = orig;
    }
  });

  it("RESUME / checklist parse ignore poisoned session.project_root", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-poison-root-"));
    try {
      // Bypass upsert sanitizer — simulate a legacy DB row.
      store.db
        .prepare(
          `UPDATE sessions SET project_root = ?, code_root = ?, paused = 1,
            phase = 'executing', armed = 0 WHERE conversation_id = ?`,
        )
        .run(outside, outside, "c1");
      expect(store.getSession("c1")!.project_root).toBe(outside);
      // Checklist still under the real project — must re-arm using store root.
      const sess = applyResume(store, "c1");
      expect(sess.ok).toBe(true);
      if (!sess.ok) return;
      expect(sess.session?.paused).toBe(0);
      expect(sess.session?.armed).toBe(1);

      // Outside checklist + poisoned root must not count as in-project work.
      const evilCp = path.join(outside, "checklist.md");
      fs.writeFileSync(evilCp, `- [ ] x — X\n`);
      store.db
        .prepare(
          `UPDATE sessions SET project_root = ?, checklist_path = ?, paused = 1,
            phase = 'executing', armed = 0 WHERE conversation_id = ?`,
        )
        .run(outside, evilCp, "c1");
      const blocked = applyResume(store, "c1");
      expect(blocked.ok).toBe(true);
      if (!blocked.ok) return;
      expect(blocked.session?.armed).toBe(0);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("checklist containment prefers store root over mismatched config.projectRoot", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cfg-root-"));
    try {
      const evilCp = path.join(outside, "checklist.md");
      fs.writeFileSync(evilCp, `- [ ] secret — Secret\n`);
      // Engine config points outside; store stays on real project.
      const eng = engine(store, outside);
      store.db
        .prepare(
          `UPDATE sessions SET checklist_path = ?, armed = 1, phase = 'executing',
            paused = 0 WHERE conversation_id = ?`,
        )
        .run(evilCp, "c1");
      store.updateReviewChain("c1", {
        code_edited: 0,
        chain_pending: 1,
        confirm_left: 0,
        item_confirm_complete: 0,
      });
      // E5 must not advance/done from outside checklist under evil config root.
      expect(stop(eng, "c1")).toBeNull();

      // In-project checklist still works despite evil config root.
      store.db
        .prepare(
          `UPDATE sessions SET checklist_path = ? WHERE conversation_id = ?`,
        )
        .run(cp, "c1");
      store.updateReviewChain("c1", {
        code_edited: 0,
        chain_pending: 1,
        confirm_left: 0,
        item_confirm_complete: 0,
      });
      const ok = stop(eng, "c1");
      expect(ok?.kind).toBe("advance");
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("F-ICC: E5c FAIL sets item_confirm_complete; fix skips E3; PASS advances", () => {
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const eng = engine(store, root, {
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      verifyReportPath: reportPath,
    });
    store.updateReviewChain("c1", { confirm_left: 0, code_edited: 0 });
    const fail = stop(eng, "c1");
    expect(fail?.kind).toBe("verify_fix");
    expect(store.getReviewChain("c1")!.item_confirm_complete).toBe(1);

    // code edit → E2 fix; preserves ICC
    store.markCodeEdited("c1");
    const fix = stop(eng, "c1");
    expect(fix?.kind).toBe("review.fix");
    expect(store.getReviewChain("c1")!.item_confirm_complete).toBe(1);
    expect(store.getReviewChain("c1")!.confirm_left).toBeNull();

    // next stop with ICC=1 and confirm_left NULL → E5 (skip E3), still fail
    const again = stop(eng, "c1");
    expect(again?.kind).toBe("verify_fix");

    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "item-a",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
        commands: [{ id: "test", exitCode: 0 }],
      }),
    );
    const pass = stop(eng, "c1");
    expect(pass?.kind).toBe("advance");
    expect(store.getReviewChain("c1")!.item_confirm_complete).toBe(0);
  });

  it("F-LAST: countUnchecked===1 → done; >1 → advance", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", { confirm_left: 0, code_edited: 0 });
    const advance = stop(eng, "c1");
    expect(advance?.kind).toBe("advance");
    // defaultRender (no locale): mark [x] before commit instruction.
    const advMsg = advance?.message ?? "";
    const advMark = advMsg.search(/First mark the completed current item/i);
    const advCommit = advMsg.search(/conventional commit/i);
    expect(advMark).toBeGreaterThanOrEqual(0);
    expect(advCommit).toBeGreaterThan(advMark);
    expect(advMsg).toMatch(/Never mark an item \[x\] while you are still implementing/i);
    expect(advMsg).toMatch(/item-a/);
    // After marking current (item-a), "implement next" must be the following
    // unchecked item — not firstUnchecked / the item just completed.
    expect(advMsg).toMatch(/item-b/);
    expect(advMsg).toMatch(/Second/);
    expect(advMsg).not.toMatch(/implement next: item-a/i);

    const cp2 = writeChecklist(root, "last", `- [ ] only — One\n`);
    sessionExecuting(store, root, "c2", cp2);
    store.ensureReviewChain("c2");
    store.updateReviewChain("c2", { confirm_left: 0, code_edited: 0 });
    const eng2 = engine(store, root);
    const done = stop(eng2, "c2");
    expect(done?.kind).toBe("done");
    const doneMsg = done?.message ?? "";
    const doneMark = doneMsg.search(/Mark the last item \[x\]/i);
    const doneCommit = doneMsg.search(/conventional commit/i);
    expect(doneMark).toBeGreaterThanOrEqual(0);
    expect(doneCommit).toBeGreaterThan(doneMark);
    expect(store.getSession("c2")!.phase).toBe("done");
    expect(store.getSession("c2")!.armed).toBe(0);
  });

  it("F-ADV-STICKY: premature [x] on reviewing item still advances to true next", () => {
    const cp = writeChecklist(
      root,
      "sticky",
      `- [ ] initial-core — Core\n- [ ] reply-design — Design\n- [ ] reply-upgrade — Upgrade\n`,
    );
    sessionExecuting(store, root, "sticky1", cp);
    store.ensureReviewChain("sticky1");
    // First product edit arms sticky reviewing_item_id = initial-core
    store.markCodeEdited("sticky1", "initial-core");
    expect(store.getReviewChain("sticky1")!.reviewing_item_id).toBe("initial-core");
    // Later edits must not retarget when firstUnchecked moved
    store.markCodeEdited("sticky1", "reply-design");
    expect(store.getReviewChain("sticky1")!.reviewing_item_id).toBe("initial-core");

    // Premature checklist check (simulate agent mid-impl)
    fs.writeFileSync(
      cp,
      `- [x] initial-core — Core\n- [ ] reply-design — Design\n- [ ] reply-upgrade — Upgrade\n`,
    );

    // Finish confirm chain → E5
    store.updateReviewChain("sticky1", {
      code_edited: 0,
      confirm_left: 0,
      item_confirm_complete: 1,
      chain_pending: 0,
      reviewing_item_id: "initial-core",
    });
    const eng = engine(store, root);
    const advance = stop(eng, "sticky1");
    expect(advance?.kind).toBe("advance");
    const msg = advance?.message ?? "";
    // Must implement design (true next), NOT upgrade (bare secondUnchecked trap)
    expect(msg).toMatch(/reply-design/);
    expect(msg).toMatch(/Design/);
    expect(msg).not.toMatch(/implement next: reply-upgrade/i);
    expect(msg).toMatch(/initial-core/);
    // Advance seeds sticky to the next item (not cleared to null).
    expect(store.getReviewChain("sticky1")!.reviewing_item_id).toBe(
      "reply-design",
    );
  });

  it("F-ADV-STICKY-AHEAD: sticky next must not skip still-open current", () => {
    const cp = writeChecklist(
      root,
      "sticky-ahead",
      `- [ ] initial-core — Core\n- [ ] reply-design — Design\n- [ ] reply-upgrade — Upgrade\n`,
    );
    sessionExecuting(store, root, "sticky-a1", cp);
    store.ensureReviewChain("sticky-a1");
    // Simulate post-advance: sticky already points at next, but current still [ ].
    store.updateReviewChain("sticky-a1", {
      code_edited: 0,
      confirm_left: 0,
      item_confirm_complete: 1,
      chain_pending: 0,
      reviewing_item_id: "reply-design",
    });
    const eng = engine(store, root);
    const advance = stop(eng, "sticky-a1");
    expect(advance?.kind).toBe("advance");
    const msg = advance?.message ?? "";
    expect(msg).toMatch(/initial-core/);
    expect(msg).toMatch(/implement next: reply-design/i);
    expect(msg).not.toMatch(/implement next: reply-upgrade/i);
  });

  it("F-ADV-STICKY-VERIFY: verify uses sticky item after premature [x]", () => {
    const cp = writeChecklist(
      root,
      "sticky-v",
      `- [ ] initial-core — Core\n- [ ] reply-design — Design\n`,
    );
    sessionExecuting(store, root, "sticky-v1", cp);
    store.ensureReviewChain("sticky-v1");
    store.markCodeEdited("sticky-v1", "initial-core");
    fs.writeFileSync(
      cp,
      `- [x] initial-core — Core\n- [ ] reply-design — Design\n`,
    );
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        itemId: "initial-core",
        checklistPath: cp,
        ranAt: new Date().toISOString(),
        commands: [{ id: "test", exitCode: 0, required: true }],
      }),
    );
    store.updateReviewChain("sticky-v1", {
      code_edited: 0,
      confirm_left: 0,
      item_confirm_complete: 1,
      chain_pending: 0,
      reviewing_item_id: "initial-core",
    });
    const eng = engine(store, root, {
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      verifyReportPath: reportPath,
    });
    const advance = stop(eng, "sticky-v1");
    expect(advance?.kind).toBe("advance");
    expect(advance?.message ?? "").toMatch(/reply-design/);
    expect(advance?.message ?? "").not.toMatch(/implement next: initial-core/i);
  });

  it("F-ADV-STICKY-NEUTRALIZE: neutralizeReviewChain clears reviewing_item_id", () => {
    const cp = writeChecklist(
      root,
      "sticky-n",
      `- [ ] initial-core — Core\n- [ ] reply-design — Design\n`,
    );
    sessionExecuting(store, root, "sticky-n1", cp);
    store.ensureReviewChain("sticky-n1");
    store.markCodeEdited("sticky-n1", "initial-core");
    expect(store.getReviewChain("sticky-n1")!.reviewing_item_id).toBe(
      "initial-core",
    );
    store.neutralizeReviewChain("sticky-n1");
    const chain = store.getReviewChain("sticky-n1")!;
    expect(chain.reviewing_item_id).toBeNull();
    expect(chain.code_edited).toBe(0);
    // Next arm can stick a new item (empty sticky again).
    store.markCodeEdited("sticky-n1", "reply-design");
    expect(store.getReviewChain("sticky-n1")!.reviewing_item_id).toBe(
      "reply-design",
    );
  });

  it("F-ADV-STICKY-SOFTRESET: softReset preserves reviewing_item_id", () => {
    const cp = writeChecklist(
      root,
      "sticky-sr",
      `- [ ] initial-core — Core\n- [ ] reply-design — Design\n`,
    );
    sessionExecuting(store, root, "sticky-sr1", cp);
    store.ensureReviewChain("sticky-sr1");
    store.markCodeEdited("sticky-sr1", "initial-core");
    store.updateReviewChain("sticky-sr1", {
      confirm_left: 2,
      chain_pending: 1,
      pending_followup: "自审修复第 2 轮",
      pending_followup_at: new Date().toISOString(),
    });
    expect(
      store.softResetAmbientChainUnlessRecover("sticky-sr1", {
        confirm_left: null,
        item_confirm_complete: 0,
        chain_pending: 0,
        code_edited: 0,
      }),
    ).toBe(true);
    const chain = store.getReviewChain("sticky-sr1")!;
    expect(chain.reviewing_item_id).toBe("initial-core");
    expect(chain.pending_followup).toBeNull();
    expect(chain.code_edited).toBe(0);

    // Premature [x] after recover must not retarget sticky on the next edit.
    fs.writeFileSync(
      cp,
      `- [x] initial-core — Core\n- [ ] reply-design — Design\n`,
    );
    store.markCodeEdited("sticky-sr1", "reply-design");
    expect(store.getReviewChain("sticky-sr1")!.reviewing_item_id).toBe(
      "initial-core",
    );
  });

  it("F-ADV-STICKY-PENDING: premature [x] before first edit still arms from advance pending", () => {
    const cp = writeChecklist(
      root,
      "sticky-p",
      `- [ ] initial-core — Core\n- [ ] reply-design — Design\n`,
    );
    sessionExecuting(store, root, "sticky-p1", cp);
    store.ensureReviewChain("sticky-p1");
    // Advance already delivered; agent premature-checks before any product edit.
    store.updateReviewChain("sticky-p1", {
      pending_followup:
        "推进下一项：…然后实现下一项：initial-core — Job stub。",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 0,
    });
    fs.writeFileSync(
      cp,
      `- [x] initial-core — Core\n- [ ] reply-design — Design\n`,
    );
    const product = path.join(root, "src", "App.java");
    fs.mkdirSync(path.dirname(product), { recursive: true });
    fs.writeFileSync(product, "class App {}\n");
    // First product edit should sticky initial-core from pending, not reply-design.
    handleAfterFileEdit(
      store,
      {
        conversation_id: "sticky-p1",
        file_path: product,
      },
      root,
    );
    expect(store.getReviewChain("sticky-p1")!.reviewing_item_id).toBe(
      "initial-core",
    );
    expect(store.getReviewChain("sticky-p1")!.code_edited).toBe(1);
  });

  it("F-ADV-STICKY-LOCK: sticky resolve uses live chain under write lock", () => {
    const cp = writeChecklist(
      root,
      "sticky-lock",
      `- [ ] initial-core — Core\n- [ ] reply-design — Design\n`,
    );
    sessionExecuting(store, root, "sticky-l1", cp);
    store.ensureReviewChain("sticky-l1");
    store.updateReviewChain("sticky-l1", {
      pending_followup:
        "Then implement next: initial-core — Core.",
      pending_followup_at: new Date().toISOString(),
    });
    // Neutralize clears pending; resolver must not arm from a stale outer snapshot.
    store.neutralizeReviewChain("sticky-l1");
    store.markCodeEdited("sticky-l1", (chain) => {
      expect(chain.pending_followup).toBeNull();
      // Live row has no pending — do not invent a sticky id.
      return null;
    });
    expect(store.getReviewChain("sticky-l1")!.code_edited).toBe(1);
    expect(store.getReviewChain("sticky-l1")!.reviewing_item_id).toBeNull();
  });

  it("F-ADV-STICKY-RESOLVE-THROW: resolver throw still arms code_edited", () => {
    const cp = writeChecklist(
      root,
      "sticky-throw",
      `- [ ] initial-core — Core\n`,
    );
    sessionExecuting(store, root, "sticky-t1", cp);
    store.ensureReviewChain("sticky-t1");
    store.markCodeEdited("sticky-t1", () => {
      throw new Error("resolver boom");
    });
    expect(store.getReviewChain("sticky-t1")!.code_edited).toBe(1);
    expect(store.getReviewChain("sticky-t1")!.reviewing_item_id).toBeNull();
  });

  it("F-ARM: paused or armed=0 → no inject", () => {
    const eng = engine(store, root);
    store.updateReviewChain("c1", { confirm_left: 3, chain_pending: 1 });
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      armed: 0,
    });
    expect(stop(eng, "c1")).toBeNull();

    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      armed: 1,
      paused: 1,
      paused_reason: "human_gate",
    });
    expect(stop(eng, "c1")).toBeNull();
  });

  it("F-ERR: error×N (maxErrorsBeforePause) → repeated_errors; completed/RESUME clear error_count", () => {
    const eng = engine(store, root);
    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    expect(store.getSession("c1")!.error_count).toBe(2);
    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    expect(store.getSession("c1")!.paused).toBe(1);
    expect(store.getSession("c1")!.paused_reason).toBe("repeated_errors");
    expect(store.getSession("c1")!.armed).toBe(0);

    applyResume(store, "c1");
    expect(store.getSession("c1")!.error_count).toBe(0);
    expect(store.getSession("c1")!.paused).toBe(0);
    expect(store.getSession("c1")!.armed).toBe(1);
    // Stale recover from earlier error stops must not survive RESUME.
    expect(store.getReviewChain("c1")?.pending_followup ?? null).toBeNull();

    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    store.updateReviewChain("c1", {
      code_edited: 1,
      pending_followup: null,
      pending_followup_at: null,
    });
    stop(eng, "c1"); // completed fix → noteCompletedOk
    expect(store.getSession("c1")!.error_count).toBe(0);
  });

  it("F-RESUME-CLEAR-RECOVER: applyResume drops recover pending, keeps confirm", () => {
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      paused: 1,
      paused_reason: "human_gate",
      armed: 0,
    });
    applyResume(store, "c1");
    expect(store.getReviewChain("c1")!.pending_followup).toBeNull();

    store.updateReviewChain("c1", {
      pending_followup: "自审确认 2/5 — 角度",
      pending_followup_at: new Date().toISOString(),
    });
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      paused: 1,
      paused_reason: "human_gate",
      armed: 0,
    });
    applyResume(store, "c1");
    expect(store.getReviewChain("c1")!.pending_followup).toBe(
      "自审确认 2/5 — 角度",
    );
  });

  it("F-ERR-UNLIMITED: maxErrorsBeforePause=0 never pauses on errors", () => {
    // recoverDebounceMs:0 → no same-window coalesce (window requires ms>0).
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    for (let i = 0; i < 10; i++) {
      const action = eng.handleStop({
        conversationId: "c1",
        status: "error",
        loopCount: 0,
      });
      expect(action?.kind).toBe("recover");
    }
    expect(store.getSession("c1")!.paused).toBe(0);
    expect(store.getSession("c1")!.armed).toBe(1);
    expect(store.getSession("c1")!.error_count).toBe(10);
  });

  it("F-ERR-DEBOUNCE-COALESCE: production window coalesces burst errors", () => {
    const eng = engine(store, root, {
      maxErrorsBeforePause: 0,
      recoverDebounceMs: 3000,
      sleepSync: () => {},
    });
    const first = eng.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
    });
    const second = eng.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
    });
    expect(first?.kind).toBe("recover");
    expect(second).toBeNull();
    expect(store.getSession("c1")!.error_count).toBe(2);
  });

  it("F-ABORT: user Stop (aborted) does not inject recover or bump error_count", () => {
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    const before = store.getSession("c1")!.error_count;
    const action = eng.handleStop({
      conversationId: "c1",
      status: "aborted",
      loopCount: 0,
    });
    expect(action).toBeNull();
    expect(store.getSession("c1")!.error_count).toBe(before);
    expect(store.getReviewChain("c1")?.pending_followup ?? null).toBeNull();
  });

  it("F-ABORT-CLEAR-RECOVER: aborted drops stale recover pending (not fix/confirm)", () => {
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    store.updateReviewChain("c1", {
      pending_followup: "恢复：上一回合出错。继续当前任务。",
      pending_followup_at: new Date().toISOString(),
    });
    expect(
      eng.handleStop({ conversationId: "c1", status: "aborted", loopCount: 0 }),
    ).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBeNull();

    store.updateReviewChain("c1", {
      pending_followup: "自审确认 2/5 — 角度",
      pending_followup_at: new Date().toISOString(),
    });
    expect(
      eng.handleStop({ conversationId: "c1", status: "aborted", loopCount: 0 }),
    ).toBeNull();
    expect(store.getReviewChain("c1")!.pending_followup).toBe(
      "自审确认 2/5 — 角度",
    );
  });

  it("F-ABORT-CLEAR-CODE-EDITED: aborted drops sticky code_edited, keeps confirm pending", () => {
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    store.updateReviewChain("c1", {
      code_edited: 1,
      pending_followup: "自审确认 2/5 — 角度",
      pending_followup_at: new Date().toISOString(),
      confirm_left: 3,
      chain_pending: 1,
    });
    expect(
      eng.handleStop({ conversationId: "c1", status: "aborted", loopCount: 0 }),
    ).toBeNull();
    const chain = store.getReviewChain("c1")!;
    expect(chain.code_edited).toBe(0);
    expect(chain.pending_followup).toBe("自审确认 2/5 — 角度");
    expect(chain.confirm_left).toBe(3);
    expect(chain.chain_pending).toBe(1);
  });

  it("F-ABORT-NO-PHANTOM-FIX: abort then completed must not open fix from sticky code_edited", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-abort-phantom",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    store.ensureReviewChain("c-abort-phantom");
    store.updateReviewChain("c-abort-phantom", { code_edited: 1 });

    expect(
      eng.handleStop({
        conversationId: "c-abort-phantom",
        status: "aborted",
        loopCount: 0,
      }),
    ).toBeNull();
    expect(store.getReviewChain("c-abort-phantom")!.code_edited).toBe(0);

    const transcript = path.join(root, "t-abort-phantom.jsonl");
    fs.writeFileSync(transcript, "");
    const again = eng.handleStop({
      conversationId: "c-abort-phantom",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(again).toBeNull();
    expect(store.getReviewChain("c-abort-phantom")!.pending_followup).toBeNull();
  });

  it("F-ABORT-AMBIENT-FREEZE-CONFIRM: abort clearing sticky edit freezes into confirm, not stall", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-abort-freeze",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    store.ensureReviewChain("c-abort-freeze");
    // Mid ambient fix after recover soft-reset resumeFix: chain stays armed + sticky edit.
    store.updateReviewChain("c-abort-freeze", {
      fix_round: 7,
      chain_pending: 1,
      code_edited: 1,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: null,
    });
    expect(
      eng.handleStop({
        conversationId: "c-abort-freeze",
        status: "aborted",
        loopCount: 0,
      }),
    ).toBeNull();
    const mid = store.getReviewChain("c-abort-freeze")!;
    expect(mid.code_edited).toBe(0);
    expect(mid.fix_round).toBe(7);
    expect(mid.confirm_left).toBe(5);

    const transcript = path.join(root, "t-abort-freeze.jsonl");
    fs.writeFileSync(transcript, "");
    const after = eng.handleStop({
      conversationId: "c-abort-freeze",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(after?.kind).toBe("review.confirm");
    expect(after?.meta?.n).toBe(1);
  });

  it("F-ABORT-AMBIENT-FIX-PENDING: abort keeps fix tip and re-arms chain_pending for E3", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-abort-fix-tip",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    store.ensureReviewChain("c-abort-fix-tip");
    const tip =
      "自审修复第 7 轮（无硬顶；确认阶段需连续 5 轮无改动）。本轮改过代码。";
    store.updateReviewChain("c-abort-fix-tip", {
      fix_round: 7,
      chain_pending: 0, // recover soft-reset cleared this
      code_edited: 1,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: tip,
      pending_followup_at: new Date().toISOString(),
    });
    expect(
      eng.handleStop({
        conversationId: "c-abort-fix-tip",
        status: "aborted",
        loopCount: 0,
      }),
    ).toBeNull();
    const mid = store.getReviewChain("c-abort-fix-tip")!;
    expect(mid.code_edited).toBe(0);
    expect(mid.pending_followup).toBe(tip);
    expect(mid.chain_pending).toBe(1);
    expect(mid.confirm_left).toBeNull();

    // Tip delivered + agent finished clean → E3 confirm (not silent {}).
    const transcript = path.join(root, "t-abort-fix-tip.jsonl");
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({
          role: "user",
          message: {
            content: [{ type: "text", text: `<user_query>\n${tip}\n</user_query>` }],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: {
            content: [{ type: "text", text: "自审无问题" }],
          },
        }),
      ].join("\n") + "\n",
    );
    const after = eng.handleStop({
      conversationId: "c-abort-fix-tip",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(after?.kind).toBe("review.confirm");
    expect(after?.meta?.n).toBe(1);
    expect(store.getReviewChain("c-abort-fix-tip")!.pending_followup).toMatch(
      /自审确认|Review confirm/,
    );
  });

  it("F-AMBIENT-DELIVERED-FIX-NO-STALL: delivered fix tip with chain_pending=0 still enters confirm", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-ambient-delivered",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    store.ensureReviewChain("c-ambient-delivered");
    const tip = "自审修复第 7 轮（无硬顶）。本轮改过代码。";
    store.updateReviewChain("c-ambient-delivered", {
      fix_round: 7,
      chain_pending: 0,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: tip,
      pending_followup_at: new Date().toISOString(),
    });
    const transcript = path.join(root, "t-ambient-delivered.jsonl");
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({
          role: "user",
          message: {
            content: [{ type: "text", text: `<user_query>\n${tip}\n</user_query>` }],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: {
            content: [{ type: "text", text: "自审无问题" }],
          },
        }),
      ].join("\n") + "\n",
    );
    const after = eng.handleStop({
      conversationId: "c-ambient-delivered",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(after?.kind).toBe("review.confirm");
    expect(after?.meta?.n).toBe(1);
    expect(store.getReviewChain("c-ambient-delivered")!.pending_followup).toMatch(
      /自审确认|Review confirm/,
    );
  });

  it("F-AMBIENT-CLEAR-ARM-ATOMIC: arm failure rolls back delivered tip clear", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-ambient-clear-arm",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    store.ensureReviewChain("c-ambient-clear-arm");
    const tip = "自审修复第 8 轮（无硬顶）。本轮改过代码。";
    store.updateReviewChain("c-ambient-clear-arm", {
      fix_round: 8,
      chain_pending: 0,
      code_edited: 0,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: tip,
      pending_followup_at: new Date().toISOString(),
    });
    const transcript = path.join(root, "t-ambient-clear-arm.jsonl");
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({
          role: "user",
          message: {
            content: [{ type: "text", text: `<user_query>\n${tip}\n</user_query>` }],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: {
            content: [{ type: "text", text: "自审无问题" }],
          },
        }),
      ].join("\n") + "\n",
    );
    const orig = store.updateReviewChain.bind(store);
    store.updateReviewChain = ((id, patch) => {
      // Ambient re-arm after delivered fix only patches chain_pending.
      if (
        id === "c-ambient-clear-arm" &&
        patch.chain_pending === 1 &&
        patch.pending_followup === undefined
      ) {
        throw new Error("arm boom");
      }
      return orig(id, patch);
    }) as typeof store.updateReviewChain;
    try {
      expect(
        eng.handleStop({
          conversationId: "c-ambient-clear-arm",
          status: "completed",
          loopCount: 0,
          transcriptPath: transcript,
        }),
      ).toBeNull();
      const mid = store.getReviewChain("c-ambient-clear-arm")!;
      // Clear+arm share one txn — arm failure must not leave tip gone / unarmed.
      expect(mid.pending_followup).toBe(tip);
      expect(mid.chain_pending).toBe(0);
    } finally {
      store.updateReviewChain = orig;
    }
  });

  it("F-AMBIENT-CLEAR-ARM-STICKY: arm even with code_edited so abort cannot orphan handoff", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-ambient-arm-sticky",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    store.ensureReviewChain("c-ambient-arm-sticky");
    const tip = "自审修复第 9 轮（无硬顶）。本轮改过代码。";
    const recoverPending =
      "恢复：上一回合出错。继续当前任务（未在执行 checklist）。";
    store.updateReviewChain("c-ambient-arm-sticky", {
      fix_round: 9,
      chain_pending: 0,
      code_edited: 1,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: tip,
      pending_followup_at: new Date().toISOString(),
    });
    const transcript = path.join(root, "t-ambient-arm-sticky.jsonl");
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({
          role: "user",
          message: {
            content: [{ type: "text", text: `<user_query>\n${tip}\n</user_query>` }],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: {
            content: [{ type: "text", text: "自审无问题" }],
          },
        }),
      ].join("\n") + "\n",
    );
    // Outer early E2 sees recover → skip; live row stays delivered fix tip so
    // clear+arm runs with sticky edit still set. Only the first ensure (completed
    // stop snapshot) is mocked — later updateReviewChain ensure must see live.
    const origEnsure = store.ensureReviewChain.bind(store);
    let ensureCalls = 0;
    store.ensureReviewChain = ((id: string) => {
      const snap = origEnsure(id);
      if (id !== "c-ambient-arm-sticky") return snap;
      ensureCalls += 1;
      if (ensureCalls === 1) {
        return {
          ...snap,
          code_edited: 1,
          pending_followup: recoverPending,
          pending_followup_at: new Date().toISOString(),
        };
      }
      return snap;
    }) as typeof store.ensureReviewChain;
    const orig = store.updateReviewChain.bind(store);
    store.updateReviewChain = ((id, patch) => {
      const out = orig(id, patch);
      // Simulate abort clearing sticky edit immediately after ambient arm —
      // chain_pending must remain so this stop can still E3 (not silent stall).
      if (
        id === "c-ambient-arm-sticky" &&
        patch.chain_pending === 1 &&
        patch.pending_followup === undefined
      ) {
        store.clearCodeEdited(id);
      }
      return out;
    }) as typeof store.updateReviewChain;
    try {
      const after = eng.handleStop({
        conversationId: "c-ambient-arm-sticky",
        status: "completed",
        loopCount: 0,
        transcriptPath: transcript,
      });
      expect(after?.kind).toBe("review.confirm");
      expect(after?.meta?.n).toBe(1);
      expect(store.getReviewChain("c-ambient-arm-sticky")!.code_edited).toBe(0);
    } finally {
      store.updateReviewChain = orig;
      store.ensureReviewChain = origEnsure;
    }
  });

  it("F-ABORT-AMBIENT-STALE-EDIT: stale fix_round + sticky edit must not phantom-confirm on abort", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-abort-stale-edit",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    store.ensureReviewChain("c-abort-stale-edit");
    // Leftover fix_round (ambient stale) + fresh afterFileEdit sticky — abort must
    // only clear code_edited, not open a confirm chain.
    store.updateReviewChain("c-abort-stale-edit", {
      fix_round: 3,
      chain_pending: 0,
      code_edited: 1,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: null,
    });
    expect(
      eng.handleStop({
        conversationId: "c-abort-stale-edit",
        status: "aborted",
        loopCount: 0,
      }),
    ).toBeNull();
    const mid = store.getReviewChain("c-abort-stale-edit")!;
    expect(mid.code_edited).toBe(0);
    expect(mid.confirm_left).toBeNull();
    expect(mid.chain_pending).toBe(0);

    const transcript = path.join(root, "t-abort-stale-edit.jsonl");
    fs.writeFileSync(transcript, "");
    expect(
      eng.handleStop({
        conversationId: "c-abort-stale-edit",
        status: "completed",
        loopCount: 0,
        transcriptPath: transcript,
      }),
    ).toBeNull();
  });

  it("F-ABORT-AMBIENT-CUSTOM-PENDING: abort must not arm confirm_left over non-fix pending", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-abort-custom",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    store.ensureReviewChain("c-abort-custom");
    store.updateReviewChain("c-abort-custom", {
      fix_round: 3,
      chain_pending: 1,
      code_edited: 1,
      confirm_left: null,
      item_confirm_complete: 0,
      pending_followup: "Custom review pass still running",
      pending_followup_at: new Date().toISOString(),
    });
    expect(
      eng.handleStop({
        conversationId: "c-abort-custom",
        status: "aborted",
        loopCount: 0,
      }),
    ).toBeNull();
    const mid = store.getReviewChain("c-abort-custom")!;
    expect(mid.code_edited).toBe(0);
    expect(mid.confirm_left).toBeNull();
    expect(mid.pending_followup).toBe("Custom review pass still running");
    // Do not force chain_pending=1 over a non-fix tip either — leave as-is.
    expect(mid.chain_pending).toBe(1);
  });

  it("F-ABORT-NO-AMBIENT: aborted without session does not bootstrap ambient recover", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      maxErrorsBeforePause: 0,
    });
    const action = eng.handleStop({
      conversationId: "c-abort-no-session",
      status: "aborted",
      loopCount: 0,
    });
    expect(action).toBeNull();
    expect(store.getSession("c-abort-no-session")).toBeNull();
  });

  it("F-ABORT-NO-REDELIVER: after abort, completed stop does not redeliver recover", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      maxErrorsBeforePause: 0,
    });
    eng.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
    });
    expect(store.getReviewChain("c1")!.pending_followup).toMatch(/恢复|Recover/);
    eng.handleStop({
      conversationId: "c1",
      status: "aborted",
      loopCount: 0,
    });
    expect(store.getReviewChain("c1")!.pending_followup).toBeNull();

    const transcript = path.join(root, "t-abort.jsonl");
    fs.writeFileSync(transcript, "");
    const again = eng.handleStop({
      conversationId: "c1",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    // Must not redeliver recover; executing no-code without soft evidence now nudges.
    expect(again?.kind).not.toMatch(/recover/i);
    expect(again?.kind).toBe("need_evidence");
  });

  it("F-ABORT-PORT: cancelled / error+abort-markers must not recover via Cursor port", () => {
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    const before = store.getSession("c1")!.error_count;
    store.updateReviewChain("c1", { code_edited: 1 });

    expect(
      handleStop(eng, {
        conversation_id: "c1",
        status: "cancelled",
      }),
    ).toEqual({});
    expect(store.getSession("c1")!.error_count).toBe(before);
    expect(store.getReviewChain("c1")!.code_edited).toBe(0);

    store.updateReviewChain("c1", { code_edited: 1 });
    expect(
      handleStop(eng, {
        conversation_id: "c1",
        status: "canceled",
      }),
    ).toEqual({});
    expect(store.getReviewChain("c1")!.code_edited).toBe(0);

    store.updateReviewChain("c1", { code_edited: 1 });
    expect(
      handleStop(eng, {
        conversation_id: "c1",
        status: "error",
        error: "User aborted/interrupted manually.",
      }),
    ).toEqual({});
    expect(store.getSession("c1")!.error_count).toBe(before);
    expect(store.getReviewChain("c1")?.pending_followup ?? null).toBeNull();
    expect(store.getReviewChain("c1")!.code_edited).toBe(0);

    expect(
      handleStop(eng, {
        conversation_id: "c1",
        status: "failed",
        error: { message: "User aborted the request" },
      }),
    ).toEqual({});

    expect(
      handleStop(eng, {
        conversation_id: "c1",
        status: "error",
        error: ["User aborted/interrupted manually."],
      }),
    ).toEqual({});

    expect(
      handleStop(eng, {
        conversation_id: "c1",
        status: "error",
        error: {
          get message() {
            throw new Error("hostile getter");
          },
        },
      }).followup_message,
    ).toMatch(/恢复|Recover/);

    // Genuine error still recovers through the port.
    const recovered = handleStop(eng, {
      conversation_id: "c1",
      status: "error",
      error: "Tool call failed: ENOENT",
    });
    expect(recovered.followup_message).toMatch(/恢复|Recover/);
    expect(recovered.loop).toBe(true);
  });

  it("F-ERR-5: maxErrorsBeforePause=5 pauses on 5th error", () => {
    const eng = engine(store, root, { maxErrorsBeforePause: 5 });
    for (let i = 0; i < 4; i++) {
      expect(
        eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 })
          ?.kind,
      ).toBe("recover");
    }
    expect(store.getSession("c1")!.paused).toBe(0);
    eng.handleStop({ conversationId: "c1", status: "error", loopCount: 0 });
    expect(store.getSession("c1")!.paused_reason).toBe("repeated_errors");
    expect(store.getSession("c1")!.error_count).toBe(5);
  });

  it("F-ERR-PLAN: planning error injects recover_planning (armed=0)", () => {
    const eng = engine(store, root, { maxErrorsBeforePause: 0 });
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "_pending",
    });
    const action = eng.handleStop({
      conversationId: "c1",
      status: "error",
      loopCount: 0,
    });
    expect(action?.kind).toBe("recover");
    expect(action?.message).toMatch(/planning|规划|RUN/i);
    expect(action?.loop).toBe(true);
    expect(store.getSession("c1")!.error_count).toBe(1);
  });

  it("F-ERR-AMBIENT: project scope error bootstraps session and injects recover_ambient", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    expect(store.getSession("c-ambient-err")).toBeNull();
    const action = eng.handleStop({
      conversationId: "c-ambient-err",
      status: "error",
      loopCount: 0,
    });
    expect(action?.kind).toBe("recover");
    expect(action?.message).toMatch(/checklist|current work|任务|Autopilot RUN/i);
    expect(action?.loop).toBe(true);
    expect(store.getSession("c-ambient-err")?.phase).toBe("idle");
    expect(store.getSession("c-ambient-err")?.armed).toBe(1);
    expect(store.getSession("c-ambient-err")!.error_count).toBe(1);
  });

  it("F-ERR-AMBIENT-NO: executing_only error without session does not recover", () => {
    const eng = engine(store, root, { reviewScope: "executing_only", maxErrorsBeforePause: 0 });
    const action = eng.handleStop({
      conversationId: "c-no-session",
      status: "error",
      loopCount: 0,
    });
    expect(action).toBeNull();
    expect(store.getSession("c-no-session")).toBeNull();
  });

  it("F-ERR-AMBIENT-DONE: completed after error recover does not arm review chain", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-done",
      status: "error",
      loopCount: 0,
    });
    expect(store.getReviewChain("c-ambient-done")!.chain_pending).toBe(0);
    expect(store.getReviewChain("c-ambient-done")!.code_edited).toBe(0);
    const done = eng.handleStop({
      conversationId: "c-ambient-done",
      status: "completed",
      loopCount: 0,
    });
    expect(done).toBeNull();
  });

  it("F-ERR-DONE-RECOVER: done+project error injects recover_ambient and keeps phase=done", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    store.upsertSession({
      conversation_id: "c-done-err",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "shipped",
      checklist_path: cp,
    });
    store.ensureReviewChain("c-done-err");
    const action = eng.handleStop({
      conversationId: "c-done-err",
      status: "error",
      loopCount: 0,
    });
    expect(action?.kind).toBe("recover");
    // Ambient copy — not checklist `recover` ("继续当前任务。") alone.
    expect(action?.message).toMatch(/未在执行 checklist|RUN is not active|current work/i);
    expect(action?.loop).toBe(true);
    expect(store.getSession("c-done-err")!.phase).toBe("done");
    expect(store.getSession("c-done-err")!.armed).toBe(0);
    expect(store.getSession("c-done-err")!.error_count).toBe(1);
    expect(store.getReviewChain("c-done-err")!.pending_followup).toMatch(
      /恢复|Recover/,
    );
  });

  it("F-ERR-DONE-TERMINAL-PENDING: recover covers leftover 全部完成 pending", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    store.upsertSession({
      conversation_id: "c-done-term",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "shipped",
      checklist_path: cp,
    });
    store.ensureReviewChain("c-done-term");
    store.updateReviewChain("c-done-term", {
      pending_followup:
        "全部完成。自审确认已干净通过（确认轮不 commit）。勾选最后一项 [x]。",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 0,
    });
    const action = eng.handleStop({
      conversationId: "c-done-term",
      status: "error",
      loopCount: 0,
    });
    expect(action?.kind).toBe("recover");
    expect(action?.message).toMatch(/未在执行 checklist|RUN is not active|current work/i);
    expect(store.getReviewChain("c-done-term")!.pending_followup).toMatch(
      /恢复|Recover/,
    );
    expect(store.getReviewChain("c-done-term")!.pending_followup).not.toMatch(
      /^全部完成/,
    );
    expect(store.getSession("c-done-term")!.phase).toBe("done");
  });

  it("F-ERR-DONE-ABORT: user abort on done does not recover", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    store.upsertSession({
      conversation_id: "c-done-abort",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "shipped",
      checklist_path: cp,
    });
    const action = eng.handleStop({
      conversationId: "c-done-abort",
      status: "aborted",
      loopCount: 0,
    });
    expect(action).toBeNull();
    expect(store.getSession("c-done-abort")!.phase).toBe("done");
    expect(store.getSession("c-done-abort")!.error_count).toBe(0);
  });

  it("F-ERR-DONE-PAUSED: paused done does not recover", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    store.upsertSession({
      conversation_id: "c-done-paused",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 1,
      paused_reason: "human_gate",
      track_id: "shipped",
      checklist_path: cp,
    });
    const action = eng.handleStop({
      conversationId: "c-done-paused",
      status: "error",
      loopCount: 0,
    });
    expect(action).toBeNull();
    expect(store.getSession("c-done-paused")!.phase).toBe("done");
  });

  it("F-ERR-DONE-EXECUTING-ONLY: done under executing_only does not recover", () => {
    const eng = engine(store, root, {
      reviewScope: "executing_only",
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-done-eo",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "shipped",
      checklist_path: cp,
    });
    const action = eng.handleStop({
      conversationId: "c-done-eo",
      status: "error",
      loopCount: 0,
    });
    expect(action).toBeNull();
    expect(store.getSession("c-done-eo")!.phase).toBe("done");
  });

  it("F-ERR-DONE-ORPHAN-SALVAGE: completed+orphan transcript error recovers on done", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    const transcript = path.join(root, "done-orphan-transcript.jsonl");
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "text", text: "working" }] },
        }),
        JSON.stringify({
          type: "turn_ended",
          status: "error",
          error:
            "You've hit your usage limit Get Cursor Pro for more Agent usage, unlimited Tab, and more.",
        }),
      ].join("\n") + "\n",
    );
    store.upsertSession({
      conversation_id: "c-done-orphan",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "shipped",
      checklist_path: cp,
    });
    store.ensureReviewChain("c-done-orphan");
    const action = eng.handleStop({
      conversationId: "c-done-orphan",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(action?.kind).toBe("recover");
    expect(action?.message).toMatch(/未在执行 checklist|RUN is not active|current work/i);
    expect(store.getSession("c-done-orphan")!.phase).toBe("done");
  });

  it("F-ERR-DONE-CLEAR-DELIVERED: completed clears delivered recover pending without review", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    const recoverMsg =
      "恢复：上一回合出错。继续当前任务（未在执行 checklist）。";
    const transcript = path.join(root, "done-clear-transcript.jsonl");
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({
          type: "turn_ended",
          status: "error",
          error: "tool failed",
        }),
        JSON.stringify({
          role: "user",
          message: {
            content: [
              {
                type: "text",
                text: `<user_query>\n${recoverMsg}\n</user_query>`,
              },
            ],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "text", text: "continued" }] },
        }),
        JSON.stringify({ type: "turn_ended", status: "success" }),
      ].join("\n") + "\n",
    );
    store.upsertSession({
      conversation_id: "c-done-clear",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "shipped",
      checklist_path: cp,
      error_count: 1,
    });
    store.ensureReviewChain("c-done-clear");
    store.updateReviewChain("c-done-clear", {
      pending_followup: recoverMsg,
      pending_followup_at: new Date().toISOString(),
      chain_pending: 0,
      confirm_left: null,
      code_edited: 0,
    });
    const out = eng.handleStop({
      conversationId: "c-done-clear",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c-done-clear")!.pending_followup).toBeNull();
    expect(store.getReviewChain("c-done-clear")!.confirm_left).toBeNull();
    expect(store.getReviewChain("c-done-clear")!.chain_pending).toBe(0);
    expect(store.getSession("c-done-clear")!.phase).toBe("done");
  });

  it("F-ERR-DONE-REDELIVER: completed redelivers undelivered recover on done", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    const recoverMsg =
      "恢复：上一回合出错。继续当前任务（未在执行 checklist）。";
    const transcript = path.join(root, "done-redeliver-transcript.jsonl");
    // Host dropped the inject — tip absent from transcript.
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({
          type: "turn_ended",
          status: "error",
          error: "tool failed",
        }),
        JSON.stringify({ type: "turn_ended", status: "success" }),
      ].join("\n") + "\n",
    );
    store.upsertSession({
      conversation_id: "c-done-redeliver",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "shipped",
      checklist_path: cp,
      error_count: 1,
    });
    store.ensureReviewChain("c-done-redeliver");
    store.updateReviewChain("c-done-redeliver", {
      pending_followup: recoverMsg,
      pending_followup_at: new Date().toISOString(),
      pending_redeliver_at: null,
      chain_pending: 0,
    });
    const out = eng.handleStop({
      conversationId: "c-done-redeliver",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out?.kind).toBe("recover");
    expect(out?.message).toBe(recoverMsg);
    expect(out?.loop).toBe(true);
    expect(store.getSession("c-done-redeliver")!.phase).toBe("done");
  });

  it("F-ERR-DONE-ON: applyOn after done recover still enters planning", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    store.upsertSession({
      conversation_id: "c-done-on",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "shipped",
      checklist_path: cp,
    });
    const action = eng.handleStop({
      conversationId: "c-done-on",
      status: "error",
      loopCount: 0,
    });
    expect(action?.kind).toBe("recover");
    expect(store.getReviewChain("c-done-on")!.pending_followup).toMatch(
      /恢复|Recover/,
    );
    const on = applyOn(store, "c-done-on", root);
    expect(on.ok).toBe(true);
    expect(store.getSession("c-done-on")!.phase).toBe("planning");
    expect(store.getSession("c-done-on")!.paused).toBe(0);
    // applyOn clears terminal tips only; recover may remain (not a 全部完成 ghost).
    expect(store.getReviewChain("c-done-on")!.pending_followup).toMatch(
      /恢复|Recover/,
    );
  });

  it("F-ERR-DONE-AMBIENT-DONE: completed after done recover clear does not arm review", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    const recoverMsg =
      "恢复：上一回合出错。继续当前任务（未在执行 checklist）。";
    const transcript = path.join(root, "done-ambient-done-transcript.jsonl");
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({
          type: "turn_ended",
          status: "error",
          error: "tool failed",
        }),
        JSON.stringify({
          role: "user",
          message: {
            content: [
              {
                type: "text",
                text: `<user_query>\n${recoverMsg}\n</user_query>`,
              },
            ],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "text", text: "ok" }] },
        }),
        JSON.stringify({ type: "turn_ended", status: "success" }),
      ].join("\n") + "\n",
    );
    store.upsertSession({
      conversation_id: "c-done-ad",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "shipped",
      checklist_path: cp,
    });
    store.ensureReviewChain("c-done-ad");
    store.updateReviewChain("c-done-ad", {
      pending_followup: recoverMsg,
      pending_followup_at: new Date().toISOString(),
      chain_pending: 0,
      confirm_left: null,
      code_edited: 0,
      fix_round: 2,
    });
    const out = eng.handleStop({
      conversationId: "c-done-ad",
      status: "completed",
      loopCount: 0,
      transcriptPath: transcript,
    });
    expect(out).toBeNull();
    expect(store.getReviewChain("c-done-ad")!.pending_followup).toBeNull();
    expect(store.getReviewChain("c-done-ad")!.confirm_left).toBeNull();
    expect(store.getReviewChain("c-done-ad")!.chain_pending).toBe(0);
    expect(store.getSession("c-done-ad")!.phase).toBe("done");
  });

  it("F-ERR-DONE-EDIT-REVIVE: product edit after done recover still revives to idle", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: project\n",
    );
    store.upsertSession({
      conversation_id: "c-done-revive",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "shipped",
      checklist_path: cp,
    });
    eng.handleStop({
      conversationId: "c-done-revive",
      status: "error",
      loopCount: 0,
    });
    expect(store.getSession("c-done-revive")!.phase).toBe("done");
    expect(store.getReviewChain("c-done-revive")!.pending_followup).toMatch(
      /恢复|Recover/,
    );
    handleAfterFileEdit(
      store,
      { conversation_id: "c-done-revive", file_path: "src/app.ts" },
      root,
    );
    expect(store.getSession("c-done-revive")!.phase).toBe("idle");
    expect(store.getSession("c-done-revive")!.armed).toBe(1);
    expect(store.getReviewChain("c-done-revive")!.pending_followup).toBeNull();
    expect(store.getReviewChain("c-done-revive")!.code_edited).toBe(1);
  });

  it("F-ERR-AMBIENT-NO-E8: leftover fix_round + loopCount must not E3 after ambient recover", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-e8",
      status: "error",
      loopCount: 0,
    });
    // Stale counters with no active review flags — must not E3 on loopCount alone.
    store.updateReviewChain("c-ambient-e8", {
      fix_round: 3,
      chain_pending: 0,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: null,
    });
    const afterRecover = eng.handleStop({
      conversationId: "c-ambient-e8",
      status: "completed",
      loopCount: 4,
    });
    expect(afterRecover).toBeNull();
    expect(store.getReviewChain("c-ambient-e8")!.confirm_left).toBeNull();
    expect(store.getSession("c-ambient-e8")!.phase).toBe("idle");
  });

  it("F-ERR-AMBIENT-RESUME-FIX: mid-fix error recover resumes E2 after recover completes", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-resume",
      status: "error",
      loopCount: 0,
    });
    // Mid ambient fix (round already advanced) when usage-limit hits
    store.updateReviewChain("c-ambient-resume", {
      fix_round: 1,
      chain_pending: 1,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "自审修复第 1 轮",
    });
    const recover = eng.handleStop({
      conversationId: "c-ambient-resume",
      status: "error",
      loopCount: 2,
    });
    expect(recover?.kind).toBe("recover");
    const mid = store.getReviewChain("c-ambient-resume")!;
    expect(mid.fix_round).toBe(1);
    expect(mid.chain_pending).toBe(1); // resumeFix keeps armed handoff for abort
    expect(mid.code_edited).toBe(1); // force post-recover E2
    expect(mid.confirm_left).toBeNull();
    expect(mid.pending_followup).toMatch(/恢复|Recover|checklist|任务/);

    // Recover tip answered — sticky edit can now open the next fix round.
    store.updateReviewChain("c-ambient-resume", {
      pending_followup: null,
      pending_followup_at: null,
    });

    const after = eng.handleStop({
      conversationId: "c-ambient-resume",
      status: "completed",
      loopCount: 3,
    });
    expect(after?.kind).toBe("review.fix");
    expect(after?.meta?.fixRound).toBe(2);
    expect(store.getReviewChain("c-ambient-resume")!.confirm_left).toBeNull();
  });

  it("F-ERR-AMBIENT-RESUME-FIX-DELIVERED: transcript-cleared recover must not stale-block E2", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-resume-del",
      status: "error",
      loopCount: 0,
    });
    store.updateReviewChain("c-ambient-resume-del", {
      fix_round: 1,
      chain_pending: 1,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "自审修复第 1 轮",
    });
    const recover = eng.handleStop({
      conversationId: "c-ambient-resume-del",
      status: "error",
      loopCount: 2,
    });
    expect(recover?.kind).toBe("recover");
    const tip = store.getReviewChain("c-ambient-resume-del")!.pending_followup!;
    expect(tip).toMatch(/恢复|Recover|checklist|任务/);
    expect(store.getReviewChain("c-ambient-resume-del")!.code_edited).toBe(1);

    // Host delivered the recover tip on the transcript — same completed stop
    // must clear pending and continue to E2 (not stale-block on pre-clear tip).
    const transcript = path.join(root, "t-ambient-resume-del.jsonl");
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({
          role: "user",
          message: {
            content: [{ type: "text", text: `<user_query>\n${tip}\n</user_query>` }],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: {
            content: [{ type: "text", text: "continuing after recover" }],
          },
        }),
      ].join("\n") + "\n",
    );
    expect(
      automationFollowupPresent(readTranscriptTail(transcript), tip),
    ).toBe(true);

    const after = eng.handleStop({
      conversationId: "c-ambient-resume-del",
      status: "completed",
      loopCount: 3,
      transcriptPath: transcript,
    });
    expect(after?.kind).toBe("review.fix");
    expect(after?.meta?.fixRound).toBe(2);
    expect(store.getReviewChain("c-ambient-resume-del")!.pending_followup).toMatch(
      /自审修复|Review fix/,
    );
  });

  it("F-ERR-AMBIENT-RESUME-CONFIRM-EDIT: sticky edit after delivered recover must E2 before E4", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-confirm-edit",
      status: "error",
      loopCount: 0,
    });
    // Mid-confirm + product edit sticky when usage-limit hits.
    store.updateReviewChain("c-ambient-confirm-edit", {
      fix_round: 3,
      chain_pending: 1,
      confirm_left: 3,
      code_edited: 1,
      item_confirm_complete: 0,
      pending_followup: "自审确认 2/5（空值）",
    });
    const recover = eng.handleStop({
      conversationId: "c-ambient-confirm-edit",
      status: "error",
      loopCount: 2,
    });
    expect(recover?.kind).toBe("recover");
    const tip = store.getReviewChain("c-ambient-confirm-edit")!.pending_followup!;
    expect(tip).toMatch(/恢复|Recover|checklist|任务/);
    // Soft-reset preserves mid-confirm + sticky edit.
    expect(store.getReviewChain("c-ambient-confirm-edit")!.confirm_left).toBe(3);
    expect(store.getReviewChain("c-ambient-confirm-edit")!.code_edited).toBe(1);

    const transcript = path.join(root, "t-ambient-confirm-edit.jsonl");
    fs.writeFileSync(
      transcript,
      [
        JSON.stringify({
          role: "user",
          message: {
            content: [{ type: "text", text: `<user_query>\n${tip}\n</user_query>` }],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: {
            content: [{ type: "text", text: "continuing after recover" }],
          },
        }),
      ].join("\n") + "\n",
    );
    expect(
      automationFollowupPresent(readTranscriptTail(transcript), tip),
    ).toBe(true);

    const after = eng.handleStop({
      conversationId: "c-ambient-confirm-edit",
      status: "completed",
      loopCount: 3,
      transcriptPath: transcript,
    });
    // Marker-before-pending: sticky edit must open fix, not stall on E4 refuse.
    expect(after?.kind).toBe("review.fix");
    expect(after?.meta?.fixRound).toBe(4);
  });

  it("F-ERR-E2-MISS-RECOVER-REDELIVER: post-gate E2 TOCTOU must redeliver recover", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    store.upsertSession({
      conversation_id: "c-e2-miss-rec",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
      checklist_path: "",
      track_id: "",
    });
    store.ensureReviewChain("c-e2-miss-rec");
    const recoverPending =
      "恢复：上一回合出错。继续当前任务（未在执行 checklist）。";
    // Simulate post-clear state: sticky edit, mid-confirm, empty pending.
    store.updateReviewChain("c-e2-miss-rec", {
      fix_round: 3,
      chain_pending: 0,
      confirm_left: 3,
      code_edited: 1,
      item_confirm_complete: 0,
      pending_followup: null,
      pending_followup_at: null,
      pending_redeliver_at: null,
    });
    const transcript = path.join(root, "t-e2-miss-rec.jsonl");
    fs.writeFileSync(transcript, "");
    // Skip early E2 tip check by making the outer snapshot look like recover was
    // already cleared, then stamp recover only when post-gate e2Fix locks.
    // Force early path to skip E2: leave code_edited=1 but make first e2Fix see
    // recover via a one-shot pending swap after tryRedeliver/gate would have run.
    // Simpler: call completed with code_edited=0 so early/post-gate E2 skip, then
    // we only need the redeliver-after-e2-miss path — exercise via residue? No.
    //
    // Use getReviewChain sequencing: first reads return empty pending; once
    // exclusiveWrite starts (post-gate e2 — early e2 skipped by pending=recover
    // on ensure snapshot), we need a different setup.
    //
    // Setup: outer chain has recover tip so early E2 skips; tryRedeliver with
    // empty transcript redelivers recover immediately (not the miss path).
    //
    // Instead stamp recover inside e2Fix's fresh read by patching getReviewChain
    // after gate: start with empty pending + code_edited; wrap e2Fix via
    // exclusiveWrite count after tryRedeliver (write 1 = post-gate e2 only when
    // early e2 is skipped). Skip early e2 by setting tip to recover on ensure
    // snapshot while live row is empty — ensure mock:
    const origEnsure = store.ensureReviewChain.bind(store);
    store.ensureReviewChain = ((id: string) => {
      const snap = origEnsure(id);
      // Outer early E2 tip check sees recover → skip; live row stays empty until
      // peer stamps under post-gate e2 (after tryRedeliver no-ops on empty live).
      return {
        ...snap,
        code_edited: 1,
        confirm_left: 3,
        pending_followup: recoverPending,
        pending_followup_at: new Date().toISOString(),
      };
    }) as typeof store.ensureReviewChain;
    const origEx = store.exclusiveWrite.bind(store);
    let writes = 0;
    store.exclusiveWrite = ((fn: Parameters<typeof origEx>[0]) => {
      writes += 1;
      // tryRedeliver may exclusiveWrite; post-gate e2Fix also. Stamp recover
      // before every write so e2Fix fresh read refuses — then redeliver path.
      const ts = new Date().toISOString();
      store.db
        .prepare(
          `UPDATE review_chains SET
            pending_followup = ?, pending_followup_at = ?,
            pending_redeliver_at = NULL, code_edited = 1, confirm_left = 3
           WHERE conversation_id = ?`,
        )
        .run(recoverPending, ts, "c-e2-miss-rec");
      return origEx(fn);
    }) as typeof store.exclusiveWrite;
    try {
      const out = eng.handleStop({
        conversationId: "c-e2-miss-rec",
        status: "completed",
        loopCount: 1,
        transcriptPath: transcript,
      });
      // Live recover must be redelivered (not swallowed by E2/E4 null).
      expect(out?.kind).toBe("recover");
      expect(out?.message).toBe(recoverPending);
      expect(writes).toBeGreaterThan(0);
    } finally {
      store.exclusiveWrite = origEx;
      store.ensureReviewChain = origEnsure;
    }
  });

  it("F-ERR-AMBIENT-RESUME-E5: confirm_left=0 must stay E5-ready (not force another fix)", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-e5",
      status: "error",
      loopCount: 0,
    });
    store.updateReviewChain("c-ambient-e5", {
      fix_round: 6,
      chain_pending: 1,
      confirm_left: 0,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "确认审查",
    });
    const recover = eng.handleStop({
      conversationId: "c-ambient-e5",
      status: "error",
      loopCount: 2,
    });
    expect(recover?.kind).toBe("recover");
    const mid = store.getReviewChain("c-ambient-e5")!;
    expect(mid.confirm_left).toBe(0);
    expect(mid.code_edited).toBe(0);
    expect(mid.chain_pending).toBe(0);

    store.updateReviewChain("c-ambient-e5", {
      pending_followup: null,
      pending_followup_at: null,
    });

    const after = eng.handleStop({
      conversationId: "c-ambient-e5",
      status: "completed",
      loopCount: 3,
    });
    expect(after?.kind).toBe("review_complete");
    expect(store.getReviewChain("c-ambient-e5")!.confirm_left).toBeNull();
  });

  it("F-ERR-AMBIENT-RESUME-CONFIRM: mid-confirm error recover continues E4 (not forced fix)", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-confirm",
      status: "error",
      loopCount: 0,
    });
    store.updateReviewChain("c-ambient-confirm", {
      fix_round: 3,
      chain_pending: 1,
      confirm_left: 3,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "确认审查 2/5",
    });
    const recover = eng.handleStop({
      conversationId: "c-ambient-confirm",
      status: "error",
      loopCount: 2,
    });
    expect(recover?.kind).toBe("recover");
    const mid = store.getReviewChain("c-ambient-confirm")!;
    expect(mid.confirm_left).toBe(3);
    expect(mid.code_edited).toBe(0);
    expect(mid.chain_pending).toBe(0);

    store.updateReviewChain("c-ambient-confirm", {
      pending_followup: null,
      pending_followup_at: null,
    });

    const after = eng.handleStop({
      conversationId: "c-ambient-confirm",
      status: "completed",
      loopCount: 3,
    });
    expect(after?.kind).toBe("review.confirm");
    expect(store.getReviewChain("c-ambient-confirm")!.confirm_left).toBe(2);
  });

  it("F-ERR-AMBIENT-STALE-FIX-ROUND: leftover fix_round alone must not force post-recover E2", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-stale",
      status: "error",
      loopCount: 0,
    });
    // Residue after ambient phantom-E3 gate: fix_round kept, no active review flags.
    store.updateReviewChain("c-ambient-stale", {
      fix_round: 3,
      chain_pending: 0,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: null,
    });
    const recover = eng.handleStop({
      conversationId: "c-ambient-stale",
      status: "error",
      loopCount: 2,
    });
    expect(recover?.kind).toBe("recover");
    expect(store.getReviewChain("c-ambient-stale")!.code_edited).toBe(0);
    expect(store.getReviewChain("c-ambient-stale")!.fix_round).toBe(3);

    const after = eng.handleStop({
      conversationId: "c-ambient-stale",
      status: "completed",
      loopCount: 3,
    });
    expect(after).toBeNull();
    expect(store.getReviewChain("c-ambient-stale")!.confirm_left).toBeNull();
  });

  it("F-ERR-AMBIENT-RESUME-FIX-PENDING: E8-cleared chain_pending but fix pending still resumes E2", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-fix-pending",
      status: "error",
      loopCount: 0,
    });
    store.updateReviewChain("c-ambient-fix-pending", {
      fix_round: 1,
      chain_pending: 0, // clearChainPending mid-fix
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "自审修复第 1 轮（无硬顶）",
    });
    const recover = eng.handleStop({
      conversationId: "c-ambient-fix-pending",
      status: "error",
      loopCount: 2,
    });
    expect(recover?.kind).toBe("recover");
    expect(store.getReviewChain("c-ambient-fix-pending")!.code_edited).toBe(1);

    store.updateReviewChain("c-ambient-fix-pending", {
      pending_followup: null,
      pending_followup_at: null,
    });

    const after = eng.handleStop({
      conversationId: "c-ambient-fix-pending",
      status: "completed",
      loopCount: 3,
    });
    expect(after?.kind).toBe("review.fix");
    expect(after?.meta?.fixRound).toBe(2);
  });

  it("F-ERR-AMBIENT-ATOMIC-RECOVER: soft-reset and recover pending commit; resumeFix keeps chain_pending", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-atomic",
      status: "error",
      loopCount: 0,
    });
    store.updateReviewChain("c-ambient-atomic", {
      fix_round: 2,
      chain_pending: 1,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "Review fix round 2 (no hard cap)",
    });
    const recover = eng.handleStop({
      conversationId: "c-ambient-atomic",
      status: "error",
      loopCount: 1,
    });
    expect(recover?.kind).toBe("recover");
    const mid = store.getReviewChain("c-ambient-atomic")!;
    expect(mid.chain_pending).toBe(1);
    expect(mid.code_edited).toBe(1);
    expect(mid.pending_followup).toMatch(/恢复|Recover|checklist|任务/);
    // Executing path must still leave chain alone — spot-check ambient only here.
  });

  it("F-ERR-AMBIENT-READY-E3: fix done (chain_pending only) must enter confirm after recover, not regress to fix", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-ready-e3",
      status: "error",
      loopCount: 0,
    });
    // Fix followup already delivered/cleared; chain still armed for E3.
    store.updateReviewChain("c-ambient-ready-e3", {
      fix_round: 2,
      chain_pending: 1,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: null,
    });
    const recover = eng.handleStop({
      conversationId: "c-ambient-ready-e3",
      status: "error",
      loopCount: 1,
    });
    expect(recover?.kind).toBe("recover");
    const mid = store.getReviewChain("c-ambient-ready-e3")!;
    expect(mid.code_edited).toBe(0);
    expect(mid.chain_pending).toBe(0);
    expect(mid.confirm_left).toBe(5); // confirmRounds — E4 emits 1/5

    store.updateReviewChain("c-ambient-ready-e3", {
      pending_followup: null,
      pending_followup_at: null,
    });

    const after = eng.handleStop({
      conversationId: "c-ambient-ready-e3",
      status: "completed",
      loopCount: 2,
    });
    expect(after?.kind).toBe("review.confirm");
    expect(after?.meta?.n).toBe(1);
    expect(store.getReviewChain("c-ambient-ready-e3")!.confirm_left).toBe(4);
  });

  it("F-ERR-AMBIENT-READY-E3-STRICT: non-fix pending + chain_pending must not skip into confirm", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-ready-strict",
      status: "error",
      loopCount: 0,
    });
    // Custom/unknown pending still in flight — conservative resume fix, not E3.
    store.updateReviewChain("c-ambient-ready-strict", {
      fix_round: 2,
      chain_pending: 1,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "Custom review pass still running",
    });
    const recover = eng.handleStop({
      conversationId: "c-ambient-ready-strict",
      status: "error",
      loopCount: 1,
    });
    expect(recover?.kind).toBe("recover");
    const mid = store.getReviewChain("c-ambient-ready-strict")!;
    expect(mid.code_edited).toBe(1);
    expect(mid.confirm_left).toBeNull();

    store.updateReviewChain("c-ambient-ready-strict", {
      pending_followup: null,
      pending_followup_at: null,
    });

    const after = eng.handleStop({
      conversationId: "c-ambient-ready-strict",
      status: "completed",
      loopCount: 2,
    });
    expect(after?.kind).toBe("review.fix");
  });

  it("F-ERR-AMBIENT-PARTIAL-FAIL: lock storm disarms chain_pending without unlocked soft-reset", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-partial",
      status: "error",
      loopCount: 0,
    });
    store.updateReviewChain("c-ambient-partial", {
      fix_round: 2,
      chain_pending: 1,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "自审修复第 2 轮",
    });
    const origEx = store.exclusiveWrite.bind(store);
    const origNeut = store.neutralizeReviewChainUnlessRecover.bind(store);
    store.exclusiveWrite = (() => {
      throw new Error("exclusiveWrite boom");
    }) as typeof store.exclusiveWrite;
    store.neutralizeReviewChainUnlessRecover = (() => {
      throw new Error("neutralize boom");
    }) as typeof store.neutralizeReviewChainUnlessRecover;
    try {
      const recover = eng.handleStop({
        conversationId: "c-ambient-partial",
        status: "error",
        loopCount: 1,
      });
      // Lock storm: cannot stamp recover pending — do not return unstamped
      // recover (would double-inject with a successful claimer).
      expect(recover).toBeNull();
      const mid = store.getReviewChain("c-ambient-partial")!;
      // Disarm only — unlocked soft-reset would clear undelivered fix pending.
      expect(mid.chain_pending).toBe(0);
      expect(mid.code_edited).toBe(0);
      expect(mid.pending_followup).toBe("自审修复第 2 轮");
    } finally {
      store.exclusiveWrite = origEx;
      store.neutralizeReviewChainUnlessRecover = origNeut;
    }
    fs.writeFileSync(path.join(root, "t-partial.jsonl"), "");
    const after = eng.handleStop({
      conversationId: "c-ambient-partial",
      status: "completed",
      loopCount: 2,
      transcriptPath: path.join(root, "t-partial.jsonl"),
    });
    expect(after?.kind).toBe("review.fix");
    expect(after?.meta?.redeliver).toBe(true);
  });

  it("F-ERR-AMBIENT-PARTIAL-NEUTRALIZE: lock storm disarms without unlocked soft-reset/wipe", () => {
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    eng.handleStop({
      conversationId: "c-ambient-neut",
      status: "error",
      loopCount: 0,
    });
    store.updateReviewChain("c-ambient-neut", {
      fix_round: 2,
      chain_pending: 1,
      confirm_left: null,
      code_edited: 0,
      item_confirm_complete: 0,
      pending_followup: "自审修复第 2 轮",
    });
    const origEx = store.exclusiveWrite.bind(store);
    store.exclusiveWrite = (() => {
      throw new Error("exclusiveWrite boom");
    }) as typeof store.exclusiveWrite;
    try {
      const recover = eng.handleStop({
        conversationId: "c-ambient-neut",
        status: "error",
        loopCount: 1,
      });
      // Hook must not get unstamped recover under total lock storm.
      expect(recover).toBeNull();
      const mid = store.getReviewChain("c-ambient-neut")!;
      // Only chain_pending disarmed — no unlocked soft-reset (would drop fix
      // pending) and no unlocked neutralize (would wipe resume markers).
      expect(mid.chain_pending).toBe(0);
      expect(mid.code_edited).toBe(0);
      expect(mid.fix_round).toBe(2);
      expect(mid.pending_followup).toBe("自审修复第 2 轮");
    } finally {
      store.exclusiveWrite = origEx;
    }
    fs.writeFileSync(path.join(root, "t-neut.jsonl"), "");
    const after = eng.handleStop({
      conversationId: "c-ambient-neut",
      status: "completed",
      loopCount: 2,
      transcriptPath: path.join(root, "t-neut.jsonl"),
    });
    // Fix pending still redeliverable once locks work again.
    expect(after?.kind).toBe("review.fix");
    expect(after?.meta?.redeliver).toBe(true);
  });

  it("F-SCOPE-PROJECT: ambient edit triggers fix without RUN", () => {
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: project\n",
    );
    const eng = engine(store, root, { reviewScope: "project", maxErrorsBeforePause: 0 });
    handleAfterFileEdit(
      store,
      { conversation_id: "c-ambient", file_path: "src/app.ts" },
      root,
    );
    expect(store.getSession("c-ambient")?.phase).toBe("idle");
    expect(store.getSession("c-ambient")?.armed).toBe(1);
    expect(store.getReviewChain("c-ambient")!.code_edited).toBe(1);
    const fix = eng.handleStop({
      conversationId: "c-ambient",
      status: "completed",
      loopCount: 0,
    });
    expect(fix?.kind).toBe("review.fix");
  });

  it("F-SCOPE-PROJECT: E5 ends with review_complete even with leftover checklist + verify", () => {
    const eng = engine(store, root, {
      reviewScope: "project",
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      maxErrorsBeforePause: 0,
    });
    store.upsertSession({
      conversation_id: "c-plan",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "planning",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.ensureReviewChain("c-plan");
    store.updateReviewChain("c-plan", {
      confirm_left: 0,
      code_edited: 0,
      item_confirm_complete: 0,
      chain_pending: 1,
    });
    const done = eng.handleStop({
      conversationId: "c-plan",
      status: "completed",
      loopCount: 1,
    });
    expect(done?.kind).toBe("review_complete");
    expect(done?.message).toMatch(/^Review complete/);
    expect(done?.message).not.toMatch(
      /Do not start subagents|Do not auto-commit|must reply in/i,
    );
    expect(store.getSession("c-plan")!.phase).toBe("planning");
  });

  it("F-SCOPE-PROJECT: revive done session on next product edit", () => {
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      "review:\n  scope: project\n",
    );
    store.upsertSession({
      conversation_id: "c-done",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    store.ensureReviewChain("c-done");
    store.updateReviewChain("c-done", {
      pending_followup: "All checklist items done. Phase is done.",
      chain_pending: 0,
      confirm_left: null,
      fix_round: 3,
    });
    handleAfterFileEdit(
      store,
      { conversation_id: "c-done", file_path: "src/app.ts" },
      root,
    );
    expect(store.getSession("c-done")!.phase).toBe("idle");
    expect(store.getSession("c-done")!.armed).toBe(1);
    expect(store.getReviewChain("c-done")!.pending_followup).toBeNull();
    expect(store.getReviewChain("c-done")!.code_edited).toBe(1);
    const eng = engine(store, root, { reviewScope: "project" });
    expect(
      eng.handleStop({
        conversationId: "c-done",
        status: "completed",
        loopCount: 0,
      })?.kind,
    ).toBe("review.fix");
  });

  it("F-ITEM: E5b advance zeroes error_count", () => {
    const eng = engine(store, root);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      error_count: 2,
    });
    store.updateReviewChain("c1", { confirm_left: 0, code_edited: 0 });
    expect(stop(eng, "c1")?.kind).toBe("advance");
    expect(store.getSession("c1")!.error_count).toBe(0);
  });

  it("F-STUCK: repeated E5c FAIL → stuck + followup.stuck", () => {
    const reportPath = path.join(root, ".autopilot", "verify-last.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const eng = engine(store, root, {
      verifyEnabled: true,
      verifyCommands: [{ id: "test", required: true }],
      verifyReportPath: reportPath,
      maxIdleStops: 3,
    });
    store.updateReviewChain("c1", { confirm_left: 0, code_edited: 0 });
    expect(stop(eng, "c1")?.kind).toBe("verify_fix");
    expect(stop(eng, "c1")?.kind).toBe("verify_fix");
    const stuck = stop(eng, "c1");
    expect(stuck?.kind).toBe("stuck");
    expect(stuck?.message ?? "").toMatch(/RESUME/);
    expect(stuck?.message ?? "").not.toMatch(/not required|stays armed|无需 RESUME/i);
    expect(store.getSession("c1")!.paused).toBe(1);
    expect(store.getSession("c1")!.paused_reason).toBe("stuck");
    expect(store.getSession("c1")!.armed).toBe(0);
  });
});

describe("F-OFF / F-OFF-DONE / F-ON", () => {
  let root: string;
  let store: StateStore;
  let cp: string;

  beforeEach(() => {
    root = tmpRoot();
    store = StateStore.openMemory(root);
    cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
  });
  afterEach(() => store.close());

  it("F-OFF: executing OFF keeps phase, sets paused+human_gate; review unchanged", () => {
    sessionExecuting(store, root, "c1", cp);
    store.updateReviewChain("c1", {
      confirm_left: 3,
      fix_round: 2,
      chain_pending: 1,
      item_confirm_complete: 0,
    });
    applyOff(store, "c1");
    const s = store.getSession("c1")!;
    expect(s.phase).toBe("executing");
    expect(s.paused).toBe(1);
    expect(s.armed).toBe(0);
    expect(s.paused_reason).toBe("human_gate");
    const r = store.getReviewChain("c1")!;
    expect(r.confirm_left).toBe(3);
    expect(r.fix_round).toBe(2);
    expect(r.chain_pending).toBe(1);

    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      paused: 0,
      paused_reason: null,
      armed: 0,
    });
    applyOff(store, "c1");
    expect(store.getSession("c1")!.paused_reason).toBeNull();

    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      paused: 1,
      paused_reason: "stuck",
      armed: 0,
    });
    applyOff(store, "c1");
    expect(store.getSession("c1")!.paused_reason).toBe("stuck");
  });

  it("F-OFF-DONE: done OFF → idle, not paused", () => {
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "done",
      armed: 0,
      paused: 0,
      track_id: "demo",
      checklist_path: cp,
    });
    applyOff(store, "c1");
    const s = store.getSession("c1")!;
    expect(s.phase).toBe("idle");
    expect(s.paused).toBe(0);
  });

  it("F-OFF-AMBIENT: idle+armed OFF pauses; RESUME re-arms", () => {
    store.upsertSession({
      conversation_id: "c-amb",
      project_root: root,
      code_root: root,
      platform: "cursor",
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    applyOff(store, "c-amb");
    const off = store.getSession("c-amb")!;
    expect(off.phase).toBe("idle");
    expect(off.paused).toBe(1);
    expect(off.armed).toBe(0);
    expect(off.paused_reason).toBe("human_gate");
    applyResume(store, "c-amb");
    const on = store.getSession("c-amb")!;
    expect(on.paused).toBe(0);
    expect(on.armed).toBe(1);
  });

  it("F-ON: executing (incl paused) fail-closed; done → planning", () => {
    sessionExecuting(store, root, "c1", cp, { armed: 0, paused: 1, paused_reason: "human_gate" });
    const bad = applyOn(store, "c1", root);
    expect(bad.ok).toBe(false);

    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "done",
      armed: 0,
      paused: 0,
    });
    const ok = applyOn(store, "c1", root);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.session.phase).toBe("planning");
      expect(ok.session.paused).toBe(0);
    }
  });

  it("F-ON: clears terminal done/review_complete pending (not fix/confirm)", () => {
    store.upsertSession({
      conversation_id: "c-done-tip",
      project_root: root,
      code_root: root,
      phase: "done",
      armed: 0,
      paused: 0,
    });
    store.ensureReviewChain("c-done-tip");
    store.updateReviewChain("c-done-tip", {
      pending_followup: "全部完成。自审确认已干净通过（确认轮不 commit）。",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 0,
    });
    expect(applyOn(store, "c-done-tip", root).ok).toBe(true);
    expect(store.getReviewChain("c-done-tip")!.pending_followup).toBeNull();

    store.upsertSession({
      conversation_id: "c-rc-tip",
      project_root: root,
      code_root: root,
      phase: "idle",
      armed: 1,
      paused: 0,
    });
    store.ensureReviewChain("c-rc-tip");
    store.updateReviewChain("c-rc-tip", {
      pending_followup:
        "Review complete. All 5 confirm rounds passed; the review chain has ended.",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 0,
    });
    expect(applyOn(store, "c-rc-tip", root).ok).toBe(true);
    expect(store.getReviewChain("c-rc-tip")!.pending_followup).toBeNull();

    store.upsertSession({
      conversation_id: "c-fix-tip",
      project_root: root,
      code_root: root,
      phase: "planning",
      armed: 0,
      paused: 0,
    });
    store.ensureReviewChain("c-fix-tip");
    store.updateReviewChain("c-fix-tip", {
      pending_followup: "自审修复 第 1 轮：缺陷优先",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      code_edited: 1,
    });
    expect(applyOn(store, "c-fix-tip", root).ok).toBe(true);
    expect(store.getReviewChain("c-fix-tip")!.pending_followup).toMatch(
      /^自审修复/,
    );
  });
});

describe("F-RUN / F-E8 triggers + list-tracks", () => {
  it("F-RUN: runnable includes planning; _pending without checklist rejects RUN", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    writeChecklist(root, "auth", `- [ ] a — A\n`);
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "planning",
      track_id: "auth",
      checklist_path: path.join(root, "plans", "auth", "checklist.md"),
      armed: 0,
      paused: 0,
    });
    const runnable = listTracks(root, store, "runnable");
    expect(runnable.some((t) => t.slug === "auth")).toBe(true);
    expect(isRunnableTrack(runnable[0]!)).toBe(true);

    expect(
      canEnterExecuting({
        slug: "_pending",
        checklistPath: "",
        paused: false,
        projectRoot: root,
      }).ok,
    ).toBe(false);
    store.close();
  });

  it("listTracks: symlinked plan.md falls back to slug; symlinked checklist counts 0", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const trackDir = path.join(root, "plans", "auth");
    fs.mkdirSync(trackDir, { recursive: true });
    const realPlan = path.join(root, "real-plan.md");
    fs.writeFileSync(realPlan, `# Secret Title\n`);
    fs.symlinkSync(realPlan, path.join(trackDir, "plan.md"));
    const realCl = path.join(root, "real-cl.md");
    fs.writeFileSync(realCl, `- [ ] a — A\n`);
    fs.symlinkSync(realCl, path.join(trackDir, "checklist.md"));
    const tracks = listTracks(root, store, "all");
    const auth = tracks.find((t) => t.slug === "auth");
    expect(auth).toBeTruthy();
    expect(auth!.title).toBe("auth");
    expect(auth!.checklistTotal).toBe(0);
    expect(auth!.checklistDone).toBe(0);
    expect(
      canEnterExecuting({
        slug: "auth",
        checklistPath: path.join(trackDir, "checklist.md"),
        paused: false,
        projectRoot: root,
      }).ok,
    ).toBe(false);
    store.close();
  });

  it("listTracks: refuses plansDir that is a symlink escape", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-out-"));
    try {
      const evilTrack = path.join(outside, "leaked");
      fs.mkdirSync(evilTrack, { recursive: true });
      fs.writeFileSync(path.join(evilTrack, "plan.md"), `# Outside Secret\n`);
      fs.writeFileSync(path.join(evilTrack, "checklist.md"), `- [ ] x — X\n`);
      fs.symlinkSync(outside, path.join(root, "plans"));
      const tracks = listTracks(root, store, "all");
      expect(tracks).toEqual([]);
      expect(tracks.some((t) => t.title.includes("Outside"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    store.close();
  });

  it("listTracks: refuses plansDir relative path that escapes the project", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sib-"));
    try {
      const evilTrack = path.join(sibling, "leaked");
      fs.mkdirSync(evilTrack, { recursive: true });
      fs.writeFileSync(path.join(evilTrack, "plan.md"), `# Sibling Secret\n`);
      fs.writeFileSync(path.join(evilTrack, "checklist.md"), `- [ ] y — Y\n`);
      // plansDir = ../<siblingBasename> relative to root
      const rel = path.relative(root, sibling);
      expect(rel.startsWith("..")).toBe(true);
      const tracks = listTracks(root, store, "all", rel);
      expect(tracks).toEqual([]);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
    store.close();
  });

  it("listTracks: refuses absolute / backslash / tilde plansDir", () => {
    const root = tmpRoot();
    expect(listTracks(root, undefined, "all", "/tmp/plans")).toEqual([]);
    expect(listTracks(root, undefined, "all", "~/.plans")).toEqual([]);
    expect(listTracks(root, undefined, "all", "plans\\evil")).toEqual([]);
    expect(listTracks(root, undefined, "all", "plans\nfoo")).toEqual([]);
  });

  it("canEnterExecuting: refuses checklist whose realpath escapes the project", () => {
    const root = tmpRoot();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cl-"));
    try {
      const cp = path.join(outside, "checklist.md");
      fs.writeFileSync(cp, `- [ ] z — Z\n`);
      expect(
        canEnterExecuting({
          slug: "auth",
          checklistPath: cp,
          paused: false,
          projectRoot: root,
        }),
      ).toEqual({ ok: false, reason: "checklist outside project" });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("listTracks: padded projectRoot still lists in-project tracks", () => {
    const root = tmpRoot();
    const trackDir = path.join(root, "plans", "auth");
    fs.mkdirSync(trackDir, { recursive: true });
    fs.writeFileSync(path.join(trackDir, "checklist.md"), `- [ ] a — A\n`);
    fs.writeFileSync(path.join(trackDir, "plan.md"), `# Auth\n`);
    const tracks = listTracks(`  ${root}  `, undefined, "all");
    expect(tracks.map((t) => t.slug)).toEqual(["auth"]);
  });

  it("isRealpathInsideProject: relative target resolves against projectRoot not cwd", () => {
    const root = tmpRoot();
    const trackDir = path.join(root, "plans", "auth");
    fs.mkdirSync(trackDir, { recursive: true });
    const cp = path.join(trackDir, "checklist.md");
    fs.writeFileSync(cp, `- [ ] a — A\n`);
    const prev = process.cwd();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cwd-"));
    try {
      process.chdir(other);
      // Relative to project — must succeed even when cwd is elsewhere.
      expect(isRealpathInsideProject(root, "plans/auth/checklist.md")).toBe(
        true,
      );
      // Padded projectRoot should still resolve (trim).
      expect(
        isRealpathInsideProject(`  ${root}  `, "plans/auth/checklist.md"),
      ).toBe(true);
      // Absolute outside still refused.
      const evil = path.join(other, "evil.md");
      fs.writeFileSync(evil, "x");
      expect(isRealpathInsideProject(root, evil)).toBe(false);
    } finally {
      process.chdir(prev);
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("F-E8: RUN/ON do not clear chain; normal message clears chain_pending", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n`);
    sessionExecuting(store, root, "c1", cp);
    store.updateReviewChain("c1", {
      chain_pending: 1,
      confirm_left: 2,
      pending_followup: "Review confirm 3/5 undelivered",
      pending_followup_at: new Date().toISOString(),
    });

    handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "Autopilot RUN · demo" },
      root,
    );
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);

    handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "hello world ordinary chat" },
      root,
    );
    const afterChat = store.getReviewChain("c1")!;
    expect(afterChat.chain_pending).toBe(0);
    // Must keep undelivered pending — wiping it would let the next stop skip a lens.
    expect(afterChat.pending_followup).toBe("Review confirm 3/5 undelivered");
    expect(afterChat.confirm_left).toBe(2);

    // Recover pending is not a lens — any user submit (incl. triggers) must drop
    // it so RESUME / RUN-same-track cannot resurrect「恢复：上一回合出错」.
    store.updateReviewChain("c1", {
      chain_pending: 0,
      pending_followup: "恢复：上一回合出错。继续当前任务（未在执行 checklist）。",
      pending_followup_at: new Date().toISOString(),
    });
    handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "换个话题继续聊" },
      root,
    );
    expect(store.getReviewChain("c1")!.pending_followup).toBeNull();

    store.updateReviewChain("c1", {
      pending_followup: "恢复：上一回合出错。继续当前任务。",
      pending_followup_at: new Date().toISOString(),
    });
    handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "Autopilot RESUME" },
      root,
    );
    expect(store.getReviewChain("c1")!.pending_followup).toBeNull();

    // Trigger must not wipe fix/confirm pending (lens redelivery).
    store.updateReviewChain("c1", {
      pending_followup: "Review confirm 3/5 undelivered",
      pending_followup_at: new Date().toISOString(),
      chain_pending: 1,
      confirm_left: 2,
    });
    handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "Autopilot RESUME" },
      root,
    );
    expect(store.getReviewChain("c1")!.pending_followup).toBe(
      "Review confirm 3/5 undelivered",
    );

    expect(isHarnessFollowupMessage("Review fix round 1: ...")).toBe(true);
    expect(isHarnessFollowupMessage("自审确认 1/5 — 角度")).toBe(true);
    expect(isHarnessFollowupMessage("恢复一下备份")).toBe(false);
    expect(
      isHarnessFollowupMessage(
        "<user_query>\n恢复：上一回合出错。继续当前任务。\n</user_query>",
      ),
    ).toBe(true);
    expect(
      isHarnessFollowupMessage(
        "<user_query>\n<timestamp>Saturday, Aug 29, 2026, 8:14 PM (UTC+8)</timestamp>\n恢复：上一回合出错。继续当前任务。\n</user_query>",
      ),
    ).toBe(true);
    expect(parseTrigger({ prompt: "/autopilot-on build comments", conversationId: "c1", projectRoot: root })?.kind).toBe("on");

    // E8: Autopilot recover followup must not clear chain_pending
    store.updateReviewChain("c1", { chain_pending: 1 });
    handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "恢复：上一回合出错。继续当前任务。" },
      root,
    );
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);

    store.updateReviewChain("c1", { chain_pending: 1 });
    handleBeforeSubmitPrompt(
      store,
      {
        conversation_id: "c1",
        prompt:
          "<user_query>\n恢复：上一回合出错。继续当前任务。\n</user_query>",
      },
      root,
    );
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);

    store.updateReviewChain("c1", { chain_pending: 1 });
    handleBeforeSubmitPrompt(
      store,
      {
        conversation_id: "c1",
        prompt:
          "<user_query>\n<timestamp>t</timestamp>\n恢复：上一回合出错。继续当前任务。\n</user_query>",
      },
      root,
    );
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);
    store.close();
  });
});

describe("F-HOOK port-cursor", () => {
  it("stop returns loop+followup; submit continue:false on ON while executing", () => {
    const root = tmpRoot();
    const store = StateStore.openMemory(root);
    const cp = writeChecklist(root, "demo", `- [ ] a — A\n- [ ] b — B\n`);
    sessionExecuting(store, root, "c1", cp);
    store.updateReviewChain("c1", { code_edited: 1 });

    const eng = engine(store, root);
    const out = handleStop(eng, {
      conversation_id: "c1",
      status: "completed",
      loop_count: 0,
    });
    expect(out.loop).toBe(true);
    expect(out.followup_message).toBeTruthy();

    // Pause-threshold upsert failure → stuck text without loop (must not spin).
    store.clearPendingFollowup("c1");
    store.upsertSession({
      conversation_id: "c1",
      project_root: root,
      code_root: root,
      phase: "executing",
      armed: 1,
      paused: 0,
      error_count: 2,
    });
    const engPause = engine(store, root, { maxErrorsBeforePause: 3 });
    const origUpsert = store.upsertSession.bind(store);
    store.upsertSession = (() => {
      throw new Error("database is locked");
    }) as typeof store.upsertSession;
    try {
      const halted = handleStop(engPause, {
        conversation_id: "c1",
        status: "error",
        loop_count: 0,
      });
      expect(halted.followup_message).toBeTruthy();
      expect(halted.loop).toBeUndefined();
      expect(store.getReviewChain("c1")?.pending_followup ?? null).toBeNull();
    } finally {
      store.upsertSession = origUpsert;
    }

    const blocked = handleBeforeSubmitPrompt(
      store,
      { conversation_id: "c1", prompt: "/autopilot-on something" },
      root,
    );
    expect(blocked.continue).toBe(false);
    expect(blocked.user_message).toBeTruthy();
    expect(blocked.userMessage).toBe(blocked.user_message);

    handleAfterFileEdit(store, {
      conversation_id: "c1",
      file_path: "src/app.ts",
    }, root);
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);

    handleAfterFileEdit(store, {
      conversation_id: "c1",
      file_path: "plans/demo/plan.md",
    }, root);
    // still 1 from before; plans do not clear
    expect(store.getReviewChain("c1")!.code_edited).toBe(1);

    applyResumeReview(store, "c1");
    expect(store.getReviewChain("c1")!.chain_pending).toBe(1);
    store.close();
  });
});
