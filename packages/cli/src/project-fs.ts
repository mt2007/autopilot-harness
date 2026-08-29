/**
 * Project-boundary filesystem helpers (mkdir / assert / package-asset probes).
 * Untrusted open/copy/replace live in read-untrusted-file.ts.
 */
import fs from "node:fs";
import path from "node:path";
import {
  assertNotSymlink,
  resolveNofollowFlag,
} from "./read-untrusted-file.js";

export { assertNotSymlink, resolveNofollowFlag };

/** Resolve project root; refuse empty/blank (path.resolve("") → cwd). */
export function resolveProjectRootOrThrow(projectRoot: string): string {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    throw new Error("projectRoot must be a non-empty string");
  }
  return path.resolve(projectRoot.trim());
}

/** After mkdir/resolve, ensure realpath stays under project root. */
export function assertRealpathInside(
  projectRoot: string,
  targetPath: string,
  label: string,
): void {
  const realRoot = fs.realpathSync(resolveProjectRootOrThrow(projectRoot));
  const realTarget = fs.realpathSync(path.resolve(targetPath));
  if (realTarget === realRoot) return;
  // path.relative handles cross-drive; only treat ".." / ".."+sep as escape —
  // a child named "..evil" yields rel "..evil" and must remain allowed.
  const rel = path.relative(realRoot, realTarget);
  if (
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  ) {
    throw new Error(`${label} realpath escapes the project root`);
  }
}

/** Parent of filePath must be a real in-project directory (no symlink). */
export function assertParentDirInProject(
  projectRoot: string,
  filePath: string,
  label: string,
): void {
  const dir = path.dirname(path.resolve(filePath));
  assertNotSymlink(dir, label);
  try {
    if (!fs.lstatSync(dir).isDirectory()) {
      throw new Error(`${label} is not a directory`);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new Error(`${label} is missing`);
    }
    throw err;
  }
  assertRealpathInside(projectRoot, dir, label);
}

/**
 * Written path must be a regular in-project file (no symlink / non-file).
 * Does not unlink — callers that need fail-closed cleanup use
 * assertWrittenInsideProject or handle pairs themselves.
 */
export function assertRegularFileInsideProject(
  projectRoot: string,
  filePath: string,
  label: string,
): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new Error(`${label} disappeared after write`);
    }
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`${label} is a symlink; refusing to open`);
  }
  if (!st.isFile()) {
    throw new Error(`${label} is not a regular file`);
  }
  assertRealpathInside(projectRoot, filePath, label);
}

/**
 * Post-write check: if a parent-dir symlink race wrote outside the project,
 * unlink the escaped path (best-effort) and fail closed.
 * Also refuses a raced symlink / non-file at filePath.
 */
export function assertWrittenInsideProject(
  projectRoot: string,
  filePath: string,
  label: string,
): void {
  try {
    assertRegularFileInsideProject(projectRoot, filePath, label);
  } catch (err) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* best-effort remove escaped write */
    }
    throw err;
  }
}

/**
 * Verify each path is a regular in-project file; on any failure unlink *all*
 * listed paths (best-effort) then rethrow the first error — avoids torn pairs
 * (e.g. vendor migration kept + runtime removed).
 */
export function assertPairInsideOrUnlinkAll(
  projectRoot: string,
  files: ReadonlyArray<readonly [path: string, label: string]>,
): void {
  const verifyErrors: unknown[] = [];
  for (const [dest, label] of files) {
    try {
      assertRegularFileInsideProject(projectRoot, dest, label);
    } catch (err) {
      verifyErrors.push(err);
    }
  }
  if (verifyErrors.length > 0) {
    for (const [dest] of files) {
      try {
        fs.unlinkSync(dest);
      } catch {
        /* best-effort remove escaped / torn pair */
      }
    }
    const first = verifyErrors[0];
    throw first instanceof Error ? first : new Error(String(first));
  }
}

/**
 * mkdir -p with symlink/file fail-closed.
 * Also refuses symlink *parents* under projectRoot — recursive mkdir follows
 * intermediate symlinks and would otherwise create dirs outside the project
 * before a later assertRealpathInside can run.
 * When projectRoot is set, verifies realpath after mkdir (closes check→mkdir race).
 */
export function mkdirRealDirSync(
  dirPath: string,
  label: string,
  projectRoot?: string,
): void {
  const resolved = path.resolve(dirPath);
  assertNotSymlink(resolved, label);

  // If callers pass projectRoot, blank must throw — never silently skip bounds checks.
  const root =
    projectRoot === undefined
      ? null
      : resolveProjectRootOrThrow(projectRoot);

  if (root) {
    let parent = path.dirname(resolved);
    while (parent.startsWith(root + path.sep)) {
      assertNotSymlink(parent, label);
      parent = path.dirname(parent);
    }
  }

  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch (err) {
    assertNotSymlink(resolved, label);
    try {
      if (!fs.lstatSync(resolved).isDirectory()) {
        throw new Error(`${label} exists and is not a directory`);
      }
    } catch (inner) {
      const code = (inner as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") throw err;
      throw inner;
    }
    throw err;
  }
  assertNotSymlink(resolved, label);
  if (root) {
    assertRealpathInside(root, resolved, label);
  }
}

/**
 * Package-asset probe: present as a real regular file (lstat; not symlink).
 * Prefer over existsSync — dangling links look missing; pointing links look present.
 */
export function isRealRegularFile(p: string): boolean {
  try {
    return fs.lstatSync(p).isFile();
  } catch {
    return false;
  }
}

/** Package-asset probe: present as a real directory (lstat; not symlink). */
export function isRealDirectory(p: string): boolean {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Require a real regular file at p (single lstat).
 * Symlink / non-file / missing each get a distinct error — a planted link or
 * directory must not be reported as merely "missing".
 */
export function assertPresentRealFile(p: string, label: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      throw new Error(`${label} is missing`);
    }
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`${label} is a symlink; refusing to open`);
  }
  if (!st.isFile()) {
    throw new Error(`${label} is not a regular file`);
  }
}
