import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { StateStore } from "@autopilot-harness/core";
import { defaultConfigYaml } from "./init/default-config.js";
import {
  mergeConfigYamlMissingKeys,
  readConfigInstallHints,
} from "./init/config-merge.js";
import { installInitYes, preflightForceRefresh } from "./init/install.js";
import { PACKAGE_VERSION } from "./init/types.js";
import type { InitLocale } from "./init/types.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
  writeFileReplaceSync,
  assertNotSymlink,
  copyFileNoFollowExclSync,
} from "./read-untrusted-file.js";
import {
  assertParentDirInProject,
  assertRealpathInside,
  assertWrittenInsideProject,
  mkdirRealDirSync,
} from "./init/wizard-helpers.js";
import { runDoctor } from "./status-doctor.js";

const require = createRequire(import.meta.url);

export interface UpgradeOptions {
  projectRoot: string;
  dryRun?: boolean;
  packageVersion?: string;
  /** Accepted for CLI compat; currently always pins to the running CLI version. */
  target?: string;
}

export interface UpgradeOk {
  ok: true;
  dryRun: boolean;
  actions: string[];
  written: string[];
  doctorOk: boolean;
  doctorLines: string[];
  /** Host id from config.yml (for post-upgrade activation tips). */
  platform: string;
}

export interface UpgradeFail {
  ok: false;
  error: string;
}

export type UpgradeResult = UpgradeOk | UpgradeFail;

function writeFileAtomic(
  filePath: string,
  contents: string,
  projectRoot: string,
): void {
  mkdirRealDirSync(path.dirname(filePath), ".autopilot/", projectRoot);
  assertParentDirInProject(projectRoot, filePath, ".autopilot/");
  writeFileReplaceSync(filePath, contents);
  assertWrittenInsideProject(projectRoot, filePath, path.basename(filePath));
}

function trySerializeDb(projectRoot: string, dbPath: string): Uint8Array | null {
  try {
    // DatabaseSync opens by path (follows symlinks). Probe with O_NOFOLLOW and
    // realpath-inside first; if either fails, fall through to nofollow copy bak.
    assertNotSymlink(dbPath, ".autopilot/state.db");
    assertRealpathInside(projectRoot, dbPath, ".autopilot/state.db");
    const nofollow =
      typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    if (nofollow === 0) {
      assertNotSymlink(dbPath, ".autopilot/state.db");
    } else {
      const probeFd = fs.openSync(dbPath, fs.constants.O_RDONLY | nofollow);
      try {
        if (!fs.fstatSync(probeFd).isFile()) return null;
      } finally {
        fs.closeSync(probeFd);
      }
    }
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (
        path: string,
        options?: { readOnly?: boolean },
      ) => {
        exec(sql: string): void;
        serialize(): Uint8Array;
        close(): void;
      };
    };
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const payload = db.serialize();
      if (!payload || payload.byteLength === 0) return null;
      return payload;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function backupStateDbByCopy(projectRoot: string, stamp: string): string[] {
  const dbPath = path.join(projectRoot, ".autopilot", "state.db");
  const written: string[] = [];
  const pairs: Array<{ src: string; destName: string }> = [
    { src: dbPath, destName: `state.db.bak.${stamp}` },
    { src: `${dbPath}-wal`, destName: `state.db-wal.bak.${stamp}` },
    { src: `${dbPath}-shm`, destName: `state.db-shm.bak.${stamp}` },
  ];
  for (const { src, destName: name } of pairs) {
    try {
      const st = fs.lstatSync(src);
      if (st.isSymbolicLink()) {
        throw new Error(
          `${path.basename(src)} is a symlink; refusing to open`,
        );
      }
      if (!st.isFile()) continue;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") continue;
      throw err;
    }
    const out = path.join(projectRoot, ".autopilot", name);
    assertParentDirInProject(projectRoot, out, ".autopilot/");
    // Never copyFileSync(src): it follows a raced source symlink (read-through).
    copyFileNoFollowExclSync(src, out, path.basename(src));
    assertWrittenInsideProject(projectRoot, out, name);
    written.push(path.relative(projectRoot, out));
  }
  return written;
}

/**
 * Consistent state.db snapshot via sqlite serialize() (covers WAL contents).
 * Only falls back to file copies when serialize/open itself fails — never after
 * a failed write of an already-serialized payload (avoids torn/partial bak).
 */
function backupStateDb(projectRoot: string): string[] {
  const dbPath = path.join(projectRoot, ".autopilot", "state.db");
  assertNotSymlink(dbPath, ".autopilot/state.db");
  try {
    const st = fs.lstatSync(dbPath);
    if (!st.isFile()) {
      throw new Error(".autopilot/state.db is not a regular file");
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    throw err;
  }
  const stamp = `${new Date().toISOString().replaceAll(":", "-")}.p${process.pid}`;

  const snapshot = trySerializeDb(projectRoot, dbPath);
  if (snapshot) {
    const dest = path.join(projectRoot, ".autopilot", `state.db.bak.${stamp}`);
    assertParentDirInProject(projectRoot, dest, ".autopilot/");
    fs.writeFileSync(dest, snapshot, { flag: "wx" });
    assertWrittenInsideProject(
      projectRoot,
      dest,
      path.basename(dest),
    );
    return [path.relative(projectRoot, dest)];
  }

  return backupStateDbByCopy(projectRoot, `${stamp}.copy`);
}

function migrateStateDb(projectRoot: string): number {
  const store = new StateStore(projectRoot);
  try {
    return store.getSchemaVersion();
  } finally {
    store.close();
  }
}

/**
 * Upgrade an already-initialized project to the current CLI package version.
 * Refreshes hook/skills/workflows/pin, merges hooks, appends missing config
 * keys, backs up + migrates state.db. Never touches plans/**.
 */
export function upgradeProject(opts: UpgradeOptions): UpgradeResult {
  if (typeof opts.projectRoot !== "string" || opts.projectRoot.trim() === "") {
    return { ok: false, error: "projectRoot must be a non-empty string" };
  }

  const projectRoot = path.resolve(opts.projectRoot.trim());
  const configPath = path.join(projectRoot, ".autopilot", "config.yml");

  const version =
    typeof opts.packageVersion === "string" && opts.packageVersion.trim()
      ? opts.packageVersion.trim()
      : PACKAGE_VERSION;
  const dryRun = Boolean(opts.dryRun);
  const actions: string[] = [];
  const written: string[] = [];

  try {
    let existingConfig: string;
    try {
      // Avoid existsSync: dangling symlinks look missing but must fail closed
      // before backup/migrate.
      existingConfig = readUntrustedUtf8File(
        configPath,
        MAX_UNTRUSTED_TEXT_BYTES,
        ".autopilot/config.yml",
      );
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return {
          ok: false,
          error:
            "Project is not initialized (.autopilot/config.yml missing). Run init --yes first.",
        };
      }
      throw err;
    }
    const hints = readConfigInstallHints(existingConfig);
    const locale: InitLocale = hints.locale === "zh-CN" ? "zh-CN" : "en";
    const platforms =
      hints.platforms.length > 0
        ? hints.platforms
        : [{ id: "cursor", surface: "ide" }];
    // hints.platform/surface already prefer installable via primaryBinding.
    const platform = hints.platform || platforms[0]?.id || "cursor";
    // Defaults include platforms[] so upgrade can append the key to legacy configs.
    const defaultsYaml = defaultConfigYaml({
      platforms,
      platform: hints.platform,
      surface: hints.surface,
      locale,
    });

    const merged = mergeConfigYamlMissingKeys(existingConfig, defaultsYaml);
    const configAdded = merged.addedPaths;
    if (configAdded.length > 0) {
      actions.push(`append missing config keys: ${configAdded.join(", ")}`);
    } else {
      actions.push("config.yml already has all known keys");
    }

    const dbPath = path.join(projectRoot, ".autopilot", "state.db");
    let stateDbKind: "missing" | "present" = "missing";
    try {
      const st = fs.lstatSync(dbPath);
      if (st.isSymbolicLink()) {
        return {
          ok: false,
          error: ".autopilot/state.db is a symlink; refusing to open",
        };
      }
      if (!st.isFile()) {
        return {
          ok: false,
          error: ".autopilot/state.db is not a regular file",
        };
      }
      stateDbKind = "present";
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Cannot access state.db: ${msg}` };
      }
    }
    if (stateDbKind === "present") {
      actions.push("backup state.db → state.db.bak.<timestamp> (snapshot)");
      actions.push("migrate state.db (idempotent)");
    } else {
      actions.push("no state.db yet (skip backup/migrate)");
    }

    actions.push(`update pin.json → ${version}`);
    actions.push("refresh .autopilot/bin/autopilot-harness-hook.mjs");
    actions.push("refresh .cursor/skills/autopilot-*");
    actions.push("refresh docs/autopilot/workflows/*");
    actions.push("merge .autopilotignore (append missing default patterns)");
    actions.push("merge .cursor/hooks.json (Autopilot entries)");

    if (opts.target && opts.target !== version) {
      actions.push(
        `note: --target ${opts.target} ignored; pinning to CLI ${version}`,
      );
    }

    // Fail closed before any backup/migrate/write (incl. dry-run honesty).
    const preflight = preflightForceRefresh(projectRoot);
    if (!preflight.ok) {
      return { ok: false, error: preflight.error };
    }

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        actions,
        written: [],
        doctorOk: true,
        doctorLines: ["(dry-run) doctor not executed"],
        platform,
      };
    }

    // Backup → migrate → refresh. Additive schema must land before new vendor
    // runtime is copied; otherwise a migrate throw leaves new hooks + old DB.
    // Schema ceiling comes from scanning migration SQL on disk (see
    // getLatestSchemaVersion); cli build compiles core before bundling so the
    // scanner is present — an older binary with a hardcoded ceiling would still
    // skip new files until rebuilt.
    written.push(...backupStateDb(projectRoot));

    if (stateDbKind === "present") {
      migrateStateDb(projectRoot);
    }

    // Refresh pin/hooks/skills after migrate so a hooks fail-closed path does
    // not leave config.yml already rewritten with appended keys.
    const refresh = installInitYes({
      projectRoot,
      platform: "cursor",
      surface: "ide",
      locale,
      force: true,
      packageVersion: version,
    });
    if (!refresh.ok) {
      const bakNote =
        written.length > 0
          ? ` (partial writes/backups: ${written.join(", ")})`
          : "";
      return { ok: false, error: `${refresh.error}${bakNote}` };
    }
    written.push(...refresh.written);

    if (configAdded.length > 0) {
      writeFileAtomic(configPath, merged.yaml, projectRoot);
      written.push(path.relative(projectRoot, configPath));
    }

    const doctor = runDoctor(projectRoot);
    return {
      ok: true,
      dryRun: false,
      actions,
      written,
      doctorOk: doctor.ok,
      doctorLines: doctor.lines,
      platform,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const partial =
      written.length > 0
        ? ` (partial writes/backups: ${written.join(", ")})`
        : "";
    return { ok: false, error: `${msg}${partial}` };
  }
}
