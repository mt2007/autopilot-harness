import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlDatabase } from "./sqlite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getLatestSchemaVersion(): number {
  return 3;
}

function migrationDirs(): string[] {
  // Package layout: packages/core/{src,dist}/../migrations
  // Vendor layout: .autopilot/bin/vendor/migrations (beside runtime.mjs)
  return [
    join(__dirname, "..", "migrations"),
    join(__dirname, "migrations"),
  ];
}

export function readMigrationSql(version: number): string {
  const prefix = `${String(version).padStart(3, "0")}_`;
  for (const dir of migrationDirs()) {
    if (!existsSync(dir)) continue;
    const matches = readdirSync(dir).filter(
      (f) => f.startsWith(prefix) && f.endsWith(".sql"),
    );
    if (matches.length === 1) {
      return readFileSync(join(dir, matches[0]!), "utf8");
    }
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous migration SQL for version ${version}: ${matches.join(", ")}`,
      );
    }
  }
  throw new Error(`Missing migration SQL for version ${version}`);
}

/** Non-finite / non-integer / negative meta must not be treated as "already latest". */
export function parseSchemaVersionValue(raw: unknown): number {
  if (raw == null) return 0;
  // Require a full integer token — parseInt("2abc")/("2.9") would wrongly yield 2.
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return 0;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return 0;
  return n;
}

export function getCurrentSchemaVersion(db: SqlDatabase): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const row = db
    .prepare("SELECT value FROM _schema_meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  return parseSchemaVersionValue(row?.value);
}

export function migrate(db: SqlDatabase): number {
  const current = getCurrentSchemaVersion(db);
  const latest = getLatestSchemaVersion();
  if (current >= latest) {
    return current;
  }
  for (let v = current + 1; v <= latest; v++) {
    const sql = readMigrationSql(v);
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT OR REPLACE INTO _schema_meta (key, value) VALUES ('schema_version', ?)",
      ).run(String(v));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return latest;
}
