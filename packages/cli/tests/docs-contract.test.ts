import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeQuickstart } from "../src/init/wizard-helpers.js";
import { PACKAGE_VERSION } from "../src/init/types.js";
import { CLI_NAME, NPM_PACKAGE_NAME } from "../src/names.js";
import os from "node:os";
import { PUBLIC_PACKAGE_JSON_PATHS } from "./public-npm-packages.js";

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
    expect(tips).toMatch(/\.codex\/hooks\.json/);
    expect(tips).toMatch(/\/hooks/);
    expect(tips).toMatch(/timeout/i);
    expect(tips).toMatch(/### Kimi Code/);
    expect(tips).toMatch(/Stop≤1\/turn|≤1\/turn/);
    expect(tips).toMatch(/~\/\.kimi-code|KIMI_CODE_HOME/);
    expect(tips).toMatch(/project-wide|whole project/i);
    expect(tips).toMatch(
      /Cursor \/ Claude \/ Codex \/ Copilot|including Cursor \/ Claude \/ Codex \/ Copilot/i,
    );
    expect(tips).toMatch(/machine-wide|user-home/i);
    expect(tips).toMatch(/never[\s\S]*local\.toml|local\.toml/i);
    expect(tips).toMatch(/symlink/i);
    expect(tips).toMatch(/cwd-relative|project root/i);
    expect(tips).toMatch(/projects you trust|trusted/i);
    expect(tips).toMatch(/### GitHub Copilot CLI/);
    expect(tips).toMatch(/Stop consecutive ≤8/);
    expect(tips).toMatch(/Restart Copilot CLI/i);
    expect(tips).toMatch(/Claude Code \+ Copilot CLI|Claude\+Copilot|dual/i);
    expect(tips).toMatch(/leftover hooks on disk|both enabled or leftover/i);
    expect(tips).toMatch(
      /\*\*FAIL\*\*s when[\s\S]*\.github\/hooks\/autopilot-harness\.json|FAIL[\s\S]*missing[\s\S]*incomplete/i,
    );
    expect(tips).toMatch(/pending|RESUME|nudge/i);
    expect(tips).toMatch(/userPromptSubmitted/);
    expect(tips).toMatch(/Does \*\*not\*\* wire `preToolUse`|no `preToolUse`|不接 `preToolUse`/i);
    expect(tips).toMatch(/\.github\/hooks/);
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
    expect(config).toMatch(/Kimi Code[\s\S]*confirm_rounds:\s*1|prefer `confirm_rounds: 1`/i);
    expect(config).toMatch(/clamps[\s\S]*1|clamp[\s\S]*1/i);
    expect(config).toMatch(/do \*\*not\*\* expect confirm×5|do not expect confirm×5/i);
    expect(config).toMatch(/project-wide|whole project/i);
    expect(config).toMatch(
      /installs Cursor, Claude Code, Codex, Kimi Code, and\/or Copilot CLI/i,
    );
    expect(config).toMatch(/five-way dispatch/i);
    expect(config).not.toMatch(/\bquaternary dispatch\b/);
    expect(config).not.toMatch(/\bternary dispatch\b/);
    expect(config).toMatch(
      /Cursor \+ Claude Code \+ Codex \+ Kimi Code \+ Copilot CLI build/,
    );
    expect(config).toMatch(/Kimi Code user-home `config\.toml`|Stop≤1\/turn WARN/);
    expect(config).toMatch(/Stop consecutive ≤8|Copilot.*≤8/i);
    expect(config).toMatch(/Codex \/ Kimi Code \/ Copilot CLI P0|Copilot CLI P0/);
    expect(config).toMatch(/does \*\*not\*\* clamp `confirm_rounds`|does not clamp confirm_rounds/i);
    expect(config).toMatch(
      /missing\/incomplete \*\*FAIL\*\*|Copilot[\s\S]*FAIL[\s\S]*WARN/i,
    );
    expect(config).toMatch(
      /dual WARN[\s\S]*leftover|leftover hooks on disk|both enabled \*\*or\*\* leftover|dual = both enabled \*\*or\*\* leftover/i,
    );
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
    expect(config).toMatch(
      /installs Cursor, Claude Code, Codex, Kimi Code, and\/or Copilot CLI/i,
    );
    expect(config).toMatch(/surface: cli.*shared|hooks shared across terminal/i);
    expect(config).toMatch(/\.codex\/\*\*/);
    expect(config).toMatch(/\.github\/hooks\/\*\*/);
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
    for (const body of [en, zh]) {
      expect(body).toMatch(/--platform kimi-code|platform kimi-code/);
      expect(body).toMatch(/Stop≤1\/turn|≤1\/turn/);
      expect(body).toMatch(/--add-platform kimi-code/);
      expect(body).toMatch(/--platform copilot-cli|platform copilot-cli/);
      expect(body).toMatch(/Stop consecutive ≤8/);
      expect(body).toMatch(/--add-platform copilot-cli/);
      expect(body).toMatch(
        /Restart Copilot CLI|重启 Copilot CLI|重启 CLI|restart the CLI/i,
      );
      expect(body).toMatch(/no `preToolUse`|不接 `preToolUse`/i);
    }
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
    expect(cliReadme).toMatch(/Cursor, Claude Code, Codex, Kimi Code, and GitHub Copilot CLI|Cursor, Claude Code, Codex, Kimi Code, and Copilot CLI/);
    expect(cliReadme).not.toMatch(/v0\.2 ships Cursor and Claude Code/);
    expect(cliReadme).toMatch(/--platform codex|platform codex/);
    expect(cliReadme).toMatch(/kimi-code/);
    expect(cliReadme).toMatch(/copilot-cli/);
    expect(cliReadme).toMatch(/Stop≤1\/turn|degraded Stop/i);
    expect(cliReadme).toMatch(/Stop consecutive ≤8/);
    expect(cliReadme).toMatch(/Restart Copilot CLI/i);
    expect(cliReadme).toMatch(/triggers\.on/);
    expect(cliReadme).toMatch(/triggers\.run/);
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
    // Codex has no Autopilot skills — install flow must not imply slash-only ON/RUN.
    expect(body).toMatch(/Codex:[\s\S]*triggers\.on/);
    expect(body).toMatch(/Codex:[\s\S]*triggers\.run/);
    expect(body).toMatch(/--platform kimi-code|init --platform kimi-code/);
    expect(body).toMatch(/port-kimi-code/);
    expect(body).toMatch(/--platform copilot-cli|init --platform copilot-cli/);
    expect(body).toMatch(/port-copilot-cli/);
    expect(body).toMatch(/### Install/);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME}`);
    expect(body).toMatch(/host-plan-bridge\.md/);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME} status`);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME} doctor`);
    expect(body).not.toMatch(/Today \(not on public npm yet\)/);
    expect(body).not.toMatch(/After npm publish/);
    expect(body).toMatch(
      /Kimi Code[\s\S]*degraded[\s\S]*≤1\s*\/\s*turn|degraded Stop ≤1\/turn/i,
    );
    expect(body).toMatch(
      /Kimi Code[\s\S]*confirm_rounds:\s*1|confirm_rounds:\s*1[\s\S]*Kimi/i,
    );
    expect(body).toMatch(/do not expect confirm×5|clamps to `1`/i);
    expect(body).toMatch(/whole project|for the whole project/i);
    expect(body).toMatch(
      /Copilot CLI[\s\S]*degraded[\s\S]*≤8|Stop consecutive ≤8/i,
    );
    expect(body).toMatch(/Restart Copilot CLI|restart.*Copilot CLI/i);
    expect(body).toMatch(/pending|RESUME|nudge/i);
    expect(body).toMatch(/userPromptSubmitted/);
    expect(body).toMatch(/no `preToolUse`/i);
  });

  it("README.zh-CN keeps review.scope section and npm publish path", () => {
    const body = fs.readFileSync(path.join(repoRoot, "README.zh-CN.md"), "utf8");
    expect(body).toMatch(/何时跑自审/);
    expect(body).toMatch(/review\.scope/);
    expect(body).toMatch(/\*\*`project`\*\*（默认）/);
    expect(body).toMatch(/executing_only/);
    expect(body).not.toMatch(/\*\*`executing_only`\*\*（默认）/);
    expect(body).toMatch(/Codex：[\s\S]*triggers\.on/);
    expect(body).toMatch(/Codex：[\s\S]*triggers\.run/);
    expect(body).toMatch(/--platform kimi-code|init --platform kimi-code/);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME}`);
    expect(body).toMatch(/host-plan-bridge\.md/);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME} status`);
    expect(body).toContain(`npx ${NPM_PACKAGE_NAME} doctor`);
    expect(body).not.toMatch(/今天（尚未上公共 npm）/);
    expect(body).not.toMatch(/发布到 npm 之后/);
    expect(body).toMatch(
      /Kimi Code[\s\S]*降级[\s\S]*≤1|Stop≤1\/turn 降级/,
    );
    expect(body).toMatch(
      /Kimi Code[\s\S]*confirm_rounds:\s*1|confirm_rounds:\s*1[\s\S]*Kimi/i,
    );
    expect(body).toMatch(/不要指望 confirm×5|钳到 `1`/);
    expect(body).toMatch(/整个项目/);
    expect(body).toMatch(/--platform copilot-cli|init --platform copilot-cli/);
    expect(body).toMatch(/Stop consecutive ≤8|≤8 降级/);
    expect(body).toMatch(/重启 Copilot CLI|Restart Copilot CLI/);
    expect(body).toMatch(/userPromptSubmitted/);
    expect(body).toMatch(/不接 `preToolUse`|no `preToolUse`/i);
    expect(body).toMatch(/Copilot Stop≤8|Stop≤8 \/ 重启|双装/);
  });

  it("hosts.md marks Codex, Claude, Kimi, and Copilot as shipped", () => {
    const hosts = fs.readFileSync(path.join(repoRoot, "docs/hosts.md"), "utf8");
    expect(hosts).toMatch(/\|\s*\*\*Codex\*\*\s*\|\s*\*\*Shipped\*\*/);
    expect(hosts).toMatch(/\|\s*\*\*Claude Code\*\*\s*\|\s*\*\*Shipped\*\*/);
    expect(hosts).toMatch(/\|\s*\*\*Kimi Code\*\*\s*\|\s*\*\*Shipped\*\*/);
    expect(hosts).toMatch(
      /\|\s*\*\*GitHub Copilot CLI\*\*\s*\|\s*\*\*Shipped\*\*/,
    );
    expect(hosts).not.toMatch(/\|\s*\*\*Codex\*\*\s*\|\s*\*\*v0\.3 \/ v0\.4 planned\*\*/);
    // Status column only (avoid Notes-column false positives/negatives).
    expect(hosts).not.toMatch(/\|\s*\*\*Codex\*\*\s*\|\s*\*\*Planned\*\*/);
    expect(hosts).not.toMatch(/\|\s*\*\*Kimi Code\*\*\s*\|\s*\*\*Next\*\*/);
    expect(hosts).not.toMatch(
      /\|\s*\*\*GitHub Copilot CLI\*\*\s*\|\s*\*\*Next\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*GitHub Copilot CLI\*\*/,
    );
    expect(hosts).toMatch(/handleCodexUserPromptSubmit/);
    expect(hosts).toMatch(/handleCodexPostToolUse/);
    expect(hosts).toMatch(/handleCodexStop/);
    expect(hosts).toMatch(/handleKimiUserPromptSubmit|handleKimi\*/);
    expect(hosts).toMatch(/handleKimiPostToolUse|handleKimiStop/);
    expect(hosts).toMatch(/handleCopilotUserPromptSubmit|handleCopilot\*/);
    expect(hosts).toMatch(/handleCopilotPostToolUse|handleCopilotStop/);
    expect(hosts).toMatch(/apply_patch/);
    expect(hosts).toMatch(/\/hooks/);
    expect(hosts).toMatch(/triggers\.on/);
    expect(hosts).toMatch(/triggers\.run/);
    expect(hosts).toMatch(/omit timeout|≥120s|&lt;120s/i);
    expect(hosts).toMatch(/surface: cli.*CLI-only|hooks are \*\*shared across terminal \+ IDE\*\*/i);
    expect(hosts).toMatch(/CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0/);
    expect(hosts).toMatch(/host-plan-bridge\.md/);
    expect(hosts).toMatch(/## Roadmap \(not shipped\)/);
    expect(hosts).toMatch(/GitHub Copilot CLI/);
    expect(hosts).toMatch(/five-way/);
    expect(hosts).not.toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*Kimi Code\*\*/,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*Grok Build CLI\*\*/,
    );
    expect(hosts).toMatch(/Kimi Code \| \*\*Shipped\*\* \(degraded Stop≤1\/turn\)/);
    expect(hosts).toMatch(
      /GitHub Copilot CLI \| \*\*Shipped\*\* \(degraded Stop consecutive ≤8\)/,
    );
    expect(hosts).toMatch(/Grok Build CLI/);
    expect(hosts).toMatch(/Gemini CLI/);
    expect(hosts).toMatch(/Factory Droid/);
    expect(hosts).toMatch(/Hermes Agent/);
    expect(hosts).toMatch(/Antigravity/);
    expect(hosts).toMatch(/OpenCode/);
    expect(hosts).toMatch(/\bPi\b/);
    expect(hosts).toMatch(/Devin CLI/);
    expect(hosts).toMatch(/Codex CLI and Codex App/);
    expect(hosts).toMatch(
      /roadmap markers only[\s\S]*init[\s\S]*do \*\*not\*\* install them yet/i,
    );
    expect(hosts).toMatch(/Stop-continue hard-capped at 1|≤1 continue \/ turn|Stop continue ≤1|Stop≤1\/turn/i);
    expect(hosts).toMatch(/Stop consecutive ≤8|consecutive ≤8/);
    expect(hosts).toMatch(/confirm_rounds:\s*1|confirm_rounds: 1/);
    expect(hosts).toMatch(/~\/\.kimi-code/);
    expect(hosts).toMatch(/legacy kimi-cli/);
    expect(hosts).toMatch(/~\/\.kimi\//);
    expect(hosts).toMatch(/degraded hook port/i);
    expect(hosts).toMatch(/clamps `review\.confirm_rounds` to 1 for the whole project|project-wide/i);
    expect(hosts).toMatch(/Does \*\*not\*\* clamp `confirm_rounds`|does \*\*not\*\* clamp rounds/i);
    expect(hosts).toMatch(/user-home.*config\.toml|config\.toml.*user-home/i);
    expect(hosts).toMatch(/never[\s\S]*local\.toml|local\.toml/);
    expect(hosts).toMatch(/symlink|projects you trust/i);
    expect(hosts).toMatch(/\.github\/hooks\/autopilot-harness\.json/);
    expect(hosts).toMatch(/Restart Copilot CLI/i);
    expect(hosts).toMatch(/pending followup|RESUME|nudge/i);
    expect(hosts).toMatch(/userPromptSubmitted/);
    expect(hosts).toMatch(/\*\*no\*\* `preToolUse`|no `preToolUse`/i);
    expect(hosts).toMatch(
      /dual fingerprints \(both enabled or leftover|leftover hooks on disk/i,
    );
    expect(hosts).toMatch(
      /Future hosts with only a \*\*hard-capped\*\* stop-continue|hard-capped[\s\S]*degraded hook port/i,
    );
    expect(hosts).toMatch(
      /UserPromptSubmit` \/ `userPromptSubmitted|userPromptSubmitted[\s\S]*loop_limit/i,
    );
    expect(hosts).toMatch(
      /when possible[\s\S]*hard-caps[\s\S]*keep the stop streak short[\s\S]*confirm_rounds:\s*1/i,
    );
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
    expect(body).toMatch(
      /installs Cursor, Claude Code, Codex, Kimi Code, and\/or Copilot CLI/i,
    );
    expect(body).toMatch(/ports\/claude-code/);
    expect(body).toMatch(/ports\/codex/);
    expect(body).toMatch(/ports\/kimi-code/);
    expect(body).toMatch(/ports\/copilot-cli/);
    expect(body).toMatch(
      /Cursor, Claude Code, Codex, Kimi Code, and Copilot CLI/,
    );
    expect(body).toMatch(/handleCodex\*/);
    expect(body).toMatch(/handleKimi\*/);
    expect(body).toMatch(/handleCopilot\*/);
    expect(body).toMatch(/never `local\.toml`|never local\.toml/i);
    expect(body).toMatch(/triggers\.on\s*\/\s*`?triggers\.run|triggers\.on`\s*\/\s*`triggers\.run/);
    expect(body).toMatch(/npm public/);
    // Forbid recommending bare `npx autopilot-harness …` as an install command.
    // Allow prose that warns against it (e.g. "not bare `npx autopilot-harness`").
    expect(body).not.toMatch(/(?:^|[^\w`])npx autopilot-harness(?:\s|$)/);
    expect(body).toMatch(/Kimi Code[\s\S]*≤1 continuation \/ turn|Kimi Code[\s\S]*≤1 continue \/ turn|Stop≤1\/turn/i);
    expect(body).toMatch(/degraded[\s\S]*confirm_rounds:\s*1|confirm_rounds:\s*1[\s\S]*degraded/i);
    expect(body).toMatch(/Copilot CLI[\s\S]*≤8|consecutive ≤8|Stop consecutive ≤8/i);
    expect(body).toMatch(/userPromptSubmitted/);
    expect(body).toMatch(/[Nn]o `preToolUse`/);
    expect(body).toMatch(/pending|RESUME|nudge/i);
    expect(body).toMatch(/Restart Copilot CLI/i);
    expect(body).toMatch(
      /UserPromptSubmit` \/ `userPromptSubmitted|userPromptSubmitted[\s\S]*loop_limit/i,
    );
    expect(body).toMatch(/enabled or leftover|leftover/i);
    expect(body).toMatch(
      /when possible[\s\S]*hard-caps[\s\S]*keep the stop streak short/i,
    );
  });

  it("CHANGELOG records 0.1.0 / 0.2.0 / 0.2.1 / 0.2.2 / 0.2.3 / 0.2.4 / 0.2.5 / 0.2.6 / 0.2.7 / 0.2.8 / 0.2.9 / 0.2.10 / 0.2.11 / 0.2.12 / 0.2.13 / 0.2.14 / 0.2.15 / 0.3.0 / 0.4.0 / 0.4.1 / 0.5.0 and CONTRIBUTING keeps dogfood", () => {
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
    expect(log).toMatch(/## \[0\.2\.15\]/);
    expect(log).toMatch(/## \[0\.3\.0\]/);
    expect(log).toMatch(/## \[0\.4\.0\]/);
    expect(log).toMatch(/## \[0\.4\.1\]/);
    expect(log).toMatch(/## \[0\.5\.0\]/);
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
    const section0215 = changelogSection(log, "0.2.15");
    expect(section0215).toMatch(/planning-global-qn/i);
    expect(section0215).toMatch(/globally across rounds|global Qn/i);
    expect(section0215).toMatch(/do not restart at Q1|Round k/i);
    expect(section0215).toMatch(/README|zh-CN/i);
    expect(section0215).toMatch(/pnpm publish|pnpm pack/i);
    const section030 = changelogSection(log, "0.3.0");
    expect(section030).toMatch(/port-codex|@autopilot-harness\/port-codex/i);
    expect(section030).toMatch(/handleCodexUserPromptSubmit/);
    expect(section030).toMatch(/handleCodexPostToolUse/);
    expect(section030).toMatch(/handleCodexStop/);
    expect(section030).toMatch(/docs-codex-shipped/i);
    expect(section030).toMatch(/marked \*\*Shipped\*\*/);
    expect(section030).toMatch(/packages\/ports\/codex\/package\.json/);
    expect(section030).toMatch(/\.codex\/hooks\.json/);
    expect(section030).toMatch(/triggers\.on/);
    expect(section030).toMatch(/triggers\.run/);
    expect(section030).toMatch(/core\s*→\s*i18n\s*→\s*ports[\s\S]*→\s*cli/i);
    expect(section030).toMatch(/pnpm publish|pnpm pack/i);
    const section040 = changelogSection(log, "0.4.0");
    expect(section040).toMatch(/port-kimi-code|@autopilot-harness\/port-kimi-code/i);
    expect(section040).toMatch(/handleKimiUserPromptSubmit/);
    expect(section040).toMatch(/handleKimiPostToolUse/);
    expect(section040).toMatch(/handleKimiStop/);
    expect(section040).toMatch(/exit 2|exit2/i);
    expect(section040).toMatch(/docs-kimi-shipped/i);
    expect(section040).toMatch(/marked \*\*Shipped\*\*/);
    expect(section040).toMatch(/packages\/ports\/kimi-code\/package\.json/);
    expect(section040).toMatch(/Stop-continue hard-capped at 1\/turn|Stop≤1\/turn/);
    expect(section040).toMatch(/degraded[\s\S]*confirm_rounds:\s*1|confirm_rounds:\s*1/);
    expect(section040).toMatch(/~\/\.kimi-code/);
    expect(section040).not.toMatch(/Coming v0\.4/);
    expect(section040).toMatch(/kimi-code/);
    expect(section040).toMatch(
      /core\s*→\s*i18n\s*→\s*ports[\s\S]*kimi-code[\s\S]*→\s*cli|ports \(cursor, claude-code, codex, kimi-code\)/i,
    );
    expect(section040).toMatch(/pnpm publish|pnpm pack/i);
    const section041 = changelogSection(log, "0.4.1");
    expect(section041).toMatch(/autopilot-on/);
    expect(section041).toMatch(/description/i);
    expect(section041).toMatch(/skill body/i);
    expect(section041).toMatch(/Start planning|开启规划/);
    expect(section041).toMatch(/upgrade|locale set/i);
    const section050 = changelogSection(log, "0.5.0");
    expect(section050).toMatch(/port-copilot-cli|@autopilot-harness\/port-copilot-cli/i);
    expect(section050).toMatch(/handleCopilotUserPromptSubmit/);
    expect(section050).toMatch(/handleCopilotUserPromptTransformed/);
    expect(section050).toMatch(/handleCopilotPostToolUse/);
    expect(section050).toMatch(/handleCopilotStop/);
    expect(section050).toMatch(/docs-copilot-shipped/i);
    expect(section050).toMatch(/marked \*\*Shipped\*\*/);
    expect(section050).toMatch(/packages\/ports\/copilot-cli\/package\.json/);
    expect(section050).toMatch(/Stop consecutive ≤8/);
    expect(section050).toMatch(/pending|RESUME|nudge/i);
    expect(section050).toMatch(/Restart Copilot CLI/i);
    expect(section050).toMatch(/Claude\+Copilot dual/i);
    // Lock severity markers (avoid /FAIL/i matching "fail-open").
    expect(section050).toMatch(
      /\*\*FAIL\*\*s? on missing\/incomplete/,
    );
    expect(section050).toMatch(
      /\*\*WARN\*\*[\s\S]{0,80}Claude\+Copilot dual/,
    );
    expect(section050).toMatch(
      /does \*\*not\*\* clamp `confirm_rounds`[\s\S]{0,100}Kimi enablement still clamps project-wide/,
    );
    expect(section050).toMatch(/no `?preToolUse`?|explicitly \*\*no preToolUse\*\*/i);
    expect(section050).toMatch(/\.github\/hooks/);
    expect(section050).toMatch(/five-way|Five-way/i);
    expect(section050).toMatch(/copilot-cli/);
    expect(section050).toMatch(
      /core\s*→\s*i18n\s*→\s*ports[\s\S]*copilot-cli[\s\S]*→\s*cli|ports \(cursor, claude-code, codex, kimi-code, copilot-cli\)/i,
    );
    expect(section050).toMatch(/pnpm publish|pnpm pack/i);
    expect(section050).toMatch(/1 \(next\)[\s\S]{0,80}Grok Build/);
    const unreleased = changelogSection(log, "Unreleased");
    expect(unreleased).not.toMatch(/docs-copilot-shipped/i);
    expect(unreleased).not.toMatch(/handleCopilot/i);
    expect(unreleased).not.toMatch(/docs-kimi-shipped/i);
    expect(unreleased).not.toMatch(/Coming v0\.4/);
    expect(unreleased).not.toMatch(/autopilot-on[\s\S]*description/i);
    expect(log).toContain(NPM_PACKAGE_NAME);
    // Release compare URL lands with git-tag / gh release — do not pretentag
    // current or 0.2.x lines (0.1.0 footer link is historical).
    expect(log).not.toMatch(/\[0\.2\.\d+\]:\s*https:\/\/github\.com/);
    expect(log).not.toMatch(
      new RegExp(
        `\\[${escapeRegExp(PACKAGE_VERSION)}\\]:\\s*https:\\/\\/github\\.com`,
      ),
    );

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
      ) as { version?: string; description?: string };
      expect(pkg.version, rel).toBe(PACKAGE_VERSION);
    }
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { version?: string; description?: string; private?: boolean };
    expect(rootPkg.private).toBe(true);
    expect(rootPkg.version).toBe(PACKAGE_VERSION);
    expect(rootPkg.description).toMatch(
      /Cursor, Claude Code, Codex, Kimi Code, and Copilot CLI/,
    );
    const cliPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "packages/cli/package.json"), "utf8"),
    ) as { description?: string; keywords?: string[] };
    expect(cliPkg.description).toMatch(
      /Cursor, Claude Code, Codex, Kimi Code, and Copilot CLI/,
    );
    expect(cliPkg.keywords).toEqual(
      expect.arrayContaining([
        "cursor",
        "claude-code",
        "codex",
        "kimi-code",
        "copilot-cli",
      ]),
    );
    const kimiPkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages/ports/kimi-code/package.json"),
        "utf8",
      ),
    ) as { description?: string; private?: boolean };
    expect(kimiPkg.private).not.toBe(true);
    expect(kimiPkg.description).toMatch(/Kimi Code|degraded Stop/i);
    expect(kimiPkg.description).not.toMatch(/Coming v0\.3\b/);
    expect(kimiPkg.description).not.toMatch(/Coming v0\.4/);
    const copilotPkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages/ports/copilot-cli/package.json"),
        "utf8",
      ),
    ) as { description?: string; private?: boolean };
    expect(copilotPkg.private).not.toBe(true);
    expect(copilotPkg.description).toMatch(/Copilot CLI/i);
    expect(copilotPkg.description).toMatch(/degraded Stop/i);
    expect(copilotPkg.description).not.toMatch(/Coming v0\.5\b/);
    const runnerPkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages/ports/runner/package.json"),
        "utf8",
      ),
    ) as { description?: string };
    expect(runnerPkg.description).not.toMatch(/Coming v0\.4/);
  });
});
