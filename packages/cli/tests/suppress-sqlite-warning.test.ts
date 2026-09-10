/**
 * cli-sqlite-warn — narrow process.emitWarning filter for node:sqlite noise.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isSqliteExperimentalWarning } from "../src/sqlite-warning-predicate.js";
import { installSuppressSqliteWarning } from "../src/suppress-sqlite-warning.js";

describe("sqlite-warning-predicate", () => {
  it("only matches ExperimentalWarning + sqlite in the message", () => {
    expect(
      isSqliteExperimentalWarning(
        "ExperimentalWarning",
        "The SQLite module is an experimental feature.",
      ),
    ).toBe(true);
    expect(
      isSqliteExperimentalWarning("ExperimentalWarning", "node:sqlite"),
    ).toBe(true);
    expect(
      isSqliteExperimentalWarning(
        "experimentalwarning",
        "SQLite ExperimentalWarning detail",
      ),
    ).toBe(true);
    expect(
      isSqliteExperimentalWarning(
        "ExperimentalWarning",
        "Fetch is experimental.",
      ),
    ).toBe(false);
    expect(isSqliteExperimentalWarning("Warning", "sqlite mentioned")).toBe(
      false,
    );
    expect(isSqliteExperimentalWarning("", "sqlite")).toBe(false);
    expect(isSqliteExperimentalWarning("ExperimentalWarning", "")).toBe(false);
  });
});

describe("suppress-sqlite-warning", () => {
  it("wraps emitWarning and drops only sqlite ExperimentalWarning", () => {
    const flag = Symbol.for(
      "@autopilot-harness/cli.suppressSqliteWarning",
    );
    const forwarded: unknown[][] = [];
    const base = ((warning: string | Error, ...args: unknown[]) => {
      forwarded.push([warning, ...args]);
    }) as typeof process.emitWarning;

    const previous = process.emitWarning;
    const proc = process as NodeJS.Process & { [k: symbol]: unknown };
    const previousFlag = proc[flag];
    try {
      process.emitWarning = base;
      delete proc[flag];
      installSuppressSqliteWarning();
      forwarded.length = 0;
      process.emitWarning(
        "The SQLite module is an experimental feature.",
        "ExperimentalWarning",
      );
      const err = new Error("SQLite is experimental.");
      err.name = "ExperimentalWarning";
      process.emitWarning(err);
      process.emitWarning("sqlite via options type", {
        type: "ExperimentalWarning",
      } as ErrorOptions & { type: string });
      process.emitWarning("Fetch is experimental.", "ExperimentalWarning");
      expect(forwarded).toEqual([
        ["Fetch is experimental.", "ExperimentalWarning"],
      ]);
    } finally {
      process.emitWarning = previous;
      if (previousFlag !== undefined) proc[flag] = previousFlag;
      else delete proc[flag];
    }
  });

  it("bin.ts imports the suppressor before other CLI modules", () => {
    const bin = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/bin.ts",
    );
    const src = fs.readFileSync(bin, "utf8");
    const firstImport = src
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith("import "));
    expect(firstImport).toBe('import "./suppress-sqlite-warning.js";');
  });
});
