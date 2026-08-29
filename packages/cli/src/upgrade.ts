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
import { runDoctor } from "./status-doctor.js";

const require = createRequire(import.meta.url);

export interface UpgradeOptions {
  projectRoot: string;
  dryRun?: boolean;
  packageVersion?: string;
  /** Accepted for CLI compat; v0.1 always pins to the running CLI version. */
  target?: string;
}

export interface UpgradeOk {
  ok: true;
  dryRun: boolean;
  actions: string[];
  written: string[];
  doctorOk: boolean;
  doctorLines: string[];
}

export interface UpgradeFail {
  ok: false;
  error: string;
}

export type UpgradeResult = UpgradeOk | UpgradeFail;

function writeFileAtomic(filePath: string, contents: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(tmp, contents, "utf8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore cleanup */
    }
    throw err;
  }
}

function trySerializeDb(dbPath: string): Uint8Array | null {
  try {
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
    if (!fs.existsSync(src)) continue;
    const out = path.join(projectRoot, ".autopilot", name);
    fs.copyFileSync(src, out, fs.constants.COPYFILE_EXCL);
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
  if (!fs.existsSync(dbPath)) return [];
  const stamp = `${new Date().toISOString().replaceAll(":", "-")}.p${process.pid}`;

  const snapshot = trySerializeDb(dbPath);
  if (snapshot) {
    const dest = path.join(projectRoot, ".autopilot", `state.db.bak.${stamp}`);
    fs.writeFileSync(dest, snapshot, { flag: "wx" });
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
  const projectRoot = path.resolve(opts.projectRoot);
  const configPath = path.join(projectRoot, ".autopilot", "config.yml");
  if (!fs.existsSync(configPath)) {
    return {
      ok: false,
      error:
        "Project is not initialized (.autopilot/config.yml missing). Run init --yes first.",
    };
  }

  const version =
    typeof opts.packageVersion === "string" && opts.packageVersion.trim()
      ? opts.packageVersion.trim()
      : PACKAGE_VERSION;
  const dryRun = Boolean(opts.dryRun);
  const actions: string[] = [];
  const written: string[] = [];

  try {
    const existingConfig = fs.readFileSync(configPath, "utf8");
    const hints = readConfigInstallHints(existingConfig);
    const locale: InitLocale = hints.locale === "zh-CN" ? "zh-CN" : "en";
    // v0.1 refresh always uses the supported cursor/ide pair.
    const defaultsYaml = defaultConfigYaml({
      platform: "cursor",
      surface: "ide",
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
    if (fs.existsSync(dbPath)) {
      actions.push("backup state.db → state.db.bak.<timestamp> (snapshot)");
      actions.push("migrate state.db (idempotent)");
    } else {
      actions.push("no state.db yet (skip backup/migrate)");
    }

    actions.push(`update pin.json → ${version}`);
    actions.push("refresh .autopilot/bin/autopilot-harness-hook.mjs");
    actions.push("refresh .cursor/skills/autopilot-*");
    actions.push("refresh docs/autopilot/workflows/*");
    actions.push("merge .cursor/hooks.json (Autopilot entries)");

    if (opts.target && opts.target !== version) {
      actions.push(
        `note: --target ${opts.target} ignored in v0.1; pinning to CLI ${version}`,
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
      };
    }

    // Backup before any StateStore open (migrate).
    written.push(...backupStateDb(projectRoot));

    if (fs.existsSync(dbPath)) {
      migrateStateDb(projectRoot);
    }

    // Refresh pin/hooks/skills first so a hooks fail-closed path does not
    // leave config.yml already rewritten with appended keys.
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
      writeFileAtomic(configPath, merged.yaml);
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
