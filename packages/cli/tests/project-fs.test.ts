import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertPairInsideOrUnlinkAll,
  assertPresentRealFile,
  assertRealpathInside,
  assertRegularFileInsideProject,
  assertWrittenInsideProject,
  isRealDirectory,
  isRealRegularFile,
  mkdirRealDirSync,
  resolveProjectRootOrThrow,
} from "../src/project-fs.js";

describe("project-fs probes and asserts", () => {
  let root: string | undefined;
  let sibling: string | undefined;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    if (sibling) fs.rmSync(sibling, { recursive: true, force: true });
    root = undefined;
    sibling = undefined;
  });

  it("resolveProjectRootOrThrow refuses empty/blank", () => {
    expect(() => resolveProjectRootOrThrow("")).toThrow(
      /projectRoot must be a non-empty string/,
    );
    expect(() => resolveProjectRootOrThrow("   ")).toThrow(
      /projectRoot must be a non-empty string/,
    );
  });

  it("mkdirRealDirSync refuses blank projectRoot (does not skip bounds)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-pfs-mkdir-"));
    const dir = path.join(root, "nested");
    expect(() => mkdirRealDirSync(dir, "nested/", "  ")).toThrow(
      /projectRoot must be a non-empty string/,
    );
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("assertRealpathInside refuses sibling-prefix escape (project vs project-evil)", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ah-pfs-pref-"));
    root = path.join(base, "project");
    sibling = path.join(base, "project-evil");
    fs.mkdirSync(root);
    fs.mkdirSync(sibling);
    const evilFile = path.join(sibling, "secret.txt");
    fs.writeFileSync(evilFile, "x");
    expect(() => assertRealpathInside(root!, evilFile, "secret.txt")).toThrow(
      /escapes the project root/,
    );
    fs.rmSync(base, { recursive: true, force: true });
    root = undefined;
    sibling = undefined;
  });

  it("assertRealpathInside allows in-project child whose name starts with ..", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-pfs-dotevil-"));
    const weirdDir = path.join(root, "..evil");
    fs.mkdirSync(weirdDir);
    const file = path.join(weirdDir, "ok.txt");
    fs.writeFileSync(file, "ok");
    expect(() => assertRealpathInside(root!, file, "ok.txt")).not.toThrow();
  });

  it("assertPresentRealFile refuses symlink instead of calling it missing", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-pfs-present-"));
    const target = path.join(root, "target.txt");
    const link = path.join(root, "link.txt");
    const dir = path.join(root, "dir");
    fs.writeFileSync(target, "x");
    fs.symlinkSync(target, link);
    fs.mkdirSync(dir);
    expect(() => assertPresentRealFile(link, "asset")).toThrow(
      /symlink.*refusing to open/,
    );
    expect(() => assertPresentRealFile(dir, "asset")).toThrow(
      /not a regular file/,
    );
    expect(() =>
      assertPresentRealFile(path.join(root!, "gone.txt"), "asset"),
    ).toThrow(/missing/);
  });

  it("isRealRegularFile / isRealDirectory ignore symlinks and missing", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-pfs-"));
    const file = path.join(root, "f.txt");
    const dir = path.join(root, "d");
    const linkFile = path.join(root, "lf");
    const linkDir = path.join(root, "ld");
    const dangling = path.join(root, "dang");
    fs.writeFileSync(file, "x");
    fs.mkdirSync(dir);
    fs.symlinkSync(file, linkFile);
    fs.symlinkSync(dir, linkDir);
    fs.symlinkSync(path.join(root, "missing"), dangling);

    expect(isRealRegularFile(file)).toBe(true);
    expect(isRealDirectory(dir)).toBe(true);
    expect(isRealRegularFile(linkFile)).toBe(false);
    expect(isRealDirectory(linkDir)).toBe(false);
    expect(isRealRegularFile(dangling)).toBe(false);
    expect(isRealDirectory(dangling)).toBe(false);
    expect(isRealRegularFile(path.join(root, "nope"))).toBe(false);
  });

  it("assertRegularFileInsideProject reports disappeared after write", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-pfs-gone-"));
    const missing = path.join(root, "gone.txt");
    expect(() =>
      assertRegularFileInsideProject(root!, missing, "gone.txt"),
    ).toThrow(/disappeared after write/);
  });

  it("assertWrittenInsideProject unlinks escaped path on disappear", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-pfs-aw-"));
    const missing = path.join(root, "gone.txt");
    expect(() =>
      assertWrittenInsideProject(root!, missing, "gone.txt"),
    ).toThrow(/disappeared after write/);
  });

  it("assertPairInsideOrUnlinkAll removes both when one fails verify", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-pfs-pair-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ah-pfs-out-"));
    try {
      const ok = path.join(root, "ok.txt");
      const escaped = path.join(outside, "leaked.txt");
      fs.writeFileSync(ok, "in\n");
      fs.writeFileSync(escaped, "out\n");
      expect(() =>
        assertPairInsideOrUnlinkAll(root!, [
          [ok, "ok.txt"],
          [escaped, "leaked.txt"],
        ]),
      ).toThrow(/escapes the project root/);
      expect(fs.existsSync(ok)).toBe(false);
      expect(fs.existsSync(escaped)).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("assertPairInsideOrUnlinkAll accepts a valid in-project pair", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-pfs-pair-ok-"));
    const a = path.join(root, "a.txt");
    const b = path.join(root, "b.txt");
    fs.writeFileSync(a, "a");
    fs.writeFileSync(b, "b");
    expect(() =>
      assertPairInsideOrUnlinkAll(root!, [
        [a, "a.txt"],
        [b, "b.txt"],
      ]),
    ).not.toThrow();
    expect(fs.readFileSync(a, "utf8")).toBe("a");
    expect(fs.readFileSync(b, "utf8")).toBe("b");
  });
});
