import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlDatabase } from "./sqlite.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getLatestSchemaVersion(): number {
  return 1;
}

export function readMigrationSql(version: number): string {
  const filename = `${String(version).padStart(3, "0")}_initial.sql`;
  return readFileSync(join(__dirname, "..", "migrations", filename), "utf8");
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
  return row ? Number.parseInt(row.value, 10) : 0;
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
