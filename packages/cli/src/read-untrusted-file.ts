import { randomBytes } from "node:crypto";
import fs from "node:fs";

/** Default size cap for untrusted project text files (config.yml, hooks.json, …). */
export const MAX_UNTRUSTED_TEXT_BYTES = 1_000_000;

/** Refuse writing through a symlink (incl. dangling — existsSync lies). */
export function assertNotSymlink(filePath: string, label: string): void {
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`${label} is a symlink; refusing to open`);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return;
    throw err;
  }
}

/** Unpredictable sibling path for exclusive staging (same directory as dest). */
function exclusiveSiblingPath(dest: string, kind: string): string {
  return `${dest}.${process.pid}.${randomBytes(8).toString("hex")}.${kind}`;
}

function pathPresentViaLstat(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Park dest (incl. dangling symlink via lstat), then rename tmp → dest.
 * Never copyFileSync onto dest (that follows a raced symlink = write-through).
 */
function parkAndRename(tmp: string, dest: string, first: unknown): void {
  if (!pathPresentViaLstat(dest) || !pathPresentViaLstat(tmp)) {
    throw first;
  }
  const bak = exclusiveSiblingPath(dest, "bak");
  fs.renameSync(dest, bak);
  try {
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* may not exist */
    }
    try {
      fs.renameSync(bak, dest);
    } catch {
      /* leave bak for manual recovery */
    }
    throw err;
  }
  try {
    fs.unlinkSync(bak);
  } catch {
    /* best-effort */
  }
}

/**
 * Cross-device: copy onto a unique same-dir stage (nofollow + O_EXCL), then rename.
 * Never copyFileSync(tmp, dest) or copyFileSync(tmp, stage) — both follow a
 * raced symlink at tmp (read-through into the committed bytes).
 */
function commitViaSameFsStage(tmp: string, dest: string): void {
  const stage = exclusiveSiblingPath(dest, "exdev-stage");
  try {
    // O_NOFOLLOW on tmp: a symlink swap between create and EXDEV fallback
    // must not copy the link target's bytes into stage.
    copyFileNoFollowExclSync(tmp, stage, "exdev-stage-src");
  } catch (err) {
    try {
      fs.unlinkSync(stage);
    } catch {
      /* ignore */
    }
    throw err;
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* stage holds the bytes */
  }
  try {
    fs.renameSync(stage, dest);
    return;
  } catch (first) {
    const code = (first as NodeJS.ErrnoException)?.code;
    if (code === "EPERM" || code === "EEXIST") {
      try {
        parkAndRename(stage, dest, first);
        return;
      } catch (err) {
        try {
          fs.unlinkSync(stage);
        } catch {
          /* ignore */
        }
        throw err;
      }
    }
    try {
      fs.unlinkSync(stage);
    } catch {
      /* ignore */
    }
    throw first;
  }
}

/**
 * Move tmp → dest. Handles EXDEV (stage+rename) and Windows EPERM/EEXIST
 * (park dest via lstat, incl. dangling symlink). Never writes through a
 * symlink at dest.
 */
export function renameReplaceSync(tmp: string, dest: string): void {
  try {
    fs.renameSync(tmp, dest);
    return;
  } catch (first) {
    const code = (first as NodeJS.ErrnoException)?.code;
    if (code === "EXDEV") {
      commitViaSameFsStage(tmp, dest);
      return;
    }
    if (code === "EPERM" || code === "EEXIST") {
      parkAndRename(tmp, dest, first);
      return;
    }
    throw first;
  }
}

/**
 * Write text via exclusive tmp (wx) + renameReplaceSync.
 * wx refuses a pre-planted symlink at the staging path (no write-through).
 */
export function writeFileReplaceSync(dest: string, contents: string): void {
  const tmp = exclusiveSiblingPath(dest, "tmp");
  try {
    fs.writeFileSync(tmp, contents, { encoding: "utf8", flag: "wx" });
    renameReplaceSync(tmp, dest);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore cleanup */
    }
    throw err;
  }
}

/**
 * Copy via exclusive tmp (nofollow) + renameReplaceSync.
 * Source is opened O_NOFOLLOW (no read-through); staging path uses O_EXCL.
 */
export function copyFileReplaceSync(src: string, dest: string): void {
  const tmp = exclusiveSiblingPath(dest, "tmp");
  try {
    copyFileNoFollowExclSync(src, tmp, "copy-src");
    renameReplaceSync(tmp, dest);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore cleanup */
    }
    throw err;
  }
}

/**
 * Copy src → dest with O_CREAT|O_EXCL on dest, without following a symlink at src.
 * Node's copyFileSync follows source symlinks; this is for hostile-workspace
 * backups (e.g. state.db → state.db.bak) where TOCTOU swap must fail closed.
 */
export function copyFileNoFollowExclSync(
  src: string,
  dest: string,
  label: string,
): void {
  const nofollow =
    typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  if (nofollow === 0) {
    assertNotSymlink(src, label);
  }

  let srcFd: number;
  try {
    srcFd = fs.openSync(src, fs.constants.O_RDONLY | nofollow);
  } catch (err) {
    if (nofollow !== 0 && (err as NodeJS.ErrnoException)?.code === "ELOOP") {
      throw new Error(`${label} is a symlink; refusing to open`);
    }
    throw err;
  }

  let outFd: number | undefined;
  try {
    const st = fs.fstatSync(srcFd);
    if (!st.isFile()) {
      throw new Error(`${label} is not a regular file`);
    }
    let lst: fs.Stats;
    try {
      lst = fs.lstatSync(src);
    } catch {
      throw new Error(`${label} disappeared during read`);
    }
    if (lst.isSymbolicLink()) {
      throw new Error(`${label} is a symlink; refusing to open`);
    }
    if (
      typeof lst.ino === "number" &&
      typeof st.ino === "number" &&
      (lst.ino !== 0 || st.ino !== 0) &&
      (lst.ino !== st.ino || lst.dev !== st.dev)
    ) {
      throw new Error(`${label} changed during read`);
    }

    outFd = fs.openSync(
      dest,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
    );
    const buf = Buffer.alloc(64 * 1024);
    let copied = 0;
    while (copied < st.size) {
      const toRead = Math.min(buf.length, st.size - copied);
      const n = fs.readSync(srcFd, buf, 0, toRead, copied);
      if (n === 0) {
        throw new Error(
          `${label} read incomplete (${copied}/${st.size} bytes)`,
        );
      }
      fs.writeSync(outFd, buf, 0, n);
      copied += n;
    }
    const stAfter = fs.fstatSync(srcFd);
    if (stAfter.size !== st.size) {
      throw new Error(`${label} changed during read`);
    }
  } catch (err) {
    if (outFd !== undefined) {
      try {
        fs.closeSync(outFd);
      } catch {
        /* ignore */
      }
      outFd = undefined;
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
    }
    throw err;
  } finally {
    if (outFd !== undefined) {
      try {
        fs.closeSync(outFd);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.closeSync(srcFd);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Read untrusted text: no symlink follow, size-capped (fstat + readSync).
 * Throws on symlink / non-regular file / oversize.
 */
export function readUntrustedUtf8File(
  filePath: string,
  maxBytes: number,
  label: string,
): string {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`${label}: invalid maxBytes`);
  }
  const nofollow =
    typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  if (nofollow === 0) {
    assertNotSymlink(filePath, label);
  }

  let fd: number;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | nofollow);
  } catch (err) {
    if (nofollow !== 0 && (err as NodeJS.ErrnoException)?.code === "ELOOP") {
      throw new Error(`${label} is a symlink; refusing to open`);
    }
    throw err;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) {
      throw new Error(`${label} is not a regular file`);
    }
    // Re-check path identity after open: without O_NOFOLLOW (e.g. Windows),
    // a symlink swap between assertNotSymlink and open would follow the link.
    // lstat symlink → refuse; ino/dev mismatch → path no longer the opened file.
    let lst: fs.Stats;
    try {
      lst = fs.lstatSync(filePath);
    } catch {
      throw new Error(`${label} disappeared during read`);
    }
    if (lst.isSymbolicLink()) {
      throw new Error(`${label} is a symlink; refusing to open`);
    }
    if (
      typeof lst.ino === "number" &&
      typeof st.ino === "number" &&
      (lst.ino !== 0 || st.ino !== 0) &&
      (lst.ino !== st.ino || lst.dev !== st.dev)
    ) {
      throw new Error(`${label} changed during read`);
    }
    if (st.size > maxBytes) {
      throw new Error(`${label} is too large (>${maxBytes} bytes)`);
    }
    const buf = Buffer.alloc(st.size);
    const n = fs.readSync(fd, buf, 0, st.size, 0);
    if (n !== st.size) {
      throw new Error(`${label} read incomplete (${n}/${st.size} bytes)`);
    }
    // Concurrent truncate/grow after fstat → refuse (fail closed).
    const stAfter = fs.fstatSync(fd);
    if (stAfter.size !== st.size) {
      throw new Error(`${label} changed during read`);
    }
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
