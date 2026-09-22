import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendArchiveSuggestTip,
  createConfiguredReviewEngine,
  DEFAULT_ARCHIVE_SUGGEST_TIP,
  ReviewEngine,
  StateStore,
} from "../src/index.js";
import type { FollowupLocaleBundle } from "../src/review-i18n.js";

const localesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../i18n/locales",
);

function loadFollowupLocale(code: "en" | "zh-CN"): FollowupLocaleBundle {
  return JSON.parse(
    fs.readFileSync(path.join(localesDir, `${code}.json`), "utf8"),
  ) as FollowupLocaleBundle;
}

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ah-archive-suggest-"));
}

describe("appendArchiveSuggestTip (gate B)", () => {
  it("appends only for done and review_complete when enabled", () => {
    const tip = "TIP_MARKER /autopilot-archive";
    expect(appendArchiveSuggestTip("done", "Done base.", true, tip)).toBe(
      "Done base. TIP_MARKER /autopilot-archive",
    );
    expect(
      appendArchiveSuggestTip("review_complete", "RC base.", true, tip),
    ).toBe("RC base. TIP_MARKER /autopilot-archive");
    expect(appendArchiveSuggestTip("advance", "Adv.", true, tip)).toBe("Adv.");
    expect(appendArchiveSuggestTip("done", "Done base.", false, tip)).toBe(
      "Done base.",
    );
  });

  it("defaults tip and does not duplicate", () => {
    const once = appendArchiveSuggestTip("done", "Base.", true, undefined);
    expect(once).toContain(DEFAULT_ARCHIVE_SUGGEST_TIP);
    expect(once).toMatch(/Optional — not required/);
    const twice = appendArchiveSuggestTip("done", once, true, undefined);
    expect(twice).toBe(once);
  });

  it("still appends when tip text appears mid-message but not as suffix", () => {
    const tip = "run /autopilot-archive tip-end";
    const mid = `Mention ${tip} early. Done body.`;
    expect(appendArchiveSuggestTip("done", mid, true, tip)).toBe(
      `${mid} ${tip}`,
    );
  });

  it("does not invent a tip-only message from empty base", () => {
    expect(appendArchiveSuggestTip("done", "", true, "TIP")).toBe("");
    expect(appendArchiveSuggestTip("done", "   ", true, "TIP")).toBe("   ");
  });
});

describe("createConfiguredReviewEngine gate B from specs_dir", () => {
  let root = "";
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  function writeDoneFixture(specsDir: string | null): string {
    root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    fs.mkdirSync(path.join(root, "plans", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "plans", "demo", "checklist.md"),
      "- [ ] only — One\n",
      "utf8",
    );
    const artifacts =
      specsDir == null
        ? `artifacts:\n  plans_dir: plans\n`
        : `artifacts:\n  plans_dir: plans\n  specs_dir: ${specsDir}\n`;
    fs.writeFileSync(
      path.join(root, ".autopilot", "config.yml"),
      `locale: en
${artifacts}review:
  confirm_rounds: 1
  scope: executing_only
`,
      "utf8",
    );
    return path.join(root, "plans", "demo", "checklist.md");
  }

  it("done followup includes archive tip when specs_dir configured", () => {
    const checklistPath = writeDoneFixture("docs/autopilot/specs");
    const store = new StateStore(root);
    try {
      const cid = "archive-gate-b-aaaa-bbbb-cccc-ddddeeee0001";
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "cursor",
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: checklistPath,
      });
      store.ensureReviewChain(cid);
      store.updateReviewChain(cid, { confirm_left: 0, code_edited: 0 });
      const engine = createConfiguredReviewEngine(store, root);
      const action = engine.handleStop({
        conversationId: cid,
        status: "completed",
        loopCount: 0,
      });
      expect(action?.kind).toBe("done");
      expect(action?.message).toMatch(/\/autopilot-archive/);
      expect(action?.message).toMatch(/Behavior deltas/);
      expect(action?.message).toMatch(/Optional — not required/);
      expect(action?.message).not.toMatch(/\bmust run \/autopilot-archive\b/i);
    } finally {
      store.close();
    }
  });

  it("done followup omits archive tip when specs_dir unset", () => {
    const checklistPath = writeDoneFixture(null);
    const store = new StateStore(root);
    try {
      const cid = "archive-gate-off-aaaa-bbbb-cccc-ddddeeee0002";
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "cursor",
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: checklistPath,
      });
      store.ensureReviewChain(cid);
      store.updateReviewChain(cid, { confirm_left: 0, code_edited: 0 });
      const engine = createConfiguredReviewEngine(store, root);
      const action = engine.handleStop({
        conversationId: cid,
        status: "completed",
        loopCount: 0,
      });
      expect(action?.kind).toBe("done");
      expect(action?.message).not.toMatch(/\/autopilot-archive/);
      expect(action?.message).not.toMatch(/Behavior deltas/);
    } finally {
      store.close();
    }
  });

  it("done followup omits archive tip when specs_dir is invalid", () => {
    const checklistPath = writeDoneFixture("../escape");
    const store = new StateStore(root);
    try {
      const cid = "archive-gate-bad-aaaa-bbbb-cccc-ddddeeee0005";
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "cursor",
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: checklistPath,
      });
      store.ensureReviewChain(cid);
      store.updateReviewChain(cid, { confirm_left: 0, code_edited: 0 });
      const engine = createConfiguredReviewEngine(store, root);
      const action = engine.handleStop({
        conversationId: cid,
        status: "completed",
        loopCount: 0,
      });
      expect(action?.kind).toBe("done");
      expect(action?.message).not.toMatch(/\/autopilot-archive/);
    } finally {
      store.close();
    }
  });

  it("done followup uses zh-CN archive_suggest when locale bundle is passed", () => {
    const checklistPath = writeDoneFixture("docs/autopilot/specs");
    // Locale file drives tip language; rewrite fixture locale for clarity.
    const cfgPath = path.join(root, ".autopilot", "config.yml");
    fs.writeFileSync(
      cfgPath,
      fs.readFileSync(cfgPath, "utf8").replace(/locale:\s*en/, "locale: zh-CN"),
      "utf8",
    );
    const store = new StateStore(root);
    try {
      const cid = "archive-gate-zh-aaaa-bbbb-cccc-ddddeeee0004";
      store.upsertSession({
        conversation_id: cid,
        project_root: root,
        code_root: root,
        platform: "cursor",
        phase: "executing",
        armed: 1,
        paused: 0,
        track_id: "demo",
        checklist_path: checklistPath,
      });
      store.ensureReviewChain(cid);
      store.updateReviewChain(cid, { confirm_left: 0, code_edited: 0 });
      const bundle = loadFollowupLocale("zh-CN");
      const tip = bundle.followup.archive_suggest!;
      expect(tip).toMatch(/非强制/);
      const engine = createConfiguredReviewEngine(store, root, bundle);
      const action = engine.handleStop({
        conversationId: cid,
        status: "completed",
        loopCount: 0,
      });
      expect(action?.kind).toBe("done");
      expect(action?.message).toContain(tip);
      expect(action?.message).toMatch(/^全部完成/);
    } finally {
      store.close();
    }
  });

  it("review_complete followup includes archive tip when suggestArchive is on", () => {
    root = tmpRoot();
    fs.mkdirSync(path.join(root, ".autopilot"), { recursive: true });
    // createConfiguredReviewEngine already wires specs_dir→suggestArchive (done tests).
    // Here exercise review_complete render path without wall-clock recover debounce.
    const store = new StateStore(root);
    try {
      const cid = "archive-gate-rc-aaaa-bbbb-cccc-ddddeeee0003";
      const engine = new ReviewEngine(store, {
        confirmRounds: 1,
        reviewScope: "project",
        verifyEnabled: false,
        verifyCommands: [],
        maxIdleStops: 5,
        maxErrorsBeforePause: 0,
        projectRoot: root,
        recoverDebounceMs: 0,
        suggestArchive: true,
        archiveSuggestTip: DEFAULT_ARCHIVE_SUGGEST_TIP,
      });
      engine.handleStop({
        conversationId: cid,
        status: "error",
        loopCount: 0,
      });
      store.updateReviewChain(cid, {
        fix_round: 1,
        chain_pending: 1,
        confirm_left: 0,
        code_edited: 0,
        item_confirm_complete: 0,
        pending_followup: null,
        pending_followup_at: null,
      });
      const action = engine.handleStop({
        conversationId: cid,
        status: "completed",
        loopCount: 1,
      });
      expect(action?.kind).toBe("review_complete");
      expect(action?.message).toMatch(/^Review complete/);
      expect(action?.message).toMatch(/\/autopilot-archive/);
      expect(action?.message).toMatch(/Optional — not required/);
    } finally {
      store.close();
    }
  });
});
