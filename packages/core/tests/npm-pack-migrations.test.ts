import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const coreRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listMigrationSqlFiles(): string[] {
  const migDir = path.join(coreRoot, "migrations");
  return fs
    .readdirSync(migDir)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
}

describe("core npm pack migrations", () => {
  it("package.json files includes migrations (beside dist)", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(coreRoot, "package.json"), "utf8"),
    ) as { files?: string[] };
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("migrations");
  });

  it("npm pack ships migrations/*.sql and migrate resolves them from dist/", async () => {
    const migFiles = listMigrationSqlFiles();
    expect(migFiles.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(coreRoot, "dist", "migrate.js"))).toBe(
      true,
    );

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-core-pack-"));
    try {
      const packed = execFileSync(
        "npm",
        ["pack", "--pack-destination", outDir, "--silent"],
        { cwd: coreRoot, encoding: "utf8" },
      ).trim();
      const tgz = path.join(outDir, packed.split("\n").pop()!);
      expect(fs.existsSync(tgz)).toBe(true);

      const listing = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
      expect(listing).toMatch(/package\/dist\/migrate\.js/);
      for (const f of migFiles) {
        expect(listing).toMatch(
          new RegExp(`package/migrations/${escapeRegExp(f)}`),
        );
      }

      // Published layout: node_modules/@autopilot-harness/core/{dist,migrations}
      // migrate.js resolves ../migrations from dist/ — listing alone is not enough.
      const extractDir = path.join(outDir, "extract");
      fs.mkdirSync(extractDir);
      execFileSync("tar", ["-xzf", tgz, "-C", extractDir]);
      const packedMigrate = path.join(
        extractDir,
        "package",
        "dist",
        "migrate.js",
      );
      const { getLatestSchemaVersion } = await import(
        pathToFileURL(packedMigrate).href
      );
      expect(getLatestSchemaVersion()).toBe(migFiles.length);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
