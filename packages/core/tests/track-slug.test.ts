import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyOn,
  applyRun,
  isSafeTrackSlug,
  MAX_SLUG_LEN,
  parseTrigger,
  StateStore,
} from "../src/index.js";

describe("isSafeTrackSlug", () => {
  it("allows kebab segments and single dots between alnum", () => {
    expect(isSafeTrackSlug("oss-readme-docs")).toBe(true);
    expect(isSafeTrackSlug("v0-1-npm-release")).toBe(true);
    expect(isSafeTrackSlug("v0.1-npm-release")).toBe(true);
    expect(isSafeTrackSlug("a.b.c")).toBe(true);
    expect(isSafeTrackSlug("a".repeat(MAX_SLUG_LEN))).toBe(true);
  });

  it("rejects path traversal and unsafe shapes", () => {
    expect(isSafeTrackSlug("../etc")).toBe(false);
    expect(isSafeTrackSlug("..")).toBe(false);
    expect(isSafeTrackSlug("foo/bar")).toBe(false);
    expect(isSafeTrackSlug("foo\\bar")).toBe(false);
    expect(isSafeTrackSlug("v0..1")).toBe(false);
    expect(isSafeTrackSlug(".hidden")).toBe(false);
    expect(isSafeTrackSlug("trailing.")).toBe(false);
    expect(isSafeTrackSlug("a.-b")).toBe(false);
    expect(isSafeTrackSlug("a-.b")).toBe(false);
    expect(isSafeTrackSlug("Foo_Bar")).toBe(false);
    expect(isSafeTrackSlug("")).toBe(false);
    expect(isSafeTrackSlug("a".repeat(MAX_SLUG_LEN + 1))).toBe(false);
  });
});

describe("dotted slug ON/RUN parity", () => {
  it("parseTrigger extracts dotted slug for on and run", () => {
    const root = "/tmp/ap-slug";
    const on = parseTrigger({
      prompt: "/autopilot-on v0.1-npm-release",
      conversationId: "c1",
      projectRoot: root,
    });
    expect(on?.kind).toBe("on");
    expect(on?.slug).toBe("v0.1-npm-release");

    const onDot = parseTrigger({
      prompt: "Autopilot ON · v0.1-npm-release",
      conversationId: "c1",
      projectRoot: root,
    });
    expect(onDot?.kind).toBe("on");
    expect(onDot?.slug).toBe("v0.1-npm-release");

    const onBrief = parseTrigger({
      prompt: "/autopilot-on ../evil",
      conversationId: "c1",
      projectRoot: root,
    });
    expect(onBrief?.kind).toBe("on");
    expect(onBrief?.slug).toBeUndefined();
    expect(onBrief?.initialBrief).toBe("../evil");

    const run = parseTrigger({
      prompt: "/autopilot-run v0.1-npm-release",
      conversationId: "c1",
      projectRoot: root,
    });
    expect(run?.kind).toBe("run");
    expect(run?.slug).toBe("v0.1-npm-release");

    const pick = parseTrigger({
      prompt: "v0.1-npm-release",
      conversationId: "c1",
      projectRoot: root,
      pendingAction: "run",
    });
    expect(pick?.kind).toBe("track_pick");
    expect(pick?.trackPick).toBe("v0.1-npm-release");
  });

  it("applyOn accepts dotted slug; rejects traversal", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-on-slug-"));
    const store = StateStore.openMemory(root);
    try {
      const ok = applyOn(store, "c1", root, { slug: "v0.1-npm-release" });
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        expect(ok.session.phase).toBe("planning");
        expect(ok.session.track_id).toBe("v0.1-npm-release");
      }

      const bad = applyOn(store, "c2", root, { slug: "../etc" });
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.userMessage).toMatch(/Invalid track slug/i);

      const empty = applyOn(store, "c3", root, { slug: "" });
      expect(empty.ok).toBe(false);
      if (!empty.ok) expect(empty.userMessage).toMatch(/Invalid track slug/i);

      const nonString = applyOn(store, "c4", root, {
        slug: null as unknown as string,
      });
      expect(nonString.ok).toBe(false);
      if (!nonString.ok) {
        expect(nonString.userMessage).toMatch(/Invalid track slug/i);
        expect(nonString.userMessage.length).toBeLessThan(120);
      }

      const overlong = applyOn(store, "c5", root, {
        slug: "a".repeat(MAX_SLUG_LEN + 1),
      });
      expect(overlong.ok).toBe(false);
      if (!overlong.ok) {
        expect(overlong.userMessage).toMatch(/Invalid track slug/i);
        // Sanitized display is capped at 64 slug chars (+ wrapper).
        expect(overlong.userMessage.length).toBeLessThan(100);
      }
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("applyRun lists and starts a dotted-slug plan", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-run-dot-"));
    const store = StateStore.openMemory(root);
    try {
      const slug = "v0.1-npm-release";
      const dir = path.join(root, "plans", slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "plan.md"), `# ${slug}\n`);
      fs.writeFileSync(
        path.join(dir, "checklist.md"),
        `- [ ] preflight — check\n`,
      );

      const out = applyRun(store, "c1", root, { slug });
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.session.phase).toBe("executing");
        expect(out.session.track_id).toBe(slug);
        expect(out.session.armed).toBe(1);
      }
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("applyRun rejects overlong slug", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-run-long-"));
    const store = StateStore.openMemory(root);
    try {
      const long = "a".repeat(MAX_SLUG_LEN + 1);
      const out = applyRun(store, "c1", root, { slug: long });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.userMessage).toMatch(/Invalid track slug/i);
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
