import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeQuickstart } from "../src/init/wizard-helpers.js";
import { PACKAGE_VERSION } from "../src/init/types.js";
import { CLI_NAME, NPM_PACKAGE_NAME } from "../src/names.js";
import os from "node:os";

/** Public npm packages that must share PACKAGE_VERSION on release bumps. */
const PUBLIC_PACKAGE_JSON_PATHS = [
  "packages/cli/package.json",
  "packages/core/package.json",
  "packages/i18n/package.json",
  "packages/ports/cursor/package.json",
  "packages/ports/claude-code/package.json",
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Slice Keep-a-Changelog section for `version` through the next `## [` heading. */
function changelogSection(log: string, version: string): string {
  const re = new RegExp(
    `## \\[${escapeRegExp(version)}\\][\\s\\S]*?(?=\\n## \\[|$)`,
  );
  const m = log.match(re);
  expect(m, `missing CHANGELOG section ${version}`).toBeTruthy();
  return m![0];
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ap-docs-contract-"));
}

/** Markers that OSS quickstart and init-generated quickstart must both carry. */
const EN_MARKERS = [
  /Self-review scope/,
  /review\.scope/,
  /executing_only/,
  /\*\*`project`\*\* \(default\)/,
  /claim/,
  /unpaused/,
  /loop_limit/,
  // run-pick-ux (docs-quickstart)
  /channel A/,
  /channel C/,
  /needPick/,
  /user_message/,
  /additionalContext/,
  /ON ≠ lock/,
  /pick only|pick vs execute/i,
  /_multi/,
  /candidates/,
  // on-skill-gate (docs-discuss-ne-on)
  /Discussion ≠ ON/,
  /applyOn/,
] as const;

const ZH_MARKERS = [
  /自审范围/,
  /review\.scope/,
  /executing_only/,
  /\*\*`project`\*\*（默认）/,
  /认领/,
  /未 pause/,
  /loop_limit/,
  /开启自动驾驶/,
  /开始执行/,
  /关闭自动驾驶/,
  // run-pick-ux (docs-quickstart)
  /通道 A/,
  /通道 C/,
  /needPick/,
  /user_message/,
  /additionalContext/,
  /ON ≠ 锁/,
  /只选型|选型 vs 执行/,
  /_multi/,
  /candidates/,
  // on-skill-gate (docs-discuss-ne-on)
  /讨论 ≠ ON/,
  /applyOn/,
] as const;

describe("docs contract (review.scope / claim / troubleshooting)", () => {
  it("OSS English quickstart keeps review.scope + claim markers", () => {
    const body = fs.readFileSync(
      path.join(repoRoot, "docs/autopilot/quickstart.md"),
      "utf8",
    );
    for (const re of EN_MARKERS) expect(body).toMatch(re);
    expect(body).not.toMatch(/\*\*`executing_only`\*\* \(default\)/);
    expect(body).toMatch(/docs\/config\.md|Config\]\(\.\.\/config\.md\)/);
    expect(body).toMatch(/Troubleshooting/);
  });

  it("OSS Chinese quickstart keeps review.scope + claim markers", () => {
    const body = fs.readFileSync(
      path.join(repoRoot, "docs/autopilot/quickstart.zh-CN.md"),
      "utf8",
    );
    for (const re of ZH_MARKERS) expect(body).toMatch(re);
    expect(body).not.toMatch(/\*\*`executing_only`\*\*（默认）/);
  });

  it("init writeQuickstart(en) matches OSS review.scope markers", () => {
    const root = tmpProject();
    try {
      const rel = writeQuickstart(root, "en");
      const body = fs.readFileSync(path.join(root, rel!), "utf8");
      for (const re of EN_MARKERS) expect(body).toMatch(re);
      expect(body).not.toMatch(/\*\*`executing_only`\*\* \(default\)/);
      expect(body).toMatch(/### Install|\*\*Install\*\*/);
      expect(body).toContain(`npx ${NPM_PACKAGE_NAME}`);
      expect(body).toContain(`npx ${NPM_PACKAGE_NAME} upgrade --dry-run`);
      expect(body).toContain(
        "https://github.com/mt2007/autopilot-harness/blob/main/CONTRIBUTING.md",
      );
      expect(body).toContain(`not bare \`npx ${CLI_NAME}\``);
      expect(body).not.toMatch(/Today \(not on public npm yet\)/);
      expect(body).not.toMatch(/After npm publish/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("init writeQuickstart(zh-CN) matches OSS review.scope markers", () => {
    const root = tmpProject();
    try {
      const rel = writeQuickstart(root, "zh-CN");
      const body = fs.readFileSync(path.join(root, rel!), "utf8");
      for (const re of ZH_MARKERS) expect(body).toMatch(re);
      expect(body).not.toMatch(/\*\*`executing_only`\*\*（默认）/);
      expect(body).toMatch(/### 安装|\*\*安装\*\*/);
      expect(body).toContain(`npx ${NPM_PACKAGE_NAME}`);
      expect(body).toContain(`npx ${NPM_PACKAGE_NAME} upgrade --dry-run`);
      expect(body).toContain(
        "https://github.com/mt2007/autopilot-harness/blob/main/CONTRIBUTING.md",
      );
      expect(body).toContain(`裸 \`npx ${CLI_NAME}\``);
      expect(body).not.toMatch(/今天（尚未上公共 npm）/);
      expect(body).not.toMatch(/发布到 npm 之后/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("config / troubleshooting / hosts docs exist with key anchors", () => {
    const config = fs.readFileSync(path.join(repoRoot, "docs/config.md"), "utf8");
    expect(config).toMatch(/review\.scope/);
    expect(config).toMatch(/confirm_rounds/);
    expect(config).toMatch(/\.autopilotignore/);

    const tips = fs.readFileSync(
      path.join(repoRoot, "docs/troubleshooting.md"),
      "utf8",
    );
    expect(tips).toMatch(/loop_limit/);
    expect(tips).toMatch(/double followup/i);
    expect(tips).toMatch(/CLAUDE_CODE_STOP_HOOK_BLOCK_CAP/);
    expect(tips).toMatch(/trust/i);
    expect(tips).toMatch(/--add-platform/);
    // Dual default: missing/invalid → executing_only; fresh init → project
    expect(tips).toMatch(/Missing \/ invalid[\s\S]*executing_only/i);
    expect(tips).toMatch(/Fresh `init` writes \*\*`project`\*\*/);

    const hosts = fs.readFileSync(path.join(repoRoot, "docs/hosts.md"), "utf8");
    expect(hosts).toMatch(/Cursor/);
    expect(hosts).toMatch(/Claude Code/);
    expect(hosts).toMatch(/Codex/);
  });

  it("README.zh-CN exists and points at English authority", () => {
    const body = fs.readFileSync(path.join(repoRoot, "README.zh-CN.md"), "utf8");
    expect(body).toMatch(/README\.md/);
    expect(body).toMatch(/review\.scope|自审/);
  });

  it("config documents confirm_rounds clamp and light-mode=3 only", () => {
    const config = fs.readFileSync(path.join(repoRoot, "docs/config.md"), "utf8");
    expect(config).toMatch(/1\.\.5/);
    expect(config).toMatch(/Only \*\*`3`\*\*/);
  });

  it("config does not imply require_token is enforced", () => {
    const config = fs.readFileSync(path.join(repoRoot, "docs/config.md"), "utf8");
    expect(config).toMatch(/require_token/);
    expect(config).toMatch(/not enforced/i);
  });

  it("config documents triggers, concurrency, and artifacts.files", () => {
    const config = fs.readFileSync(path.join(repoRoot, "docs/config.md"), "utf8");
    expect(config).toMatch(/triggers\.match/);
    expect(config).toMatch(/concurrency\.mode/);
    expect(config).toMatch(/one_executor/);
    expect(config).toMatch(/artifacts\.files\.checklist/);
    expect(config).toMatch(/worktree/);
    // Honest wiring: concurrency / artifacts.files / require_token still not hook-wired
    expect(config).toMatch(/not wired into the hook runtime yet/i);
    expect(config).toMatch(/DEFAULT_TRIGGERS/);
    // plans_dir + triggers.* are loaded by submit/edit (≥1 non-blank phrase)
    expect(config).toMatch(/≥1 non-blank phrase|>=1 non-blank phrase/i);
    expect(config).toMatch(/Hook\*\* invalid[\s\S]*fail-open to `plans\/`/i);
    expect(config).toMatch(/\*\*status\*\* shows `plans: invalid/i);
    expect(config).toMatch(/\*\*doctor\*\* \*\*FAIL\*\*s on invalid/i);
    expect(config).toMatch(/empty\/`\[\]`\/whitespace-only does \*\*not\*\* wipe builtins/i);
    expect(config).toMatch(/YAML `triggers\.match` is not applied/i);
    expect(config).toMatch(/locale set/i);
    expect(config).toMatch(/session list[\s\S]*`session\.stale_after_hours` only/i);
    expect(config).toMatch(
      /Submit hook[\s\S]*\/autopilot-on[\s\S]*DEFAULT_TRIGGERS/i,
    );
    expect(config).toMatch(/skill files only surface|parses typed/i);
    expect(config).toMatch(/no slash for resume_review|separate built-in parser path/i);
    expect(config).toMatch(/armed=1/);
    expect(config).toMatch(/\*\*`status`\*\*[\s\S]*preferred_name/);
    expect(config).toMatch(/\*\*`doctor`\*\*[\s\S]*stale_after_hours/);
    expect(config).toMatch(/Edit hook[\s\S]*review\.scope` \+ `artifacts\.plans_dir/i);
    expect(config).toMatch(/init TUI can offer a custom path/i);
    expect(config).toMatch(/installs Cursor and\/or Claude Code/i);
    expect(config).toMatch(/surface: cli.*shared|hooks shared across terminal/i);
    expect(config).toMatch(/`review\.scope` \| `project` \(fresh init YAML\)/);
    expect(config).toMatch(/Missing \/ invalid[\s\S]*executing_only/i);
  });

  it("quickstarts keep scoped npx Install path", () => {
    const en = fs.readFileSync(
      path.join(repoRoot, "docs/autopilot/quickstart.md"),
      "utf8",
    );
    const zh = fs.readFileSync(
      path.join(repoRoot, "docs/autopilot/quickstart.zh-CN.md"),
      "utf8",
    );
    expect(en).toMatch(/\*\*Install\*\*/);
    expect(en).toContain(`npx ${NPM_PACKAGE_NAME}`);
    expect(en).toContain(`npx ${NPM_PACKAGE_NAME} upgrade --dry-run`);
    expect(en).toContain(`not bare \`npx ${CLI_NAME}\``);
    expect(en).not.toMatch(/Today \(not on public npm yet\)/);
    expect(en).not.toMatch(/After npm publish/);
    expect(zh).toMatch(/\*\*安装\*\*/);
    expect(zh).toContain(`npx ${NPM_PACKAGE_NAME}`);
    expect(zh).toContain(`npx ${NPM_PACKAGE_NAME} upgrade --dry-run`);
    expect(zh).toContain(`裸 \`npx ${CLI_NAME}\``);
    expect(zh).not.toMatch(/今天（尚未上公共 npm）/);
    expect(zh).not.toMatch(/发布到 npm 之后/);
  });

  it("package npm READMEs keep install entrypoints", () => {
    const cliReadme = fs.readFileSync(
      path.join(repoRoot, "packages/cli/README.md"),
      "utf8",
    );
    expect(cliReadme).toContain(`# ${NPM_PACKAGE_NAME}`);
    expect(cliReadme).toContain(`npx ${NPM_PACKAGE_NAME} init`);
    expect(cliReadme).toContain(`npx ${NPM_PACKAGE_NAME} status`);
    expect(cliReadme).toContain(`npx ${NPM_PACKAGE_NAME} doctor`);
    expect(cliReadme).toMatch(/Node\.js 22\+/);
    expect(cliReadme).toMatch(/no bare npm package named `autopilot-harness`/i);
    // Forbid recommending bare `npx autopilot-harness …` as an install command.
    expect(cliReadme).not.toMatch(/(?:^|[^\w`])npx autopilot-harness(?:\s|$)/);

    for (const rel of [
      "packages/core/README.md",
      "packages/i18n/README.md",
      "packages/ports/cursor/README.md",
    ] as const) {
      const pkgDir = path.dirname(path.join(repoRoot, rel));
      const pkg = JSON.parse(
        fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
      ) as { name: string };
      const body = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      expect(body).toContain(`# ${pkg.name}`);
      expect(body).toContain(NPM_PACKAGE_NAME);
      expect(body).toMatch(/MIT/);
      expect(body).not.toMatch(/(?:^|[^\w`])npx autopilot-harness(?:\s|$)/);
    }
  });

  it("README English keeps review.scope section markers", () => {
    const body = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    expect(body).toMatch(/When does self-review run\?/);
    expect(body).toMatch(/review\.scope/);
    expect(body).toMatch(/\*\*`project`\*\* \(default\)/);
    expect(body).toMatch(/executing_only/);
    expect(body).not.toMatch(/\*\*`executing_only`\*\* \(default\)/);
    expect(body).toMatch(/### Install/);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME}`);
    expect(body).toMatch(/host-plan-bridge\.md/);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME} status`);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME} doctor`);
    expect(body).not.toMatch(/Today \(not on public npm yet\)/);
    expect(body).not.toMatch(/After npm publish/);
  });

  it("README.zh-CN keeps review.scope section and npm publish path", () => {
    const body = fs.readFileSync(path.join(repoRoot, "README.zh-CN.md"), "utf8");
    expect(body).toMatch(/何时跑自审/);
    expect(body).toMatch(/review\.scope/);
    expect(body).toMatch(/\*\*`project`\*\*（默认）/);
    expect(body).toMatch(/executing_only/);
    expect(body).not.toMatch(/\*\*`executing_only`\*\*（默认）/);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME}`);
    expect(body).toMatch(/host-plan-bridge\.md/);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME} status`);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME} doctor`);
    expect(body).not.toMatch(/今天（尚未上公共 npm）/);
    expect(body).not.toMatch(/发布到 npm 之后/);
  });

  it("hosts.md marks Codex mitigation as Planned and Claude as shipped", () => {
    const hosts = fs.readFileSync(path.join(repoRoot, "docs/hosts.md"), "utf8");
    expect(hosts).toMatch(/Codex[\s\S]*\*\*Planned\*\*/);
    expect(hosts).toMatch(/Claude Code[\s\S]*\*\*Shipped\*\*/);
    expect(hosts).toMatch(/surface: cli.*CLI-only|hooks are \*\*shared across terminal \+ IDE\*\*/i);
    expect(hosts).toMatch(/CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0/);
    expect(hosts).toMatch(/host-plan-bridge\.md/);
  });

  it("host-plan-bridge design doc exists and stays unimplemented", () => {
    const body = fs.readFileSync(
      path.join(repoRoot, "docs/host-plan-bridge.md"),
      "utf8",
    );
    expect(body).toMatch(/not implemented/i);
    expect(body).toMatch(/arm_planning|suggest/);
    expect(body).toMatch(/DEFAULT_TRIGGERS/);
    expect(body).toMatch(/slash `\/autopilot-on`/);
  });

  it("architecture: dual port + Claude BLOCK_CAP shipped", () => {
    const body = fs.readFileSync(
      path.join(repoRoot, "docs/architecture.md"),
      "utf8",
    );
    expect(body).not.toMatch(/See the v0\.1 plan/);
    expect(body).toMatch(/ReviewEngine/);
    expect(body).toMatch(/hosts\.md/);
    expect(body).toMatch(/host-plan-bridge\.md/);
    expect(body).toMatch(
      /not\*\* loaded by the hook runtime yet|not loaded by the hook runtime yet/i,
    );
    expect(body).toMatch(/on \*\*stop\*\*/);
    expect(body).toMatch(/on \*\*edit\*\*/);
    // Submit loads slash + YAML triggers (order in architecture prose); do not
    // let an earlier "YAML artifacts.plans_dir" alone satisfy the contract.
    expect(body).toMatch(
      /slash `\/autopilot-on`[\s\S]*`triggers\.\*`[\s\S]*DEFAULT_TRIGGERS/,
    );
    expect(body).toMatch(/artifacts\.plans_dir/);
    expect(body).toMatch(/<plansDir>\/<slug>\/checklist\.md/);
    expect(body).not.toMatch(/does \*\*not\*\* yet load this key from YAML/i);
    expect(body).toMatch(
      /Claude Code[\s\S]*Init writes `\.claude\/settings\.json`/,
    );
    expect(body).toMatch(/installs Cursor and\/or Claude Code/i);
    expect(body).toMatch(/ports\/claude-code/);
    expect(body).toMatch(/Cursor and Claude Code/);
    expect(body).toMatch(/npm public/);
    // Forbid recommending bare `npx autopilot-harness …` as an install command.
    // Allow prose that warns against it (e.g. "not bare `npx autopilot-harness`").
    expect(body).not.toMatch(/(?:^|[^\w`])npx autopilot-harness(?:\s|$)/);
  });

  it("CHANGELOG records 0.1.0 / 0.2.0 / 0.2.1 / 0.2.2 / 0.2.3 / 0.2.4 / 0.2.5 / 0.2.6 / 0.2.7 / 0.2.8 / 0.2.9 / 0.2.10 / 0.2.11 / 0.2.12 / 0.2.13 / 0.2.14 and CONTRIBUTING keeps dogfood", () => {
    const log = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
    expect(log).toMatch(/## \[0\.1\.0\]/);
    expect(log).toMatch(/## \[0\.2\.0\]/);
    expect(log).toMatch(/## \[0\.2\.1\]/);
    expect(log).toMatch(/## \[0\.2\.2\]/);
    expect(log).toMatch(/## \[0\.2\.3\]/);
    expect(log).toMatch(/## \[0\.2\.4\]/);
    expect(log).toMatch(/## \[0\.2\.5\]/);
    expect(log).toMatch(/## \[0\.2\.6\]/);
    expect(log).toMatch(/## \[0\.2\.7\]/);
    expect(log).toMatch(/## \[0\.2\.8\]/);
    expect(log).toMatch(/## \[0\.2\.9\]/);
    expect(log).toMatch(/## \[0\.2\.10\]/);
    expect(log).toMatch(/## \[0\.2\.11\]/);
    expect(log).toMatch(/## \[0\.2\.12\]/);
    expect(log).toMatch(/## \[0\.2\.13\]/);
    expect(log).toMatch(/## \[0\.2\.14\]/);
    expect(log).toMatch(
      new RegExp(`## \\[${escapeRegExp(PACKAGE_VERSION)}\\]`),
    );
    expect(log).toMatch(/assets\/templates|bundled templates|Ship skill\/workflow templates/i);
    // 0.2.4 themes must live under that release section (not leftover prose).
    const section024 = changelogSection(log, "0.2.4");
    expect(section024).toMatch(/keywords/i);
    expect(section024).toMatch(/author/i);
    expect(section024).toMatch(/files:\s*\["dist"\]|dist\/assets/i);
    const section025 = changelogSection(log, "0.2.5");
    expect(section025).toMatch(/platforms/i);
    expect(section025).toMatch(/platform|surface/i);
    const section026 = changelogSection(log, "0.2.6");
    expect(section026).toMatch(/verify-last|soft evidence|mid-fix/i);
    expect(section026).toMatch(/recover|updated_at|stale/i);
    const section027 = changelogSection(log, "0.2.7");
    expect(section027).toMatch(/ambient|abort|Stop/i);
    expect(section027).toMatch(/chain_pending|recover|fix_round/i);
    const section028 = changelogSection(log, "0.2.8");
    expect(section028).toMatch(/migrations/i);
    expect(section028).toMatch(/No migration SQL found|npm pack|upgrade|doctor/i);
    const section029 = changelogSection(log, "0.2.9");
    expect(section029).toMatch(/needPick/i);
    expect(section029).toMatch(/channel A/i);
    expect(section029).toMatch(/busy/i);
    expect(section029).toMatch(/channel C/i);
    expect(section029).toMatch(/user_message/i);
    expect(section029).toMatch(/plans bind/i);
    expect(section029).toMatch(/pick-vs-execute/i);
    expect(section029).toMatch(/on-skill-gate/i);
    expect(section029).toMatch(/sqlite|ExperimentalWarning/i);
    const section0210 = changelogSection(log, "0.2.10");
    expect(section0210).toMatch(/on-skill-gate/i);
    expect(section0210).toMatch(/description|discuss|triggers\.on/i);
    expect(section0210).toMatch(/phase=planning|skill body|plans\//i);
    expect(section0210).toMatch(/discussion|Autopilot ON|quickstart/i);
    const section0211 = changelogSection(log, "0.2.11");
    expect(section0211).toMatch(/workspace:\*/i);
    expect(section0211).toMatch(/pnpm publish/i);
    expect(section0211).toMatch(/EUNSUPPORTEDPROTOCOL|uninstallable/i);
    const section0212 = changelogSection(log, "0.2.12");
    expect(section0212).toMatch(/done-on-pending/i);
    expect(section0212).toMatch(/applyOn|pending_followup|terminal/i);
    expect(section0212).toMatch(/全部完成|All checklist/i);
    expect(section0212).toMatch(/pnpm publish|pnpm pack/i);
    const section0213 = changelogSection(log, "0.2.13");
    expect(section0213).toMatch(/shell-dirty-stuck|git-dirty|afterFileEdit/i);
    expect(section0213).toMatch(/need_evidence|max_idle_stops|hard-paus/i);
    expect(section0213).toMatch(/stuck_soft|verify|armed/i);
    expect(section0213).toMatch(/pnpm publish|pnpm pack/i);
    const section0214 = changelogSection(log, "0.2.14");
    expect(section0214).toMatch(/config-wire/i);
    expect(section0214).toMatch(/triggers\./i);
    expect(section0214).toMatch(/plans_dir/i);
    expect(section0214).toMatch(/DEFAULT_TRIGGERS/);
    expect(section0214).toMatch(/review\.scope/);
    expect(section0214).toMatch(/\*\*`project`\*\*/);
    expect(section0214).toMatch(/autopilotignore/i);
    expect(section0214).toMatch(/bilingual/i);
    expect(section0214).toMatch(/typecheck/i);
    expect(section0214).toMatch(/vendor/i);
    expect(section0214).toMatch(/pnpm publish|pnpm pack/i);
    expect(log).toContain(NPM_PACKAGE_NAME);
    // Release compare URL lands with git-tag / gh release — do not pretentag.
    expect(log).not.toMatch(/\[0\.2\.\d+\]:\s*https:\/\/github\.com/);

    const contrib = fs.readFileSync(
      path.join(repoRoot, "CONTRIBUTING.md"),
      "utf8",
    );
    expect(contrib).toMatch(/Dogfood from a clone/);
    expect(contrib).toContain(`npx ${NPM_PACKAGE_NAME}`);
    expect(contrib).toMatch(/node packages\/cli\/dist\/bin\.js/);
  });

  it("PACKAGE_VERSION matches every public package.json version", () => {
    for (const rel of PUBLIC_PACKAGE_JSON_PATHS) {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, rel), "utf8"),
      ) as { version?: string };
      expect(pkg.version, rel).toBe(PACKAGE_VERSION);
    }
  });
});
