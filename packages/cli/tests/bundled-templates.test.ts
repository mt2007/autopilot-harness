import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resolveTemplatesRoot,
  templatesRootCandidates,
  isUsableTemplatesRoot,
} from "../src/template-paths.js";
import { AUTOPILOT_SKILL_NAMES, AUTOPILOT_WORKFLOW_FILES } from "../src/init/install.js";

const cliRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("bundled templates for npm publish", () => {
  it("assets/templates ships skills, workflows, and .autopilotignore", () => {
    const bundled = path.join(cliRoot, "assets", "templates");
    expect(isUsableTemplatesRoot(bundled)).toBe(true);
    for (const name of AUTOPILOT_SKILL_NAMES) {
      expect(
        fs.existsSync(path.join(bundled, "skills", name, "SKILL.md.tpl")),
      ).toBe(true);
    }
    for (const name of AUTOPILOT_WORKFLOW_FILES) {
      expect(fs.existsSync(path.join(bundled, "workflows", name))).toBe(true);
    }
  });

  it("resolveTemplatesRoot finds bundled assets when monorepo templates are absent", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cli-root-"));
    try {
      const bundled = path.join(cliRoot, "assets", "templates");
      fs.cpSync(bundled, path.join(fake, "assets", "templates"), {
        recursive: true,
      });
      const resolved = resolveTemplatesRoot(fake);
      expect(resolved).toBe(path.join(fake, "assets", "templates"));
      expect(fs.existsSync(path.join(resolved, "skills", "autopilot-on", "SKILL.md.tpl"))).toBe(
        true,
      );
      // Monorepo sibling must not win for this fake root
      expect(templatesRootCandidates(fake)[0]).toBe(path.resolve(fake, "../templates"));
      expect(fs.existsSync(path.join(templatesRootCandidates(fake)[0]!, "skills"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("resolveTemplatesRoot finds dist/assets when package-root assets are absent", () => {
    // Published npm layout: files:["dist"] — no package-root assets/
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cli-pub-"));
    try {
      const bundled = path.join(cliRoot, "assets", "templates");
      fs.cpSync(bundled, path.join(fake, "dist", "assets", "templates"), {
        recursive: true,
      });
      expect(fs.existsSync(path.join(fake, "assets"))).toBe(false);
      const resolved = resolveTemplatesRoot(fake);
      expect(resolved).toBe(path.join(fake, "dist", "assets", "templates"));
      expect(isUsableTemplatesRoot(resolved)).toBe(true);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("empty sibling templates/skills does not beat bundled assets", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cli-layout-"));
    const fake = path.join(parent, "cli");
    const sibling = path.join(parent, "templates");
    try {
      fs.mkdirSync(fake, { recursive: true });
      fs.mkdirSync(path.join(sibling, "skills"), { recursive: true });
      fs.cpSync(
        path.join(cliRoot, "assets", "templates"),
        path.join(fake, "assets", "templates"),
        { recursive: true },
      );
      expect(path.resolve(fake, "../templates")).toBe(sibling);
      expect(isUsableTemplatesRoot(sibling)).toBe(false);
      expect(resolveTemplatesRoot(fake)).toBe(path.join(fake, "assets", "templates"));
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("zero-byte sentinel files are not usable templates roots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-zero-tpl-"));
    try {
      fs.mkdirSync(path.join(root, "skills", "autopilot-on"), { recursive: true });
      fs.mkdirSync(path.join(root, "workflows"), { recursive: true });
      fs.writeFileSync(path.join(root, "skills", "autopilot-on", "SKILL.md.tpl"), "");
      fs.writeFileSync(path.join(root, "workflows", "autopilot-planning.md"), "");
      fs.writeFileSync(path.join(root, ".autopilotignore"), "");
      expect(isUsableTemplatesRoot(root)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets refuses symlinks under assets", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-symlink-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.mkdirSync(path.join(fake, "assets", "ok"), { recursive: true });
      fs.writeFileSync(path.join(fake, "assets", "ok", "x.txt"), "x");
      fs.symlinkSync(path.join(fake, "assets", "ok"), path.join(fake, "assets", "link"));
      expect(() =>
        execFileSync("node", [script, fake], { encoding: "utf8", stdio: "pipe" }),
      ).toThrow();
      expect(fs.existsSync(path.join(fake, "dist", "assets", "link"))).toBe(false);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets fails when required publish assets are incomplete", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-incomplete-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.mkdirSync(path.join(fake, "assets", "templates"), { recursive: true });
      fs.writeFileSync(path.join(fake, "assets", "templates", "only.txt"), "x");
      expect(() =>
        execFileSync("node", [script, fake], { encoding: "utf8", stdio: "pipe" }),
      ).toThrow();
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets fails cleanly when dist is a blocking file", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-dist-file-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.cpSync(path.join(cliRoot, "assets"), path.join(fake, "assets"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(fake, "dist"), "not-a-dir");
      expect(() =>
        execFileSync("node", [script, fake], { encoding: "utf8", stdio: "pipe" }),
      ).toThrow();
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets leaves existing dist/assets intact when validation fails", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-keep-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.mkdirSync(path.join(fake, "dist", "assets"), { recursive: true });
      fs.writeFileSync(path.join(fake, "dist", "assets", "keep.txt"), "keep");
      fs.mkdirSync(path.join(fake, "assets", "templates"), { recursive: true });
      fs.writeFileSync(path.join(fake, "assets", "templates", "only.txt"), "x");
      expect(() =>
        execFileSync("node", [script, fake], { encoding: "utf8", stdio: "pipe" }),
      ).toThrow();
      expect(fs.readFileSync(path.join(fake, "dist", "assets", "keep.txt"), "utf8")).toBe(
        "keep",
      );
      // Staging / old-swap dirs must not leak under package root or dist/
      const leakedRoot = fs
        .readdirSync(fake)
        .filter(
          (n) =>
            n.startsWith(".assets-staging-") ||
            n.startsWith(".assets-old-") ||
            n.startsWith(".assets-blocking-"),
        );
      expect(leakedRoot).toEqual([]);
      const leakedDist = fs
        .readdirSync(path.join(fake, "dist"))
        .filter(
          (n) =>
            n.startsWith(".assets-staging-") ||
            n.startsWith(".assets-old-") ||
            n.startsWith(".assets-blocking-"),
        );
      expect(leakedDist).toEqual([]);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets restores stranded .assets-old-* before rejecting bad source", () => {
    // Invariant: last good tree left at .assets-old-* must not be deleted by cleanStale.
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-recover-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.mkdirSync(path.join(fake, "dist"), { recursive: true });
      const stranded = path.join(fake, ".assets-old-1");
      fs.cpSync(path.join(cliRoot, "assets"), stranded, { recursive: true });
      fs.writeFileSync(path.join(stranded, "keep.txt"), "keep");
      fs.mkdirSync(path.join(fake, "assets", "templates"), { recursive: true });
      fs.writeFileSync(path.join(fake, "assets", "templates", "only.txt"), "x");
      expect(() =>
        execFileSync("node", [script, fake], { encoding: "utf8", stdio: "pipe" }),
      ).toThrow();
      expect(fs.readFileSync(path.join(fake, "dist", "assets", "keep.txt"), "utf8")).toBe(
        "keep",
      );
      expect(
        fs.existsSync(
          path.join(
            fake,
            "dist",
            "assets",
            "templates",
            "skills",
            "autopilot-on",
            "SKILL.md.tpl",
          ),
        ),
      ).toBe(true);
      expect(fs.existsSync(stranded)).toBe(false);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets clears blocking non-dir dest then restores stranded old", () => {
    // File (or similar) at dist/assets must not prevent recovering `.assets-old-*`,
    // and must not cause cleanStale to wipe the stranded tree first.
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-keep-old-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.mkdirSync(path.join(fake, "dist"), { recursive: true });
      fs.writeFileSync(path.join(fake, "dist", "assets"), "not-a-dir");
      const stranded = path.join(fake, ".assets-old-9");
      fs.cpSync(path.join(cliRoot, "assets"), stranded, { recursive: true });
      fs.writeFileSync(path.join(stranded, "keep.txt"), "keep");
      fs.mkdirSync(path.join(fake, "assets", "templates"), { recursive: true });
      fs.writeFileSync(path.join(fake, "assets", "templates", "only.txt"), "x");
      expect(() =>
        execFileSync("node", [script, fake], { encoding: "utf8", stdio: "pipe" }),
      ).toThrow();
      expect(fs.readFileSync(path.join(fake, "dist", "assets", "keep.txt"), "utf8")).toBe(
        "keep",
      );
      expect(fs.existsSync(stranded)).toBe(false);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets prefers complete stranded old over newer incomplete dir", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-prefer-old-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.mkdirSync(path.join(fake, "dist"), { recursive: true });
      const complete = path.join(fake, ".assets-old-1");
      const incomplete = path.join(fake, ".assets-old-2");
      fs.cpSync(path.join(cliRoot, "assets"), complete, { recursive: true });
      fs.writeFileSync(path.join(complete, "marker.txt"), "complete");
      fs.mkdirSync(incomplete, { recursive: true });
      fs.writeFileSync(path.join(incomplete, "marker.txt"), "incomplete");
      const past = new Date(Date.now() - 60_000);
      const recent = new Date();
      fs.utimesSync(complete, past, past);
      fs.utimesSync(incomplete, recent, recent);
      fs.mkdirSync(path.join(fake, "assets", "templates"), { recursive: true });
      fs.writeFileSync(path.join(fake, "assets", "templates", "only.txt"), "x");
      expect(() =>
        execFileSync("node", [script, fake], { encoding: "utf8", stdio: "pipe" }),
      ).toThrow();
      expect(
        fs.readFileSync(path.join(fake, "dist", "assets", "marker.txt"), "utf8"),
      ).toBe("complete");
      // Incomplete sibling must survive until a successful swap.
      expect(fs.existsSync(incomplete)).toBe(true);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets replaces incomplete dest dir with complete stranded old", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-incomplete-dest-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.mkdirSync(path.join(fake, "dist", "assets", "templates"), { recursive: true });
      fs.writeFileSync(path.join(fake, "dist", "assets", "templates", "only.txt"), "stale");
      const stranded = path.join(fake, ".assets-old-1");
      fs.cpSync(path.join(cliRoot, "assets"), stranded, { recursive: true });
      fs.writeFileSync(path.join(stranded, "marker.txt"), "complete");
      fs.mkdirSync(path.join(fake, "assets", "templates"), { recursive: true });
      fs.writeFileSync(path.join(fake, "assets", "templates", "only.txt"), "x");
      expect(() =>
        execFileSync("node", [script, fake], { encoding: "utf8", stdio: "pipe" }),
      ).toThrow();
      expect(
        fs.readFileSync(path.join(fake, "dist", "assets", "marker.txt"), "utf8"),
      ).toBe("complete");
      expect(
        fs.existsSync(
          path.join(
            fake,
            "dist",
            "assets",
            "templates",
            "skills",
            "autopilot-on",
            "SKILL.md.tpl",
          ),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets drops non-dir .assets-old-* junk while dest is missing", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-junk-old-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.mkdirSync(path.join(fake, "dist"), { recursive: true });
      const junk = path.join(fake, ".assets-old-junk");
      fs.writeFileSync(junk, "x");
      fs.mkdirSync(path.join(fake, "assets", "templates"), { recursive: true });
      fs.writeFileSync(path.join(fake, "assets", "templates", "only.txt"), "x");
      expect(() =>
        execFileSync("node", [script, fake], { encoding: "utf8", stdio: "pipe" }),
      ).toThrow();
      expect(fs.existsSync(junk)).toBe(false);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets replaces prior dist/assets on success", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-replace-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.mkdirSync(path.join(fake, "dist", "assets"), { recursive: true });
      fs.writeFileSync(path.join(fake, "dist", "assets", "stale.txt"), "stale");
      fs.cpSync(path.join(cliRoot, "assets"), path.join(fake, "assets"), {
        recursive: true,
      });
      execFileSync("node", [script, fake], { stdio: "pipe" });
      expect(fs.existsSync(path.join(fake, "dist", "assets", "stale.txt"))).toBe(
        false,
      );
      expect(
        fs.existsSync(
          path.join(
            fake,
            "dist",
            "assets",
            "templates",
            "skills",
            "autopilot-on",
            "SKILL.md.tpl",
          ),
        ),
      ).toBe(true);
      const leakedRoot = fs
        .readdirSync(fake)
        .filter(
          (n) =>
            n.startsWith(".assets-staging-") ||
            n.startsWith(".assets-old-") ||
            n.startsWith(".assets-blocking-"),
        );
      expect(leakedRoot).toEqual([]);
      const leakedDist = fs
        .readdirSync(path.join(fake, "dist"))
        .filter(
          (n) =>
            n.startsWith(".assets-staging-") ||
            n.startsWith(".assets-old-") ||
            n.startsWith(".assets-blocking-"),
        );
      expect(leakedDist).toEqual([]);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("sync-dist-assets replaces broken symlink at dist/assets", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-sync-broken-link-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      fs.mkdirSync(path.join(fake, "dist"), { recursive: true });
      fs.symlinkSync(
        path.join(fake, "missing-target"),
        path.join(fake, "dist", "assets"),
      );
      expect(fs.existsSync(path.join(fake, "dist", "assets"))).toBe(false);
      fs.cpSync(path.join(cliRoot, "assets"), path.join(fake, "assets"), {
        recursive: true,
      });
      execFileSync("node", [script, fake], { stdio: "pipe" });
      const st = fs.lstatSync(path.join(fake, "dist", "assets"));
      expect(st.isSymbolicLink()).toBe(false);
      expect(st.isDirectory()).toBe(true);
      expect(
        fs.existsSync(
          path.join(
            fake,
            "dist",
            "assets",
            "templates",
            "skills",
            "autopilot-on",
            "SKILL.md.tpl",
          ),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("resolveTemplatesRoot error fallback prefers dist/assets when assets/ absent", () => {
    const fake = fs.mkdtempSync(path.join(os.tmpdir(), "ap-cli-fallback-"));
    try {
      // No usable templates anywhere — published-shaped package root.
      fs.mkdirSync(path.join(fake, "dist", "assets"), { recursive: true });
      expect(fs.existsSync(path.join(fake, "assets"))).toBe(false);
      expect(resolveTemplatesRoot(fake)).toBe(
        path.join(fake, "dist", "assets", "templates"),
      );
    } finally {
      fs.rmSync(fake, { recursive: true, force: true });
    }
  });

  it("npm pack tarball ships templates under dist/assets only", () => {
    // Isolated pack root — do not mutate workspace dist/ (vitest file parallelism).
    expect(fs.existsSync(path.join(cliRoot, "assets", "templates", "skills"))).toBe(
      true,
    );
    const packRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ap-pack-root-"));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-pack-out-"));
    const script = path.join(cliRoot, "scripts", "sync-dist-assets.mjs");
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(cliRoot, "package.json"), "utf8"),
      ) as { name: string; version: string; files: string[] };
      expect(pkg.files).toEqual(["dist"]);
      fs.writeFileSync(
        path.join(packRoot, "package.json"),
        JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          files: pkg.files,
        }),
      );
      fs.cpSync(path.join(cliRoot, "assets"), path.join(packRoot, "assets"), {
        recursive: true,
      });
      execFileSync("node", [script, packRoot], { stdio: "pipe" });

      const packed = execFileSync(
        "npm",
        ["pack", "--pack-destination", outDir, "--silent"],
        { cwd: packRoot, encoding: "utf8" },
      ).trim();
      const tgz = path.join(outDir, packed.split("\n").pop()!);
      expect(fs.existsSync(tgz)).toBe(true);
      const listing = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
      expect(listing).toMatch(
        /package\/dist\/assets\/templates\/skills\/autopilot-on\/SKILL\.md\.tpl/,
      );
      expect(listing).toMatch(
        /package\/dist\/assets\/templates\/workflows\/autopilot-planning\.md/,
      );
      expect(listing).toMatch(
        /package\/dist\/assets\/templates\/\.autopilotignore/,
      );
      expect(listing).toMatch(
        /package\/dist\/assets\/autopilot-harness-hook\.mjs/,
      );
      expect(listing).toMatch(
        /package\/dist\/assets\/vendor\/runtime\.mjs/,
      );
      expect(listing).toMatch(
        /package\/dist\/assets\/vendor\/migrations\/001_initial\.sql/,
      );
      expect(listing).toMatch(
        /package\/dist\/assets\/vendor\/migrations\/002_pending_followup\.sql/,
      );
      expect(listing).toMatch(
        /package\/dist\/assets\/vendor\/migrations\/003_reviewing_item\.sql/,
      );
      // Publish files: ["dist"] — do not double-ship package-root assets/
      expect(listing).not.toMatch(/^package\/assets\//m);
      // Temp swap dirs must never appear in the tarball
      expect(listing).not.toMatch(/\.assets-staging-/);
      expect(listing).not.toMatch(/\.assets-old-/);
      expect(listing).not.toMatch(/\.assets-blocking-/);
    } finally {
      fs.rmSync(packRoot, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("bundle-templates REQUIRED_* stays in sync with AUTOPILOT_* exports", () => {
    const script = fs.readFileSync(
      path.join(cliRoot, "scripts", "bundle-templates.mjs"),
      "utf8",
    );
    const skillsMatch = script.match(
      /const REQUIRED_SKILLS = \[([\s\S]*?)\];/,
    );
    const workflowsMatch = script.match(
      /const REQUIRED_WORKFLOWS = \[([\s\S]*?)\];/,
    );
    expect(skillsMatch).toBeTruthy();
    expect(workflowsMatch).toBeTruthy();
    const parseList = (block: string) =>
      [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(parseList(skillsMatch![1]!)).toEqual([...AUTOPILOT_SKILL_NAMES]);
    expect(parseList(workflowsMatch![1]!)).toEqual([
      ...AUTOPILOT_WORKFLOW_FILES,
    ]);
  });

  it("sync-dist-assets REQUIRED_RELATIVE covers AUTOPILOT_* and core migrations", () => {
    const script = fs.readFileSync(
      path.join(cliRoot, "scripts", "sync-dist-assets.mjs"),
      "utf8",
    );
    const match = script.match(/const REQUIRED_RELATIVE = \[([\s\S]*?)\];/);
    expect(match).toBeTruthy();
    const list = [...match![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    for (const name of AUTOPILOT_SKILL_NAMES) {
      expect(list).toContain(`templates/skills/${name}/SKILL.md.tpl`);
    }
    for (const name of AUTOPILOT_WORKFLOW_FILES) {
      expect(list).toContain(`templates/workflows/${name}`);
    }
    expect(list).toContain("templates/.autopilotignore");
    expect(list).toContain("autopilot-harness-hook.mjs");
    expect(list).toContain("vendor/runtime.mjs");
    const migDir = path.join(cliRoot, "../core/migrations");
    const migFiles = fs
      .readdirSync(migDir)
      .filter((f) => /^\d{3}_.+\.sql$/.test(f))
      .sort();
    expect(migFiles.length).toBeGreaterThan(0);
    for (const f of migFiles) {
      expect(list).toContain(`vendor/migrations/${f}`);
    }
  });
});
