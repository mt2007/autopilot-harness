import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
  renameReplaceSync,
  writeFileReplaceSync,
  copyFileReplaceSync,
  copyFileNoFollowExclSync,
} from "../src/read-untrusted-file.js";

describe("readUntrustedUtf8File", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
    vi.restoreAllMocks();
  });

  it("reads a regular UTF-8 file under the size cap", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-ruf-"));
    const file = path.join(root, "ok.txt");
    fs.writeFileSync(file, "hello-世界", "utf8");
    expect(readUntrustedUtf8File(file, MAX_UNTRUSTED_TEXT_BYTES, "ok.txt")).toBe(
      "hello-世界",
    );
  });

  it("reads an empty file", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-ruf-"));
    const file = path.join(root, "empty.txt");
    fs.writeFileSync(file, "", "utf8");
    expect(
      readUntrustedUtf8File(file, MAX_UNTRUSTED_TEXT_BYTES, "empty.txt"),
    ).toBe("");
  });

  it("rejects oversize files before allocating a huge buffer", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-ruf-"));
    const file = path.join(root, "big.txt");
    fs.writeFileSync(file, "x".repeat(64), "utf8");
    expect(() => readUntrustedUtf8File(file, 16, "big.txt")).toThrow(
      /too large/,
    );
  });

  it("rejects invalid maxBytes", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-ruf-"));
    const file = path.join(root, "a.txt");
    fs.writeFileSync(file, "a", "utf8");
    expect(() => readUntrustedUtf8File(file, 0, "a.txt")).toThrow(
      /invalid maxBytes/,
    );
    expect(() => readUntrustedUtf8File(file, -1, "a.txt")).toThrow(
      /invalid maxBytes/,
    );
    expect(() => readUntrustedUtf8File(file, 1.5, "a.txt")).toThrow(
      /invalid maxBytes/,
    );
    expect(() => readUntrustedUtf8File(file, Number.NaN, "a.txt")).toThrow(
      /invalid maxBytes/,
    );
  });

  it("rejects directories", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-ruf-"));
    expect(() =>
      readUntrustedUtf8File(root!, MAX_UNTRUSTED_TEXT_BYTES, "dir"),
    ).toThrow(/not a regular file/);
  });

  it("rejects symlinks", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-ruf-"));
    const target = path.join(root, "target.txt");
    const link = path.join(root, "link.txt");
    fs.writeFileSync(target, "secret", "utf8");
    fs.symlinkSync(target, link);
    expect(() =>
      readUntrustedUtf8File(link, MAX_UNTRUSTED_TEXT_BYTES, "link.txt"),
    ).toThrow(/symlink.*refusing to open/);
  });

  it("Windows-style nofollow=0 still refuses symlinks via assertNotSymlink", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-ruf-win-"));
    const target = path.join(root, "target.txt");
    const link = path.join(root, "link.txt");
    fs.writeFileSync(target, "secret", "utf8");
    fs.symlinkSync(target, link);
    expect(() =>
      readUntrustedUtf8File(link, MAX_UNTRUSTED_TEXT_BYTES, "link.txt", {
        nofollow: 0,
      }),
    ).toThrow(/symlink.*refusing to open/);
  });

  it("Windows-style nofollow=0 still reads a regular file", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-ruf-win-ok-"));
    const file = path.join(root, "ok.txt");
    fs.writeFileSync(file, "payload", "utf8");
    expect(
      readUntrustedUtf8File(file, MAX_UNTRUSTED_TEXT_BYTES, "ok.txt", {
        nofollow: 0,
      }),
    ).toBe("payload");
  });

  it("rejects invalid nofollow override (NaN / negative / float / arbitrary bits)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-ruf-nf-"));
    const file = path.join(root, "ok.txt");
    fs.writeFileSync(file, "x", "utf8");
    expect(() =>
      readUntrustedUtf8File(file, MAX_UNTRUSTED_TEXT_BYTES, "ok.txt", {
        nofollow: Number.NaN,
      }),
    ).toThrow(/invalid nofollow/);
    expect(() =>
      readUntrustedUtf8File(file, MAX_UNTRUSTED_TEXT_BYTES, "ok.txt", {
        nofollow: -1,
      }),
    ).toThrow(/invalid nofollow/);
    expect(() =>
      readUntrustedUtf8File(file, MAX_UNTRUSTED_TEXT_BYTES, "ok.txt", {
        nofollow: 1.5,
      }),
    ).toThrow(/invalid nofollow/);
    // Not 0 and not platform O_NOFOLLOW — reject open-mode bitmasks.
    const platform =
      typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    const weird = platform === 1 ? 2 : 1;
    expect(() =>
      readUntrustedUtf8File(file, MAX_UNTRUSTED_TEXT_BYTES, "ok.txt", {
        nofollow: weird,
      }),
    ).toThrow(/invalid nofollow/);
  });
});

describe("renameReplaceSync", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
    vi.restoreAllMocks();
  });

  it("replaces a dangling symlink without writing through", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-rr-"));
    const outside = path.join(root, "outside.txt");
    const dest = path.join(root, "dest.txt");
    const tmp = path.join(root, "dest.txt.tmp");
    fs.symlinkSync(outside, dest);
    fs.writeFileSync(tmp, "safe\n", "utf8");
    renameReplaceSync(tmp, dest);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(dest, "utf8")).toBe("safe\n");
    expect(fs.existsSync(outside)).toBe(false);
  });

  it("EXDEV fallback stages via same-dir copy then rename (no copy onto dest)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-rr-exdev-"));
    const dest = path.join(root, "dest.txt");
    const tmp = path.join(root, "dest.txt.tmp");
    fs.writeFileSync(dest, "old\n", "utf8");
    fs.writeFileSync(tmp, "new\n", "utf8");

    const realRename = fs.renameSync.bind(fs);
    let first = true;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (first && String(from) === tmp && String(to) === dest) {
        first = false;
        const err = new Error("cross-device link") as NodeJS.ErrnoException;
        err.code = "EXDEV";
        throw err;
      }
      return realRename(from, to);
    });

    renameReplaceSync(tmp, dest);
    expect(fs.readFileSync(dest, "utf8")).toBe("new\n");
    expect(fs.existsSync(tmp)).toBe(false);
  });

  it("parkAndRename restores bak when second rename fails", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-rr-bak-"));
    const dest = path.join(root, "dest.txt");
    const tmp = path.join(root, "dest.txt.tmp");
    fs.writeFileSync(dest, "original\n", "utf8");
    fs.writeFileSync(tmp, "incoming\n", "utf8");

    const realRename = fs.renameSync.bind(fs);
    let phase: "first" | "park" | "commit" = "first";
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (phase === "first" && String(from) === tmp && String(to) === dest) {
        phase = "park";
        const err = new Error("busy") as NodeJS.ErrnoException;
        err.code = "EEXIST";
        throw err;
      }
      if (phase === "park" && String(from) === dest) {
        phase = "commit";
        return realRename(from, to);
      }
      if (phase === "commit" && String(from) === tmp && String(to) === dest) {
        const err = new Error("commit failed") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return realRename(from, to);
    });

    expect(() => renameReplaceSync(tmp, dest)).toThrow(/commit failed|EPERM/);
    expect(fs.readFileSync(dest, "utf8")).toBe("original\n");
  });

  it("writeFileReplaceSync replaces dest without write-through", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-wfr-"));
    const outside = path.join(root, "outside.txt");
    const dest = path.join(root, "dest.txt");
    fs.symlinkSync(outside, dest);
    writeFileReplaceSync(dest, "safe\n");
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(dest, "utf8")).toBe("safe\n");
    expect(fs.existsSync(outside)).toBe(false);
  });

  it("copyFileReplaceSync refuses a symlink source (no read-through)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-cfr-sym-"));
    const secret = path.join(root, "secret.txt");
    const link = path.join(root, "link.txt");
    const dest = path.join(root, "out.txt");
    fs.writeFileSync(secret, "classified\n", "utf8");
    fs.symlinkSync(secret, link);
    expect(() => copyFileReplaceSync(link, dest)).toThrow(
      /symlink.*refusing to open/,
    );
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("copyFileReplaceSync copies a regular file", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-cfr-ok-"));
    const src = path.join(root, "src.txt");
    const dest = path.join(root, "dest.txt");
    fs.writeFileSync(src, "payload\n", "utf8");
    copyFileReplaceSync(src, dest);
    expect(fs.readFileSync(dest, "utf8")).toBe("payload\n");
  });

  it("exclusive staging (wx) refuses a pre-planted symlink path", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-wx-"));
    const outside = path.join(root, "outside.txt");
    const planted = path.join(root, "planted.tmp");
    fs.symlinkSync(outside, planted);
    expect(() =>
      fs.writeFileSync(planted, "x", { encoding: "utf8", flag: "wx" }),
    ).toThrow();
    expect(fs.existsSync(outside)).toBe(false);
  });

  it("COPYFILE_EXCL refuses a pre-planted symlink staging path", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-excl-"));
    const src = path.join(root, "src.txt");
    const outside = path.join(root, "outside.txt");
    const planted = path.join(root, "planted.tmp");
    fs.writeFileSync(src, "payload\n", "utf8");
    fs.symlinkSync(outside, planted);
    expect(() =>
      fs.copyFileSync(src, planted, fs.constants.COPYFILE_EXCL),
    ).toThrow();
    expect(fs.existsSync(outside)).toBe(false);
  });
});

describe("copyFileNoFollowExclSync", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
    vi.restoreAllMocks();
  });

  it("copies a regular file with O_EXCL dest", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-cnf-"));
    const src = path.join(root, "src.bin");
    const dest = path.join(root, "dest.bin");
    fs.writeFileSync(src, Buffer.from([0, 1, 2, 255, 10]));
    copyFileNoFollowExclSync(src, dest, "src.bin");
    expect(fs.readFileSync(dest)).toEqual(Buffer.from([0, 1, 2, 255, 10]));
  });

  it("copies an empty regular file", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-cnf-empty-"));
    const src = path.join(root, "empty.bin");
    const dest = path.join(root, "dest.bin");
    fs.writeFileSync(src, Buffer.alloc(0));
    copyFileNoFollowExclSync(src, dest, "empty.bin");
    expect(fs.readFileSync(dest)).toEqual(Buffer.alloc(0));
  });

  it("refuses a symlink source (no read-through)", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-cnf-sym-"));
    const secret = path.join(root, "secret.txt");
    const link = path.join(root, "link.txt");
    const dest = path.join(root, "out.txt");
    fs.writeFileSync(secret, "classified\n", "utf8");
    fs.symlinkSync(secret, link);
    expect(() => copyFileNoFollowExclSync(link, dest, "link.txt")).toThrow(
      /symlink.*refusing to open/,
    );
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("Windows-style nofollow=0 refuses symlink source", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-cnf-win-"));
    const secret = path.join(root, "secret.txt");
    const link = path.join(root, "link.txt");
    const dest = path.join(root, "out.txt");
    fs.writeFileSync(secret, "classified\n", "utf8");
    fs.symlinkSync(secret, link);
    expect(() =>
      copyFileNoFollowExclSync(link, dest, "link.txt", { nofollow: 0 }),
    ).toThrow(/symlink.*refusing to open/);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("refuses when dest already exists", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-cnf-ex-"));
    const src = path.join(root, "src.txt");
    const dest = path.join(root, "dest.txt");
    fs.writeFileSync(src, "a\n", "utf8");
    fs.writeFileSync(dest, "b\n", "utf8");
    expect(() => copyFileNoFollowExclSync(src, dest, "src.txt")).toThrow(
      /EEXIST|already exists/i,
    );
    expect(fs.readFileSync(dest, "utf8")).toBe("b\n");
  });

  it("refuses when source size changes mid-copy", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ah-cnf-race-"));
    const src = path.join(root, "src.txt");
    const dest = path.join(root, "dest.txt");
    fs.writeFileSync(src, "abcdefghijklmnop", "utf8");

    const realFstat = fs.fstatSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "fstatSync").mockImplementation((fd, options) => {
      const st = realFstat(fd, options as never);
      calls += 1;
      if (calls === 1) {
        return { ...st, size: 16, isFile: () => true } as fs.Stats;
      }
      if (calls >= 2) {
        return { ...st, size: 4, isFile: () => true } as fs.Stats;
      }
      return st;
    });

    expect(() => copyFileNoFollowExclSync(src, dest, "src.txt")).toThrow(
      /changed during read|read incomplete/,
    );
    expect(fs.existsSync(dest)).toBe(false);
  });
});
