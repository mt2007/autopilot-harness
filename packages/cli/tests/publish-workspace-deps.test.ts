import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../src/init/types.js";
import {
  PUBLIC_PACKAGE_DIRS,
  PUBLIC_PACKAGE_JSON_PATHS,
} from "./public-npm-packages.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const PACKAGES_WITH_WORKSPACE_DEPS = [
  "packages/cli",
  "packages/ports/cursor",
  "packages/ports/claude-code",
  "packages/ports/codex",
  "packages/ports/kimi-code",
  "packages/ports/copilot-cli",
  "packages/ports/grok-build",
  "packages/ports/gemini-cli",
] as const;

function workspaceHarnessDeps(
  dependencies: Record<string, string> | undefined,
): [string, string][] {
  return Object.entries(dependencies ?? {}).filter(
    ([name, range]) =>
      name.startsWith("@autopilot-harness/") && range.startsWith("workspace:"),
  );
}

/** Pack into a temp dir; always delete the dir (including on pack/assert failure). */
function withPackedTarball(
  pkgDir: string,
  packer: "pnpm" | "npm",
  use: (tgz: string) => void,
): void {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `ap-${packer}-pack-`));
  try {
    execFileSync(packer, ["pack", "--pack-destination", outDir], {
      cwd: pkgDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tgzNames = fs.readdirSync(outDir).filter((f) => f.endsWith(".tgz"));
    expect(tgzNames.length, `${packer} pack wrote no .tgz in ${outDir}`).toBe(
      1,
    );
    use(path.join(outDir, tgzNames[0]!));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function readPackedPackageJson(tgz: string): {
  dependencies?: Record<string, string>;
} {
  const pkgJson = execFileSync("tar", ["-xOf", tgz, "package/package.json"], {
    encoding: "utf8",
  });
  return JSON.parse(pkgJson) as { dependencies?: Record<string, string> };
}

/**
 * `npm publish` from a package dir ships raw `workspace:*` (broken for consumers).
 * `pnpm publish` / `pnpm pack` rewrites those to concrete versions — lock that in.
 */
describe("pnpm pack rewrites workspace:* for publish", () => {
  it("PACKAGES_WITH_WORKSPACE_DEPS covers every public package with workspace:*", () => {
    for (const rel of PUBLIC_PACKAGE_DIRS) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, rel, "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };
      if (workspaceHarnessDeps(pkg.dependencies).length === 0) continue;
      expect(
        PACKAGES_WITH_WORKSPACE_DEPS as readonly string[],
        `${rel} declares workspace:* but is missing from PACKAGES_WITH_WORKSPACE_DEPS`,
      ).toContain(rel);
    }
  });

  it("PUBLIC_PACKAGE_JSON_PATHS lists every publishable workspace package.json", () => {
    const candidates: string[] = [];
    for (const name of fs.readdirSync(path.join(repoRoot, "packages"))) {
      if (name === "ports") continue;
      const rel = `packages/${name}/package.json`;
      if (fs.existsSync(path.join(repoRoot, rel))) candidates.push(rel);
    }
    for (const name of fs.readdirSync(path.join(repoRoot, "packages/ports"))) {
      const rel = `packages/ports/${name}/package.json`;
      if (fs.existsSync(path.join(repoRoot, rel))) candidates.push(rel);
    }
    const publishable: string[] = [];
    for (const rel of candidates) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, rel), "utf8"),
      ) as {
        private?: boolean;
        publishConfig?: { access?: string };
      };
      if (pkg.private === true) continue;
      if (pkg.publishConfig?.access !== "public") continue;
      publishable.push(rel);
    }
    expect(publishable.sort()).toEqual(
      [...PUBLIC_PACKAGE_JSON_PATHS].sort(),
    );
  });

  for (const rel of PACKAGES_WITH_WORKSPACE_DEPS) {
    it(`${rel} tarball deps are concrete ${PACKAGE_VERSION} (no workspace:)`, () => {
      const pkgDir = path.join(repoRoot, rel);
      const srcPkg = JSON.parse(
        fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
      ) as {
        name: string;
        version: string;
        dependencies?: Record<string, string>;
      };

      expect(srcPkg.version).toBe(PACKAGE_VERSION);
      const workspaceDeps = workspaceHarnessDeps(srcPkg.dependencies);
      expect(
        workspaceDeps.length,
        `${rel} should still declare workspace:* in source`,
      ).toBeGreaterThan(0);

      withPackedTarball(pkgDir, "pnpm", (tgz) => {
        const deps = readPackedPackageJson(tgz).dependencies ?? {};
        for (const [name] of workspaceDeps) {
          expect(deps[name], `${rel} packed ${name}`).toBe(PACKAGE_VERSION);
          expect(deps[name]).not.toMatch(/^workspace:/);
        }
        expect(JSON.stringify(deps)).not.toMatch(/workspace:/);
        // cli ships compiled PACKAGE_VERSION — stale dist must not ship after a bump.
        if (rel === "packages/cli") {
          const typesJs = execFileSync(
            "tar",
            ["-xOf", tgz, "package/dist/init/types.js"],
            { encoding: "utf8" },
          );
          const assignments =
            typesJs.match(/export const PACKAGE_VERSION\s*=\s*"[^"]+"/g) ?? [];
          expect(assignments).toEqual([
            `export const PACKAGE_VERSION = "${PACKAGE_VERSION}"`,
          ]);
        }
      });
    });
  }

  it("npm pack leaves workspace:* (do not npm publish from package dir)", () => {
    const pkgDir = path.join(repoRoot, "packages/cli");
    const srcPkg = JSON.parse(
      fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const workspaceDeps = workspaceHarnessDeps(srcPkg.dependencies);
    expect(workspaceDeps.length).toBeGreaterThan(0);

    withPackedTarball(pkgDir, "npm", (tgz) => {
      const deps = readPackedPackageJson(tgz).dependencies ?? {};
      for (const [name, range] of workspaceDeps) {
        expect(deps[name], `npm pack must keep ${name} as workspace`).toBe(
          range,
        );
      }
      expect(JSON.stringify(deps)).toMatch(/workspace:/);
    });
  });
});
