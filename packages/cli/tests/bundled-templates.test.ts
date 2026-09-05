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

  it("npm pack tarball includes assets/templates skills", () => {
    // Requires prior `pnpm --filter @autopilot-harness/cli run bundle-templates`
    // (root `pnpm test` / `pnpm build` already run it).
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ap-pack-"));
    try {
      const packed = execFileSync(
        "npm",
        ["pack", "--pack-destination", outDir, "--silent"],
        { cwd: cliRoot, encoding: "utf8" },
      ).trim();
      const tgz = path.join(outDir, packed.split("\n").pop()!);
      expect(fs.existsSync(tgz)).toBe(true);
      const listing = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
      expect(listing).toMatch(
        /package\/assets\/templates\/skills\/autopilot-on\/SKILL\.md\.tpl/,
      );
      expect(listing).toMatch(
        /package\/assets\/templates\/workflows\/autopilot-planning\.md/,
      );
      expect(listing).toMatch(/package\/assets\/templates\/\.autopilotignore/);
    } finally {
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
});
