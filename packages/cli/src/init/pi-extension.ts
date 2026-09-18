/**
 * Pi in-process extension install helpers (R6 direct write under
 * `.pi/extensions/autopilot.ts` — never `pi install`).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readUntrustedUtf8File, copyFileReplaceSync } from "../read-untrusted-file.js";
import {
  assertNotSymlink,
  assertParentDirInProject,
  assertRealpathInside,
  assertWrittenInsideProject,
  isRealRegularFile,
  mkdirRealDirSync,
} from "../project-fs.js";

export const PI_PLATFORM = "pi";
/** Soft doctor tip — probed API surface (research). */
export const PI_SOFT_MIN_VERSION = "0.85.1";
/** Relative path of the Autopilot Pi extension (init-shipped). */
export const PI_EXTENSION_REL_PATH = ".pi/extensions/autopilot.ts";
/** Narrow .autopilotignore pattern for the Autopilot-written extension. */
export const PI_EXTENSION_IGNORE_PATTERN = ".pi/extensions/autopilot*";

/** Fingerprint markers that must appear in a healthy Autopilot Pi extension. */
export const PI_EXTENSION_FINGERPRINTS = [
  "handlePiAgentSettled",
  "PI_CONTINUE_DELIVER",
  ".autopilot/bin/vendor/runtime.mjs",
] as const;

const MAX_EXTENSION_BYTES = 512 * 1024;

function pathExistsViaLstat(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return false;
    throw err;
  }
}

function cliPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

/** Resolve shipped template (assets/ or dist/assets/). */
export function resolvePiExtensionTemplate(
  cliRoot: string = cliPackageRoot(),
): string | null {
  for (const rel of [
    path.join("assets", "pi-extension", "autopilot.ts"),
    path.join("dist", "assets", "pi-extension", "autopilot.ts"),
  ]) {
    const p = path.join(cliRoot, rel);
    if (isRealRegularFile(p)) return p;
  }
  return null;
}

export function piExtensionAbsolutePath(projectRoot: string): string {
  return path.join(projectRoot, ".pi", "extensions", "autopilot.ts");
}

/** True when file text looks like an Autopilot Pi extension. */
export function piExtensionContainsAutopilot(text: string): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  return PI_EXTENSION_FINGERPRINTS.every((m) => text.includes(m));
}

export function readPiExtensionFile(
  filePath: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  try {
    assertNotSymlink(filePath, PI_EXTENSION_REL_PATH);
    if (!pathExistsViaLstat(filePath)) {
      return { ok: true, value: null };
    }
    const st = fs.lstatSync(filePath);
    if (!st.isFile()) {
      return {
        ok: false,
        error: `${PI_EXTENSION_REL_PATH} exists and is not a regular file`,
      };
    }
    const text = readUntrustedUtf8File(
      filePath,
      MAX_EXTENSION_BYTES,
      PI_EXTENSION_REL_PATH,
    );
    return { ok: true, value: text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Direct-write `.pi/extensions/autopilot.ts` from the CLI asset (R4: no `pi`
 * binary required). Symlink / escape fail-closed.
 */
export function installPiExtension(
  projectRoot: string,
  cliRoot: string = cliPackageRoot(),
): string {
  const template = resolvePiExtensionTemplate(cliRoot);
  if (!template) {
    throw new Error(
      "Missing assets/pi-extension/autopilot.ts — run pnpm sync-dist-assets (or pnpm build)",
    );
  }
  assertNotSymlink(template, "assets/pi-extension/autopilot.ts");

  const piDir = path.join(projectRoot, ".pi");
  const extDir = path.join(piDir, "extensions");
  mkdirRealDirSync(piDir, ".pi/", projectRoot);
  assertNotSymlink(piDir, ".pi/");
  mkdirRealDirSync(extDir, ".pi/extensions/", projectRoot);
  assertNotSymlink(extDir, ".pi/extensions/");

  const dest = piExtensionAbsolutePath(projectRoot);
  assertParentDirInProject(projectRoot, dest, ".pi/extensions/");
  assertNotSymlink(dest, PI_EXTENSION_REL_PATH);
  copyFileReplaceSync(template, dest);
  assertWrittenInsideProject(projectRoot, dest, PI_EXTENSION_REL_PATH);
  assertRealpathInside(projectRoot, dest, PI_EXTENSION_REL_PATH);

  const written = readPiExtensionFile(dest);
  if (!written.ok || !written.value || !piExtensionContainsAutopilot(written.value)) {
    // Only drop a dest that still lacks the Autopilot fingerprint. A
    // concurrent rewrite that already installed a healthy extension must
    // not be unlinked by this failure path.
    try {
      const again = readPiExtensionFile(dest);
      if (
        again.ok &&
        (again.value == null || !piExtensionContainsAutopilot(again.value))
      ) {
        if (again.value != null) fs.unlinkSync(dest);
      }
    } catch {
      // best-effort: prefer leaving a healthy file over a sticky orphan
    }
    if (!written.ok) throw new Error(written.error);
    throw new Error(
      `${PI_EXTENSION_REL_PATH} fingerprint incomplete after write`,
    );
  }
  return path.relative(projectRoot, dest);
}

/** Best-effort remove Autopilot Pi extension (skip missing / skip symlink). */
export function removePiExtension(projectRoot: string): {
  removed: boolean;
  skipped?: string;
} {
  const dest = piExtensionAbsolutePath(projectRoot);
  try {
    assertNotSymlink(dest, PI_EXTENSION_REL_PATH);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { removed: false, skipped: msg };
  }
  if (!pathExistsViaLstat(dest)) return { removed: false };
  try {
    assertRealpathInside(projectRoot, dest, PI_EXTENSION_REL_PATH);
    fs.unlinkSync(dest);
    return { removed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { removed: false, skipped: msg };
  }
}

/**
 * Probe `pi --version` when on PATH (doctor WARN only; never blocks install).
 * Returns null when missing / unreadable.
 */
export function probePiCliVersion(
  run?: (cmd: string, args: string[]) => string,
): string | null {
  try {
    const exec =
      run ??
      ((cmd: string, args: string[]) =>
        execFileSync(cmd, args, {
          encoding: "utf8",
          timeout: 5_000,
          stdio: ["ignore", "pipe", "pipe"],
        }));
    const out = exec("pi", ["--version"]);
    // Strip controls, then extract semver from the full text. Only the
    // no-semver fallback is capped so a long banner cannot hide the version.
    const raw = String(out).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    const m = raw.match(/(\d+\.\d+\.\d+)/);
    if (m?.[1]) return m[1];
    const text = raw.slice(0, 80);
    return text || null;
  } catch {
    return null;
  }
}

/** Semver-ish compare: true when `have` < `want` (missing → treated as older). */
export function isPiVersionBelowSoftMin(
  have: string | null,
  want: string = PI_SOFT_MIN_VERSION,
): boolean {
  if (!have) return true;
  const parse = (v: string): number[] =>
    v
      .split(".")
      .map((p) => Number.parseInt(p.replace(/[^\d].*$/, ""), 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const a = parse(have);
  const b = parse(want);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}
