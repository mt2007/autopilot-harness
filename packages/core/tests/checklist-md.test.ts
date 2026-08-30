import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_CHECKLIST_BYTES,
  firstUnchecked,
  parseChecklist,
  parseChecklistMarkdown,
  secondUnchecked,
} from "../src/index.js";

describe("parseChecklist hardening", () => {
  let root: string;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  function tmp(): string {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cl-"));
    return root;
  }

  it("parses a regular checklist file", () => {
    const dir = tmp();
    const cp = path.join(dir, "checklist.md");
    fs.writeFileSync(cp, `- [ ] a — First\n- [x] b — Done\n`);
    const cl = parseChecklist(cp);
    expect(cl.items).toHaveLength(2);
    expect(cl.items[0]!.checked).toBe(false);
  });

  it("parseChecklistMarkdown does not touch FS", () => {
    const cl = parseChecklistMarkdown(`- [ ] only — Item\n`, "/virtual.md");
    expect(cl.path).toBe("/virtual.md");
    expect(cl.items).toHaveLength(1);
  });

  it("refuses symlinks", () => {
    const dir = tmp();
    const real = path.join(dir, "real.md");
    const link = path.join(dir, "link.md");
    fs.writeFileSync(real, `- [ ] a — First\n`);
    fs.symlinkSync(real, link);
    expect(() => parseChecklist(link)).toThrow();
  });

  it("refuses NUL in path", () => {
    expect(() => parseChecklist("bad\0path.md")).toThrow(/Invalid/);
  });

  it("with projectRoot refuses checklist outside project", () => {
    const project = tmp();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cl-out-"));
    try {
      const cp = path.join(outside, "checklist.md");
      fs.writeFileSync(cp, `- [ ] secret — Secret\n`);
      expect(parseChecklist(cp).items).toHaveLength(1);
      expect(() =>
        parseChecklist(cp, { projectRoot: project }),
      ).toThrow(/outside project/i);
      expect(() =>
        parseChecklist(cp, { projectRoot: `bad\0${project}` }),
      ).toThrow(/Invalid project root/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses directories", () => {
    const dir = tmp();
    const cp = path.join(dir, "not-a-file");
    fs.mkdirSync(cp);
    expect(() => parseChecklist(cp)).toThrow();
  });

  it("refuses oversized files", () => {
    const dir = tmp();
    const cp = path.join(dir, "huge.md");
    // Sparse-ish: write just over the cap
    const fd = fs.openSync(cp, "w");
    fs.ftruncateSync(fd, MAX_CHECKLIST_BYTES + 1);
    fs.closeSync(fd);
    expect(() => parseChecklist(cp)).toThrow(/too large|unreadable/i);
  });
});

describe("secondUnchecked", () => {
  it("returns the item after firstUnchecked among unchecked rows", () => {
    const cl = parseChecklistMarkdown(
      `- [x] done — Done\n- [ ] a — First\n- [ ] b — Second\n- [ ] c — Third\n`,
      "/virtual.md",
    );
    expect(firstUnchecked(cl)?.id).toBe("a");
    expect(secondUnchecked(cl)?.id).toBe("b");
    expect(secondUnchecked(cl)?.title).toBe("Second");
  });

  it("returns null when fewer than two unchecked", () => {
    const one = parseChecklistMarkdown(`- [ ] only — One\n`, "/v.md");
    expect(secondUnchecked(one)).toBeNull();
    const none = parseChecklistMarkdown(`- [x] done — Done\n`, "/v.md");
    expect(secondUnchecked(none)).toBeNull();
  });
});
