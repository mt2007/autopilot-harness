import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StateStore } from "@autopilot-harness/core";
import { installInitYes } from "../src/init/install.js";
import {
  formatSessionDisplayName,
  formatSessionList,
  purgeProjectSession,
  renameProjectSession,
  resetProjectSessionReview,
  shortSessionId,
} from "../src/session.js";

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-cli-sess-"));
}

describe("session CLI helpers", () => {
  let root: string;
  afterEach(() => {
    if (root && fs.existsSync(root)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when project is not initialized", () => {
    root = tmpProject();
    const r = renameProjectSession({
      projectRoot: root,
      id: "abc",
      title: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not initialized/i);
  });

  it("rejects empty projectRoot and empty title", () => {
    expect(
      formatSessionList({ projectRoot: "   " }).ok,
    ).toBe(false);
    expect(
      renameProjectSession({ projectRoot: "", id: "x", title: "y" }).ok,
    ).toBe(false);
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(
      renameProjectSession({
        projectRoot: root,
        id: "abc",
        title: "   ",
      }).ok,
    ).toBe(false);
    const tooLong = renameProjectSession({
      projectRoot: root,
      id: "abc",
      title: "x".repeat(201),
    });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error).toMatch(/200/);
    const ctrl = renameProjectSession({
      projectRoot: root,
      id: "abc",
      title: "bad\ntitle",
    });
    expect(ctrl.ok).toBe(false);
    if (!ctrl.ok) expect(ctrl.error).toMatch(/control/i);
    expect(
      purgeProjectSession({ projectRoot: root, id: "  " }).ok,
    ).toBe(false);
  });

  it("lists empty table when state.db exists with no sessions", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const store = new StateStore(root);
    store.close();
    const listed = formatSessionList({ projectRoot: root });
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.lines).toEqual(["(no sessions)"]);
  });

  it("refuses symlink state.db", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    const realDb = path.join(root, "outside.db");
    fs.writeFileSync(realDb, "");
    fs.symlinkSync(realDb, path.join(root, ".autopilot", "state.db"));
    const listed = formatSessionList({ projectRoot: root });
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error).toMatch(/symlink/i);
  });
  it("reports missing state.db after init with no sessions", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);
    expect(fs.existsSync(path.join(root, ".autopilot", "state.db"))).toBe(
      false,
    );
    const listed = formatSessionList({ projectRoot: root });
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error).toMatch(/no state\.db/i);
  });

  it("lists, renames, resets review, and purges", () => {
    root = tmpProject();
    expect(
      installInitYes({
        projectRoot: root,
        platform: "cursor",
        surface: "ide",
        locale: "en",
        force: false,
      }).ok,
    ).toBe(true);

    const id = "cli-aaaa-bbbb-cccc-ddddeeee0001";
    const store = new StateStore(root);
    store.upsertSession({
      conversation_id: id,
      project_root: root,
      code_root: root,
      platform: "cursor",
      track_id: "auth-fix",
      track_title: "Auth fix",
      session_title: "Cursor chat",
      phase: "executing",
      paused: 1,
      paused_reason: "human_gate",
      armed: 0,
      checklist_path: path.join(root, "plans", "auth-fix", "checklist.md"),
    });
    store.updateReviewChain(id, { fix_round: 2, confirm_left: 3 });
    store.close();

    const listed = formatSessionList({ projectRoot: root });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.lines.join("\n")).toMatch(/Auth fix/);
    expect(listed.lines.join("\n")).toMatch(/paused/i);
    expect(listed.lines.join("\n")).toMatch(new RegExp(shortSessionId(id)));

    const renamed = renameProjectSession({
      projectRoot: root,
      id: shortSessionId(id),
      title: "My name",
    });
    expect(renamed.ok).toBe(true);

    const reset = resetProjectSessionReview({
      projectRoot: root,
      id: shortSessionId(id),
    });
    expect(reset.ok).toBe(true);

    const store2 = new StateStore(root);
    expect(store2.getSession(id)!.session_title).toBe("My name");
    expect(store2.getSession(id)!.session_title_source).toBe("user");
    expect(store2.getReviewChain(id)!.fix_round).toBe(0);
    store2.close();

    const purged = purgeProjectSession({
      projectRoot: root,
      id: shortSessionId(id),
    });
    expect(purged.ok).toBe(true);
    const store3 = new StateStore(root);
    expect(store3.getSession(id)).toBeNull();
    store3.close();
  });

  it("formats display name from track · session title", () => {
    expect(
      formatSessionDisplayName({
        track_title: "TipTap M2",
        session_title: "Fix auth",
        track_id: "tiptap-m2",
      }),
    ).toBe("TipTap M2 · Fix auth");
    expect(
      formatSessionDisplayName({
        track_title: null,
        session_title: null,
        track_id: "demo-slug",
      }),
    ).toBe("demo-slug");
    expect(
      formatSessionDisplayName({
        track_title: "A\nB",
        session_title: "C\tD",
        track_id: "x",
      }),
    ).toBe("A B · C D");
  });
});
