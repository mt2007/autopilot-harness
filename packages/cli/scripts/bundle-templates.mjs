#!/usr/bin/env node
/**
 * Copy packages/templates (skills, workflows, .autopilotignore) into
 * packages/cli/assets/templates so the published npm tarball can init/upgrade
 * without a separate @autopilot-harness/templates package.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(cliRoot, "../..");
const srcRoot = path.join(repoRoot, "packages", "templates");
const outRoot = path.join(cliRoot, "assets", "templates");

/** Keep in sync with AUTOPILOT_SKILL_NAMES / AUTOPILOT_WORKFLOW_FILES in install.ts */
const REQUIRED_SKILLS = [
  "autopilot-on",
  "autopilot-run",
  "autopilot-off",
  "autopilot-resume",
  "autopilot-replan",
];
const REQUIRED_WORKFLOWS = [
  "autopilot-planning.md",
  "autopilot-executing.md",
];

function assertDir(p, label) {
  if (!fs.existsSync(p) || !fs.lstatSync(p).isDirectory()) {
    throw new Error(`Missing ${label}: ${p}`);
  }
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".DS_Store") continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isSymbolicLink()) {
      throw new Error(`Refusing to bundle symlink: ${from}`);
    }
    if (ent.isDirectory()) copyDir(from, to);
    else if (ent.isFile()) fs.copyFileSync(from, to);
    else throw new Error(`Unsupported file type in templates: ${from}`);
  }
}

assertDir(srcRoot, "templates package");
assertDir(path.join(srcRoot, "skills"), "templates/skills");
assertDir(path.join(srcRoot, "workflows"), "templates/workflows");
const ignoreSrc = path.join(srcRoot, ".autopilotignore");
if (!fs.existsSync(ignoreSrc)) {
  throw new Error(`Missing templates/.autopilotignore: ${ignoreSrc}`);
}
{
  const st = fs.lstatSync(ignoreSrc);
  if (st.isSymbolicLink()) {
    throw new Error(`Refusing to bundle symlink: ${ignoreSrc}`);
  }
  if (!st.isFile()) {
    throw new Error(`templates/.autopilotignore is not a regular file: ${ignoreSrc}`);
  }
}

for (const name of REQUIRED_SKILLS) {
  const tpl = path.join(srcRoot, "skills", name, "SKILL.md.tpl");
  if (!fs.existsSync(tpl)) {
    throw new Error(`Missing required skill template: ${tpl}`);
  }
  const st = fs.lstatSync(tpl);
  if (st.isSymbolicLink()) {
    throw new Error(`Refusing to bundle symlink: ${tpl}`);
  }
  if (!st.isFile()) {
    throw new Error(`Skill template is not a regular file: ${tpl}`);
  }
}
for (const name of REQUIRED_WORKFLOWS) {
  const wf = path.join(srcRoot, "workflows", name);
  if (!fs.existsSync(wf)) {
    throw new Error(`Missing required workflow: ${wf}`);
  }
  const st = fs.lstatSync(wf);
  if (st.isSymbolicLink()) {
    throw new Error(`Refusing to bundle symlink: ${wf}`);
  }
  if (!st.isFile()) {
    throw new Error(`Workflow is not a regular file: ${wf}`);
  }
}

rmrf(outRoot);
fs.mkdirSync(outRoot, { recursive: true });
copyDir(path.join(srcRoot, "skills"), path.join(outRoot, "skills"));
copyDir(path.join(srcRoot, "workflows"), path.join(outRoot, "workflows"));
fs.copyFileSync(ignoreSrc, path.join(outRoot, ".autopilotignore"));

for (const name of REQUIRED_SKILLS) {
  const tpl = path.join(outRoot, "skills", name, "SKILL.md.tpl");
  if (!fs.existsSync(tpl)) {
    throw new Error(`Bundle missing skill after copy: ${tpl}`);
  }
}
for (const name of REQUIRED_WORKFLOWS) {
  const wf = path.join(outRoot, "workflows", name);
  if (!fs.existsSync(wf)) {
    throw new Error(`Bundle missing workflow after copy: ${wf}`);
  }
}

console.log(
  `templates: wrote assets/templates/ (skills=${REQUIRED_SKILLS.length}, workflows=${REQUIRED_WORKFLOWS.length})`,
);
