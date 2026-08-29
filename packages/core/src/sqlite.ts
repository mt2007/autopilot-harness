/**
 * Sync SQLite via node:sqlite (DatabaseSync). Node 22.5+ / 24+ / 26+.
 * better-sqlite3 can be re-added as optional when prebuilds cover the runtime.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export interface SqlStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  pragma(source: string): unknown;
  close(): void;
}

export function openDatabase(filename: string): SqlDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): {
        run(...params: unknown[]): { changes?: number };
        get(...params: unknown[]): unknown;
        all(...params: unknown[]): unknown[];
      };
      exec(sql: string): void;
      close(): void;
    };
  };

  const db = new DatabaseSync(filename);
  return {
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        run: (...params: unknown[]) => {
          const r = stmt.run(...params);
          return { changes: r.changes ?? 0 };
        },
        get: (...params: unknown[]) => stmt.get(...params),
        all: (...params: unknown[]) => stmt.all(...params),
      };
    },
    exec: (sql: string) => {
      db.exec(sql);
    },
    pragma: (source: string) => {
      // source is always a trusted constant from StateStore (not user input)
      db.exec(`PRAGMA ${source}`);
      return undefined;
    },
    close: () => db.close(),
  };
}
