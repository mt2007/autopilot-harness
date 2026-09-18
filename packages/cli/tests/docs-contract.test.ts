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
      /Cursor \/ Claude \/ Codex \/ Copilot \/ Grok \/ Gemini \/ Factory \/ Hermes \/ Antigravity|including Cursor \/ Claude \/ Codex \/ Copilot \/ Grok \/ Gemini \/ Factory \/ Hermes \/ Antigravity/i,
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
    expect(tips).toMatch(/### Grok Build CLI/);
    expect(tips).toMatch(/Stop ≤8\/turn|≤8\/turn/);
    expect(tips).toMatch(/per-turn reset|resets each user turn/i);
    expect(tips).toMatch(/hooks-trust|--trust/);
    expect(tips).toMatch(/Grok\+Claude|Grok\+Cursor|multi-fingerprint/i);
    expect(tips).toMatch(
      /Grok[\s\S]{0,120}both enabled or leftover|multi-fingerprints \(both enabled or leftover/i,
    );
    expect(tips).toMatch(/\.grok\/hooks\/autopilot-harness\.json/);
    expect(tips).toMatch(/compat\.\*\.hooks|compat\.hooks/i);
    expect(tips).toMatch(/re-submit with slug|重提 slug/i);
    expect(tips).toMatch(/no PreToolUse|不接 PreToolUse|Does \*\*not\*\* wire PreToolUse/i);
    expect(tips).toMatch(/### Gemini CLI/);
    expect(tips).toMatch(/MAX_TURNS|AfterAgent turn cap ≤100|≤100/);
    expect(tips).toMatch(/0\.31\.0/);
    expect(tips).toMatch(/re-trust|\/hooks panel|folder trust/);
    expect(tips).toMatch(/GEMINI_PLANS_DIR/);
    expect(tips).toMatch(/hooksConfig/);
    expect(tips).toMatch(/\.gemini\/settings\.json/);
    expect(tips).toMatch(/decision:"deny"|deny\+reason/);
    expect(tips).toMatch(/Gemini\+Claude|Gemini CLI \+ Claude/i);
    expect(tips).toMatch(
      /Gemini\+Claude[\s\S]{0,120}(both enabled or leftover|leftover on disk)|Gemini CLI \+ Claude[\s\S]{0,120}(both enabled or leftover|leftover)/i,
    );
    expect(tips).toMatch(
      /\*\*FAIL\*\*s when[\s\S]*\.gemini\/settings\.json|FAIL[\s\S]*missing[\s\S]*incomplete/i,
    );
    expect(tips).toMatch(/### Factory Droid/);
    expect(tips).toMatch(/FACTORY_PROJECT_DIR/);
    expect(tips).toMatch(/multi-block|stop_hook_active/);
    expect(tips).toMatch(/live-proved|waive[\s\S]*degraded/i);
    expect(tips).toMatch(/\.factory\/hooks\.json/);
    expect(tips).toMatch(/Factory\+Claude|Factory Droid \+ Claude/i);
    expect(tips).toMatch(/snapshot|Reload Factory|\/hooks/);
    expect(tips).toMatch(/symlink|fail-closed/i);
    expect(tips).toMatch(
      /instrumented project root|trusted[\s\S]*FACTORY_PROJECT_DIR|FACTORY_PROJECT_DIR[\s\S]*trusted|wrong or hostile/i,
    );
    expect(tips).toMatch(/hooksDisabled|allowManagedHooksOnly/);
    expect(tips).toMatch(/### Hermes Agent/);
    expect(tips).toMatch(/HERMES_HOME/);
    expect(tips).toMatch(/pre_verify|max_verify_nudges|0\.21\.3/);
    expect(tips).toMatch(/relative command|相对/);
    expect(tips).toMatch(/accept-hooks|HERMES_ACCEPT_HOOKS|consent/i);
    expect(tips).toMatch(/hermes hooks doctor/i);
    expect(tips).toMatch(
      /### Hermes Agent[\s\S]*?timeout omit\/&lt;120 \(host default 60s\)/i,
    );
    expect(tips).toMatch(
      /### Hermes Agent[\s\S]*?(?:not\*\* Codex-style|not Codex-style)[\s\S]{0,40}omit/i,
    );
    expect(tips).toMatch(
      /### Hermes Agent[\s\S]*?(?:nudge missing\/still \*\*3\*\*\/&lt;32|nudge missing\/still 3\/&lt;32)/i,
    );
    expect(tips).toMatch(
      /### Hermes Agent[\s\S]*?(?:waive[\s\S]{0,80}degraded|R1 unproven|acknowledge R1)/i,
    );
    expect(tips).toMatch(/Hermes\+Claude|Hermes Agent \+ Claude/i);
    expect(tips).toMatch(/edit-only|changed_paths/i);
    expect(tips).toMatch(
      /### Hermes Agent[\s\S]*?(?:nudge[\s\S]{0,160}pending|exhausted[\s\S]{0,100}pending|plugin-first[\s\S]{0,100}pending)/i,
    );
    expect(tips).toMatch(
      /### Hermes Agent[\s\S]*?(?:machine-wide|shared across projects|Treat `\$HERMES_HOME` as a \*\*trusted\*\*)/i,
    );
    expect(tips).toMatch(
      /### Hermes Agent[\s\S]*Allow \/ hard-stop = \*\*`\{\}`\*\*/i,
    );
    expect(tips).toMatch(
      /including Cursor \/ Claude \/ Codex \/ Copilot \/ Grok \/ Gemini \/ Factory \/ Hermes \/ Antigravity \/ Runner/i,
    );
    expect(tips).toMatch(/### Antigravity/);
    expect(tips).toMatch(/decision:"continue"|decision:continue/);
    expect(tips).toMatch(/fullyIdle/);
    expect(tips).toMatch(/\.agents\/hooks\.json/);
    expect(tips).toMatch(/\.agents\/bin|import\.meta\.url|shim/i);
    expect(tips).toMatch(/transcriptPath|PreInvocation/);
    expect(tips).toMatch(/--add-dir|CLI workspace|loaded 0/i);
    expect(tips).toMatch(/auto-attach|Auto-attach/);
    expect(tips).toMatch(/live-proved|0\.10\.1|shim|--add-dir/i);
    expect(tips).toMatch(/### Runner/);
    expect(tips).toMatch(/runner\.command/);
    // Trust callout must sit on Runner (not only elsewhere in the file).
    expect(tips).toMatch(
      /runner\.command[\s\S]{0,400}trusted project config|command \+ `runner\.env` as \*\*trusted project config\*\*/i,
    );
    expect(tips).toMatch(
      /runner\.command[\s\S]{0,450}shell:\s*false|shell: false[\s\S]{0,120}runner\.command/i,
    );
    // Live-learned: {prompt_file} is a path; paused peer session can make --run "not runnable".
    expect(tips).toMatch(
      /\{prompt_file\}[\s\S]{0,120}file path|prompt_file[\s\S]{0,80}path/i,
    );
    expect(tips).toMatch(
      /not runnable \(paused\)|paused[\s\S]{0,80}non-runnable|session purge/i,
    );
    expect(tips).toMatch(/one_executor/);
    expect(tips).toMatch(/--on[\s\S]{0,80}deferred|deferred[\s\S]{0,40}--on/i);
    expect(tips).toMatch(/doctor[\s\S]{0,40}\*\*WARN\*\*|doctor \*\*WARN\*\*/i);
    expect(tips).toMatch(
      /Bare `runner start`[\s\S]{0,120}FAIL|nothing to resume[\s\S]{0,80}FAIL|no pending\/executing[\s\S]{0,80}FAIL/i,
    );
    expect(tips).toMatch(
      /Paused[\s\S]{0,160}FAIL|paused[\s\S]{0,80}start \*\*FAIL\*\*/i,
    );
    expect(tips).toMatch(
      /Paused[\s\S]{0,200}`--run`|paused[\s\S]{0,120}bare or `--run`|FAIL\*\*s \(bare \*\*and\*\* `--run`\)/i,
    );
    expect(tips).toMatch(
      /Paused[\s\S]{0,220}before[\s\S]{0,40}needPick|paused[\s\S]{0,80}before[\s\S]{0,40}needPick|exit \*\*1\*\*, not exit \*\*2\*\*/i,
    );
    expect(tips).toMatch(
      /runner\.cwd[\s\S]{0,200}FAIL|Bad \*\*`runner\.cwd`\*\*|max_iterations[\s\S]{0,80}&lt;1|max_iterations[\s\S]{0,80}<1/i,
    );
    expect(tips).toMatch(
      /max_iterations[\s\S]{0,120}&lt;8|declared value is \*\*&lt;8\*\*|declared `max_iterations` is \*\*&lt;8\*\*/i,
    );
    expect(tips).toMatch(
      /needPick[\s\S]{0,80}exit 2|exit 2[\s\S]{0,40}needPick/i,
    );
    expect(tips).toMatch(
      /several[\s\S]{0,40}runnable|when \*\*several\*\* tracks/i,
    );
    expect(tips).toMatch(
      /armed=0[\s\S]{0,80}one_executor|does \*\*not\*\* hold[\s\S]{0,40}one_executor/i,
    );
    expect(tips).toMatch(
      /busy[\s\S]{0,60}exit \*\*1\*\*|busy[\s\S]{0,60}exit 1|already-executing[\s\S]{0,40}exit 1/i,
    );
    expect(tips).toMatch(
      /before[\s\S]{0,40}store[\s\S]{0,80}state\.db|do \*\*not\*\* create an empty `state\.db`/i,
    );
    expect(tips).not.toMatch(/doctor WARN\/FAIL/);
    expect(tips).not.toMatch(/eleventh hook|eleven-way/i);
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
      /installs Cursor, Claude Code, Codex, Kimi Code, Copilot CLI, Grok Build CLI, Gemini CLI, Factory Droid, Hermes Agent, and\/or Antigravity/i,
    );
    expect(config).toMatch(/ten-way dispatch/i);
    expect(config).not.toMatch(/\bnine-way dispatch\b/i);
    expect(config).not.toMatch(/\beight-way dispatch\b/i);
    expect(config).not.toMatch(/\bseven-way dispatch\b/i);
    expect(config).not.toMatch(/\bsix-way dispatch\b/i);
    expect(config).not.toMatch(/\bfive-way dispatch\b/i);
    expect(config).not.toMatch(/\bquaternary dispatch\b/);
    expect(config).not.toMatch(/\bternary dispatch\b/);
    expect(config).toMatch(
      /Cursor \+ Claude Code \+ Codex \+ Kimi Code \+ Copilot CLI \+ Grok Build CLI \+ Gemini CLI \+ Factory Droid \+ Hermes Agent \+ Antigravity \+ Runner build/,
    );
    expect(config).toMatch(/Kimi Code user-home `config\.toml`|Stop≤1\/turn WARN/);
    expect(config).toMatch(/Stop consecutive ≤8|Copilot.*≤8/i);
    expect(config).toMatch(/Stop ≤8\/turn|Grok.*≤8\/turn/i);
    expect(config).toMatch(
      /Codex \/ Kimi Code \/ Copilot CLI \/ Grok Build CLI P0/,
    );
    expect(config).toMatch(/does \*\*not\*\* clamp `confirm_rounds`|does not clamp confirm_rounds/i);
    expect(config).toMatch(
      /Gemini \/ Factory \/ Hermes \/ Antigravity \/ Runner sessions|Grok \/ Gemini \/ Factory \/ Hermes \/ Antigravity \/ Runner sessions|Copilot \/ Grok \/ Gemini \/ Factory \/ Hermes \/ Antigravity \/ Runner/i,
    );
    expect(config).toMatch(
      /nor do \*\*Grok Build CLI\*\*, \*\*Gemini CLI\*\*, \*\*Factory Droid\*\*, \*\*Hermes Agent\*\*, \*\*Antigravity\*\*, or \*\*Runner\*\*/,
    );
    expect(config).toMatch(
      /missing\/incomplete \*\*FAIL\*\*|Copilot[\s\S]*FAIL[\s\S]*WARN/i,
    );
    expect(config).toMatch(
      /dual WARN[\s\S]*leftover|leftover hooks on disk|both enabled \*\*or\*\* leftover|dual = both enabled \*\*or\*\* leftover/i,
    );
    expect(config).toMatch(/Factory[\s\S]*\.factory\/hooks\.json|\.factory\/hooks\.json[\s\S]*Factory/i);
    expect(config).toMatch(/FACTORY_PROJECT_DIR/);
    expect(config).toMatch(
      /Factory[\s\S]*missing\/incomplete\/unreadable|\.factory\/hooks\.json[\s\S]*unreadable/i,
    );
    expect(config).toMatch(
      /Factory[\s\S]*hooksDisabled|allowManagedHooksOnly[\s\S]*WARN|hooksDisabled[\s\S]*allowManagedHooksOnly/i,
    );
    expect(config).toMatch(
      /## Related[\s\S]*Factory Droid[\s\S]*Hermes|## Related[\s\S]*Hermes[\s\S]*Factory Droid/i,
    );
    expect(config).toMatch(/HERMES_HOME|Hermes Agent/i);
    expect(config).toMatch(
      /\|\s*\*\*`doctor`\*\*[^\n]*\$HERMES_HOME\/config\.yaml[^\n]*hermes hooks doctor/i,
    );
    expect(config).toMatch(
      /\|\s*\*\*`doctor`\*\*[^\n]*timeout omit or &lt;120 \(host default 60s\)[^\n]*nudge missing or still 3 or &lt;32/i,
    );
    expect(config).toMatch(/hermes hooks doctor/i);
    expect(config).toMatch(
      /\*\*Hermes Agent\*\* does \*\*not\*\* clamp rounds[\s\S]{0,240}(?:nudge still \*\*3\*\*|exhausted mid-chain)[\s\S]{0,80}pending/,
    );
    expect(config).toMatch(
      /## Related[\s\S]*Hermes|## Related[\s\S]*pre_verify continue live-proved/i,
    );
    expect(config).toMatch(/ten-way dispatch/i);
    expect(config).toMatch(
      /\|\s*\*\*`doctor`\*\*[^\n]*Antigravity[^\n]*\.agents\/hooks\.json[^\n]*FAIL/i,
    );
    expect(config).toMatch(/auto-attach ≠ ON|auto-attach tip/i);
  });

  it("dogfood .autopilotignore covers Factory + Antigravity + Gemini/Factory skills", () => {
    const ignore = fs.readFileSync(
      path.join(repoRoot, ".autopilotignore"),
      "utf8",
    );
    expect(ignore).toMatch(/\.factory\/hooks\.json/);
    expect(ignore).toMatch(/\.gemini\/settings\.json/);
    expect(ignore).toMatch(/\.gemini\/skills\/\*\*/);
    expect(ignore).toMatch(/\.factory\/skills\/\*\*/);
    expect(ignore).toMatch(/\.agents\/hooks\.json/);
    expect(ignore).toMatch(/\.agents\/bin\/\*\*/);
    expect(ignore).toMatch(/\.agents\/skills\/\*\*/);
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
      /installs Cursor, Claude Code, Codex, Kimi Code, Copilot CLI, Grok Build CLI, Gemini CLI, Factory Droid, Hermes Agent, and\/or Antigravity/i,
    );
    expect(config).toMatch(/and\/or Runner|Runner.*surface: runner/i);
    expect(config).toMatch(/## Runner/);
    expect(config).toMatch(/runner\.command/);
    expect(config).toMatch(/runner\.max_iterations/);
    // Must bind to Runner keys — `verify.commands` also says "trusted project config".
    expect(config).toMatch(
      /runner\.command[\s\S]{0,900}trusted project config/i,
    );
    expect(config).toMatch(
      /runner\.cwd` \/ `runner\.env`[\s\S]{0,280}trusted project config|Treat `env` as \*\*trusted project config\*\*/i,
    );
    expect(config).toMatch(
      /runner\.command[\s\S]{0,900}shell:\s*false|shell: false[\s\S]{0,80}runner\.command/i,
    );
    expect(config).toMatch(
      /runner\.max_iterations[\s\S]{0,280}1\.\.500|clamped to \*\*1\.\.500\*\*/i,
    );
    expect(config).toMatch(
      /max_iterations[\s\S]{0,200}start \*\*FAIL\*\*|`<1`[\s\S]{0,120}FAIL/i,
    );
    expect(config).toMatch(
      /runner\.cwd[\s\S]{0,280}start \*\*FAIL\*\*|outside project[\s\S]{0,80}FAIL/i,
    );
    expect(config).toMatch(
      /prompt_mode[\s\S]{0,120}start \*\*FAIL\*\*|Invalid value → start \*\*FAIL\*\*/i,
    );
    expect(config).toMatch(/--on[\s\S]{0,80}deferred|deferred[\s\S]{0,40}--on/i);
    expect(config).toMatch(
      /needPick[\s\S]{0,80}exit 2|exit 2[\s\S]{0,40}needPick/i,
    );
    expect(config).toMatch(
      /On \*\*hook\*\* hosts[\s\S]{0,120}needPick|On \*\*Runner\*\*[\s\S]{0,80}needPick[\s\S]{0,80}exit 2/i,
    );
    expect(config).toMatch(
      /several[\s\S]{0,40}runnable|when \*\*several\*\* tracks/i,
    );
    expect(config).toMatch(
      /not paused[\s\S]{0,80}resume|paused[\s\S]{0,80}FAIL/i,
    );
    expect(config).toMatch(
      /Paused[\s\S]{0,80}bare or `--run`|paused[\s\S]{0,60}FAIL[\s\S]{0,40}`--run`/i,
    );
    expect(config).toMatch(/one_executor[\s\S]{0,200}Runner|Runner[\s\S]{0,200}one_executor/i);
    expect(config).toMatch(
      /runner\.command[\s\S]{0,900}doctor \*\*WARN\*\*|doctor \*\*WARN\*\*[\s\S]{0,120}runner\.command/,
    );
    expect(config).not.toMatch(/doctor WARN\/FAIL/);
    expect(config).toMatch(/surface: cli.*shared|hooks shared across terminal/i);
    expect(config).toMatch(/\.codex\/\*\*/);
    expect(config).toMatch(/\.github\/hooks\/\*\*/);
    expect(config).toMatch(/\.grok\/hooks\/\*\*/);
    expect(config).toMatch(/\.gemini\/settings\.json/);
    expect(config).toMatch(/\.factory\/hooks\.json/);
    expect(config).toMatch(/FACTORY_PROJECT_DIR/);
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
      expect(body).toMatch(/--platform grok-build|platform grok-build/);
      expect(body).toMatch(/Stop ≤8\/turn|≤8\/turn/);
      expect(body).toMatch(/--add-platform grok-build/);
      expect(body).toMatch(/hooks-trust|--trust/);
      expect(body).toMatch(/no PreToolUse|不接 PreToolUse/i);
      expect(body).toMatch(
        /Grok[\s\S]{0,120}enabled or leftover|已启用或磁盘残留/i,
      );
      expect(body).toMatch(/--platform gemini-cli|platform gemini-cli/);
      expect(body).toMatch(/--add-platform gemini-cli/);
      expect(body).toMatch(/MAX_TURNS|≤100|0\.31\.0/);
      expect(body).toMatch(/re-trust|\/hooks panel|folder trust/);
      expect(body).toMatch(/GEMINI_PLANS_DIR/);
      expect(body).toMatch(/--platform factory-droid|platform factory-droid/);
      expect(body).toMatch(/--add-platform factory-droid/);
      expect(body).toMatch(/FACTORY_PROJECT_DIR/);
      expect(body).toMatch(/multi-block|stop_hook_active|live-proved/i);
      expect(body).toMatch(/init --platform hermes-agent/);
      expect(body).toMatch(/--add-platform hermes-agent/);
      expect(body).toMatch(/HERMES_HOME/);
      expect(body).toMatch(/pre_verify|0\.21\.3|hermes hooks doctor/i);
      expect(body).toMatch(
        /# (?:or|或) Hermes Agent[^\n]*\n[^\n]*init --platform hermes-agent/,
      );
      expect(body).toMatch(
        /# (?:or|或) Factory Droid[^\n]*\n[^\n]*init --platform factory-droid/,
      );
      expect(body).toMatch(/init --platform antigravity/);
      expect(body).toMatch(/--add-platform antigravity/);
      expect(body).toMatch(
        /# (?:or|或) Antigravity[^\n]*\n[^\n]*init --platform antigravity/,
      );
      expect(body).toMatch(/\.agents\/hooks\.json|decision:continue|degraded/i);
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
    expect(cliReadme).toMatch(
      /Cursor, Claude Code, Codex, Kimi Code, GitHub Copilot CLI, Grok Build CLI, Gemini CLI, Factory Droid, Hermes Agent, Antigravity, and Runner \(meta\)/,
    );
    expect(cliReadme).toMatch(/runner\.command/);
    expect(cliReadme).toMatch(/--on[\s\S]{0,40}deferred|deferred[\s\S]{0,40}--on/i);
    expect(cliReadme).not.toMatch(/v0\.2 ships Cursor and Claude Code/);
    expect(cliReadme).toMatch(/--platform codex|platform codex/);
    expect(cliReadme).toMatch(/kimi-code/);
    expect(cliReadme).toMatch(/copilot-cli/);
    expect(cliReadme).toMatch(/grok-build/);
    expect(cliReadme).toMatch(/gemini-cli/);
    expect(cliReadme).toMatch(/factory-droid/);
    expect(cliReadme).toMatch(/hermes-agent/);
    expect(cliReadme).toMatch(/antigravity/);
    expect(cliReadme).toMatch(/\.agents|decision:continue|degraded/i);
    expect(cliReadme).toMatch(/auto-attach ≠ Autopilot ON|auto-attach ≠ ON/i);
    expect(cliReadme).toMatch(/HERMES_HOME|hermes hooks doctor/i);
    expect(cliReadme).toMatch(/pre_verify|0\.21\.3|max_verify_nudges/i);
    expect(cliReadme).toMatch(/FACTORY_PROJECT_DIR/);
    expect(cliReadme).toMatch(/MAX_TURNS|AfterAgent turn cap ≤100|≤100/);
    expect(cliReadme).toMatch(/0\.31\.0/);
    expect(cliReadme).toMatch(/Stop≤1\/turn|degraded Stop/i);
    expect(cliReadme).toMatch(/Stop consecutive ≤8/);
    expect(cliReadme).toMatch(/Stop ≤8\/turn|≤8\/turn/);
    expect(cliReadme).toMatch(/Restart Copilot CLI/i);
    expect(cliReadme).toMatch(/hooks-trust|--trust/);
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

  it("README English ships Runner meta and keeps OpenCode next", () => {
    const body = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    expect(body).toMatch(/Runner \(meta\)|Runner.*Shipped \(meta\)/i);
    expect(body).toMatch(/OpenCode[\s\S]{0,80}1 \(next\)|1 \(next\)[\s\S]{0,80}OpenCode/i);
    expect(body).toMatch(/runner\.command/);
    expect(body).toMatch(/--on[\s\S]{0,40}deferred|deferred[\s\S]{0,40}--on/i);
  });

  it("README.zh-CN ships Runner meta and keeps OpenCode next", () => {
    const body = fs.readFileSync(path.join(repoRoot, "README.zh-CN.md"), "utf8");
    expect(body).toMatch(/Runner（meta）|Runner.*Shipped \(meta\)/i);
    expect(body).toMatch(/OpenCode[\s\S]{0,80}1 \(next\)|1 \(next\)[\s\S]{0,80}OpenCode/);
    expect(body).toMatch(/runner\.command/);
    expect(body).toMatch(/--on[\s\S]{0,40}deferred|deferred[\s\S]{0,40}--on/);
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
    expect(body).toMatch(/--platform grok-build|init --platform grok-build/);
    expect(body).toMatch(/port-grok-build/);
    expect(body).toMatch(/--platform gemini-cli|init --platform gemini-cli/);
    expect(body).toMatch(/port-gemini-cli/);
    expect(body).toMatch(/--platform factory-droid|init --platform factory-droid/);
    expect(body).toMatch(/port-factory-droid/);
    expect(body).toMatch(/FACTORY_PROJECT_DIR/);
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
    expect(body).toMatch(
      /Grok Build[\s\S]*degraded[\s\S]*≤8\/turn|Stop ≤8\/turn/i,
    );
    expect(body).toMatch(/hooks-trust|--trust/);
    expect(body).toMatch(/pending|RESUME|nudge/i);
    expect(body).toMatch(/userPromptSubmitted/);
    expect(body).toMatch(/no `preToolUse`|no PreToolUse/i);
    expect(body).toMatch(
      /Gemini CLI[\s\S]*MAX_TURNS|AfterAgent turn cap ≤100|≤100/,
    );
    expect(body).toMatch(/0\.31\.0/);
    expect(body).toMatch(/re-trust|\/hooks panel|folder trust/);
    expect(body).toMatch(/init --platform hermes-agent/);
    expect(body).toMatch(/--add-platform hermes-agent/);
    expect(body).toMatch(/port-hermes-agent/);
    expect(body).toMatch(/HERMES_HOME/);
    expect(body).toMatch(/pre_verify|0\.21\.3|max_verify_nudges/i);
    expect(body).toMatch(/hermes hooks doctor/i);
    // Host comment must sit directly above its matching init command (not another host).
    expect(body).toMatch(
      /# or Hermes Agent[^\n]*\n[^\n]*init --platform hermes-agent/,
    );
    expect(body).toMatch(
      /# or Factory Droid[^\n]*\n[^\n]*init --platform factory-droid/,
    );
    expect(body).toMatch(/init --platform antigravity/);
    expect(body).toMatch(/--add-platform antigravity/);
    expect(body).toMatch(
      /# or Antigravity[^\n]*\n[^\n]*init --platform antigravity/,
    );
    expect(body).toMatch(/port-antigravity/);
    expect(body).toMatch(/\.agents\/hooks\.json|\.agents\/skills/);
    expect(body).toMatch(
      /Gemini CLI[\s\S]{0,400}\.gemini\/skills\/autopilot-\*/,
    );
    expect(body).toMatch(
      /Factory Droid[\s\S]{0,400}\.factory\/skills\/autopilot-\*/,
    );
    expect(body).toMatch(
      /Hermes Agent[\s\S]{0,500}\$HERMES_HOME\/skills\/autopilot-\*/,
    );
    expect(body).not.toMatch(
      /For \*\*Gemini CLI\*\*[\s\S]{0,500}— no Autopilot skills \/ `AGENTS\.md`/,
    );
    expect(body).not.toMatch(
      /For \*\*Factory Droid\*\*[\s\S]{0,500}— no Autopilot skills \/ `AGENTS\.md`/,
    );
    expect(body).not.toMatch(
      /For \*\*Hermes Agent\*\*[\s\S]{0,700}— no Autopilot skills \/ `AGENTS\.md`/,
    );
    expect(body).toMatch(/auto-attach ≠ Autopilot ON|auto-attach ≠ ON/i);
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
    expect(body).toMatch(/--platform grok-build|init --platform grok-build/);
    expect(body).toMatch(/Stop ≤8\/turn|≤8\/turn 降级/);
    expect(body).toMatch(/--platform gemini-cli|init --platform gemini-cli/);
    expect(body).toMatch(/MAX_TURNS|AfterAgent|≤100/);
    expect(body).toMatch(/0\.31\.0/);
    expect(body).toMatch(/re-trust|\/hooks panel|folder trust/);
    expect(body).toMatch(/hooks-trust|--trust/);
    expect(body).toMatch(/userPromptSubmitted/);
    expect(body).toMatch(/不接 `preToolUse`|no `preToolUse`|不接 PreToolUse/i);
    expect(body).toMatch(/Copilot Stop≤8|Stop≤8 \/ 重启|双装/);
    expect(body).toMatch(/Grok Stop≤8|多指纹/);
    expect(body).toMatch(/--platform factory-droid|init --platform factory-droid/);
    expect(body).toMatch(/FACTORY_PROJECT_DIR/);
    expect(body).toMatch(/multi-block|stop_hook_active|活链已证/i);
    expect(body).toMatch(/免活链|degraded≤1/);
    expect(body).toMatch(/init --platform hermes-agent/);
    expect(body).toMatch(/--add-platform hermes-agent/);
    expect(body).toMatch(/HERMES_HOME/);
    expect(body).toMatch(/pre_verify|0\.21\.3|活链已证/i);
    expect(body).toMatch(/人闸认 R1|R1|degraded/i);
    expect(body).toMatch(
      /# 或 Hermes Agent[^\n]*\n[^\n]*init --platform hermes-agent/,
    );
    expect(body).toMatch(
      /# 或 Factory Droid[^\n]*\n[^\n]*init --platform factory-droid/,
    );
    expect(body).toMatch(/init --platform antigravity/);
    expect(body).toMatch(/--add-platform antigravity/);
    expect(body).toMatch(
      /# 或 Antigravity[^\n]*\n[^\n]*init --platform antigravity/,
    );
    expect(body).toMatch(/\.agents\/hooks\.json|\.agents\/skills/);
    expect(body).toMatch(/\.gemini\/skills\/autopilot-\*/);
    expect(body).toMatch(/\.factory\/skills\/autopilot-\*/);
    expect(body).toMatch(/\$HERMES_HOME\/skills\/autopilot-\*/);
    expect(body).not.toMatch(
      /\*\*Gemini CLI\*\*[\s\S]{0,500}— 不写 Autopilot skills \/ `AGENTS\.md`/,
    );
    expect(body).not.toMatch(
      /\*\*Factory Droid\*\*[\s\S]{0,500}— 不写 Autopilot skills \/ `AGENTS\.md`/,
    );
    expect(body).not.toMatch(
      /\*\*Hermes Agent\*\*[\s\S]{0,700}— 不写 Autopilot skills \/ `AGENTS\.md`/,
    );
    expect(body).toMatch(/auto-attach ≠ Autopilot ON|auto-attach ≠ ON/i);
  });

  it("hosts.md marks Codex, Claude, Kimi, Copilot, and Grok as shipped", () => {
    const hosts = fs.readFileSync(path.join(repoRoot, "docs/hosts.md"), "utf8");
    expect(hosts).toMatch(/\|\s*\*\*Codex\*\*\s*\|\s*\*\*Shipped\*\*/);
    expect(hosts).toMatch(/\|\s*\*\*Claude Code\*\*\s*\|\s*\*\*Shipped\*\*/);
    expect(hosts).toMatch(/\|\s*\*\*Kimi Code\*\*\s*\|\s*\*\*Shipped\*\*/);
    expect(hosts).toMatch(
      /\|\s*\*\*GitHub Copilot CLI\*\*\s*\|\s*\*\*Shipped\*\*/,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*Grok Build CLI\*\*\s*\|\s*\*\*Shipped\*\*/,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*Gemini CLI\*\*\s*\|\s*\*\*Shipped\*\*/,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*Factory Droid\*\*\s*\|\s*\*\*Shipped\*\*/,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*Hermes Agent\*\*\s*\|\s*\*\*Shipped\*\*/,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*Antigravity\*\*\s*\|\s*\*\*Shipped\*\*/,
    );
    expect(hosts).not.toMatch(/\|\s*\*\*Codex\*\*\s*\|\s*\*\*v0\.3 \/ v0\.4 planned\*\*/);
    // Status column only (avoid Notes-column false positives/negatives).
    expect(hosts).not.toMatch(/\|\s*\*\*Codex\*\*\s*\|\s*\*\*Planned\*\*/);
    expect(hosts).not.toMatch(/\|\s*\*\*Kimi Code\*\*\s*\|\s*\*\*Next\*\*/);
    expect(hosts).not.toMatch(
      /\|\s*\*\*GitHub Copilot CLI\*\*\s*\|\s*\*\*Next\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*Grok Build CLI\*\*\s*\|\s*\*\*Next\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*GitHub Copilot CLI\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*Grok Build CLI\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*Gemini CLI\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*Gemini CLI\*\*\s*\|\s*\*\*Next\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*Factory Droid\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*Factory Droid\*\*\s*\|\s*\*\*Next\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*Hermes Agent\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*Hermes Agent\*\*\s*\|\s*\*\*Next\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*Antigravity\*\*\s*\|\s*\*\*Next\*\*/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*Antigravity\*\*/,
    );
    expect(hosts).toMatch(/handleCodexUserPromptSubmit/);
    expect(hosts).toMatch(/handleCodexPostToolUse/);
    expect(hosts).toMatch(/handleCodexStop/);
    expect(hosts).toMatch(/handleKimiUserPromptSubmit|handleKimi\*/);
    expect(hosts).toMatch(/handleKimiPostToolUse|handleKimiStop/);
    expect(hosts).toMatch(/handleCopilotUserPromptSubmit|handleCopilot\*/);
    expect(hosts).toMatch(/handleCopilotPostToolUse|handleCopilotStop/);
    expect(hosts).toMatch(/handleGrokUserPromptSubmit|handleGrok\*/);
    expect(hosts).toMatch(/handleGrokPostToolUse|handleGrokStop/);
    expect(hosts).toMatch(/handleGeminiUserPromptSubmit|handleGemini\*/);
    expect(hosts).toMatch(/handleGeminiPostToolUse|handleGeminiStop/);
    expect(hosts).toMatch(/handleFactoryUserPromptSubmit|handleFactory\*/);
    expect(hosts).toMatch(/handleFactoryPostToolUse|handleFactoryStop/);
    expect(hosts).toMatch(/handleHermesPreLlmCall|handleHermes\*/);
    expect(hosts).toMatch(/handleHermesPostToolCall|handleHermesPreVerify/);
    expect(hosts).toMatch(/handleAntigravityPreInvocation|handleAntigravity\*/);
    expect(hosts).toMatch(/handleAntigravityPostToolUse|handleAntigravityStop/);
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
    expect(hosts).toMatch(/ten-way/);
    expect(hosts).not.toMatch(/\bnine-way\b/);
    expect(hosts).not.toMatch(/\beight-way\b/);
    expect(hosts).not.toMatch(/\bseven-way\b/);
    expect(hosts).not.toMatch(/\bsix-way\b/);
    expect(hosts).not.toMatch(/\bfive-way\b/);
    expect(hosts).not.toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*Kimi Code\*\*/,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*1 \(next\)\*\*\s*\|\s*\*\*OpenCode\*\*/,
    );
    expect(hosts).toMatch(/Kimi Code \| \*\*Shipped\*\* \(degraded Stop≤1\/turn\)/);
    expect(hosts).toMatch(
      /GitHub Copilot CLI \| \*\*Shipped\*\* \(degraded Stop consecutive ≤8\)/,
    );
    expect(hosts).toMatch(
      /Grok Build CLI \| \*\*Shipped\*\* \(degraded Stop ≤8\/turn\)/,
    );
    expect(hosts).toMatch(
      /Gemini CLI \| \*\*Shipped\*\* \(AfterAgent turn cap ≤100/,
    );
    expect(hosts).toMatch(
      /Factory Droid \| \*\*Shipped\*\* \(multi-block under `stop_hook_active` live-proved/,
    );
    expect(hosts).toMatch(
      /Hermes Agent \| \*\*Shipped\*\* \(shell `pre_verify` continue live-proved/,
    );
    expect(hosts).toMatch(
      /Antigravity \| \*\*Shipped\*\* \(host Stop continue live-proved|Antigravity \| \*\*Shipped\*\* \(v0\.10\.1\)/,
    );
    expect(hosts).toMatch(
      /Runner \| \*\*Shipped \(meta\)\*\*|Runner \| \*\*Shipped\*\* \(meta\)/,
    );
    expect(hosts).toMatch(/runner\.command/);
    expect(hosts).toMatch(/one_executor/);
    expect(hosts).toMatch(/--on[\s\S]{0,80}deferred|deferred[\s\S]{0,40}--on/i);
    expect(hosts).toMatch(/max_iterations|\*\*32\*\*/);
    expect(hosts).toMatch(/ten-way/);
    expect(hosts).not.toMatch(/\beleven-way\b/i);
    expect(hosts).not.toMatch(/eleventh hook/i);
    // Doctor empty-command is WARN-only; start FAIL is separate.
    // Bare start with nothing to resume FAILs without a doctor line.
    expect(hosts).toMatch(
      /runner\.command[\s\S]{0,200}doctor \*\*WARN\*\*|doctor \*\*WARN\*\*[\s\S]{0,120}runner\.command/,
    );
    expect(hosts).toMatch(
      /nothing to resume[\s\S]{0,80}FAIL|bare start[\s\S]{0,80}FAIL/,
    );
    expect(hosts).toMatch(
      /not paused[\s\S]{0,80}resume|paused[\s\S]{0,80}FAIL/i,
    );
    expect(hosts).toMatch(
      /paused[\s\S]{0,80}bare or `--run`|paused[\s\S]{0,60}FAIL[\s\S]{0,40}`--run`/i,
    );
    // Platforms blurb must not re-open the old "pending/executing ⇒ resume" gap.
    expect(hosts).toMatch(
      /resume without `--run` when pending\/executing and \*\*not paused\*\*/i,
    );
    expect(hosts).not.toMatch(/doctor WARN\/FAIL/);
    expect(hosts).not.toMatch(/empty start \/ missing/);
    expect(hosts).toMatch(/\.gemini\/skills\/autopilot-\*/);
    expect(hosts).toMatch(/\.factory\/skills\/autopilot-\*/);
    expect(hosts).not.toMatch(
      /\|\s*\*\*Gemini CLI\*\*[\s\S]{0,2200}no Autopilot skills \/ `AGENTS\.md`/,
    );
    expect(hosts).not.toMatch(
      /\|\s*\*\*Factory Droid\*\*[\s\S]{0,2200}no Autopilot skills \/ `AGENTS\.md`/,
    );
    expect(hosts).toMatch(/Grok Build CLI/);
    expect(hosts).toMatch(/Gemini CLI/);
    expect(hosts).toMatch(/Factory Droid/);
    expect(hosts).toMatch(/Hermes Agent/);
    expect(hosts).toMatch(/FACTORY_PROJECT_DIR/);
    expect(hosts).toMatch(/\.factory\/hooks\.json/);
    expect(hosts).toMatch(/waive[\s\S]*degraded≤1|waive live → default \*\*degraded≤1/i);
    expect(hosts).toMatch(/HERMES_HOME/);
    expect(hosts).toMatch(/config\.yaml/);
    expect(hosts).toMatch(/max_verify_nudges|0\.21\.3/);
    expect(hosts).toMatch(/hermes hooks doctor/i);
    expect(hosts).toMatch(/accept-hooks|HERMES_ACCEPT_HOOKS/i);
    expect(hosts).toMatch(/edit-only|changed_paths/i);
    expect(hosts).toMatch(/waive[\s\S]*R1|R1[\s\S]*ack|human R1/i);
    expect(hosts).toMatch(
      /\|\s*\*\*Hermes Agent\*\*[\s\S]{0,2000}allow \/ hard-stop \*\*`\{\}`\*\*/i,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*Hermes Agent\*\*[\s\S]{0,2000}omit → host default \*\*60s\*\*/i,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*Hermes Agent\*\*[\s\S]{0,2000}timeout omit\/&lt;120 \(host default 60s\)/i,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*Hermes Agent\*\*[\s\S]{0,2000}(?:not\*\* Codex-style|not Codex-style)[\s\S]{0,40}omit/i,
    );
    expect(hosts).toMatch(
      /\|\s*\*\*Hermes Agent\*\*[\s\S]{0,500}(?:nudge still \*\*3\*\*|budget exhausted|plugin-first)[\s\S]{0,120}pending/i,
    );
    expect(hosts).toMatch(
      /HERMES_HOME[\s\S]{0,200}shared across projects|Hermes hooks[\s\S]{0,200}shared across projects/i,
    );
    expect(hosts).toMatch(/symlink|fail-closed/i);
    expect(hosts).toMatch(
      /instrumented project root|wrong\/hostile|hostile env/i,
    );
    expect(hosts).toMatch(/Antigravity/);
    expect(hosts).toMatch(/OpenCode/);
    expect(hosts).toMatch(/\bPi\b/);
    expect(hosts).toMatch(/Devin CLI/);
    expect(hosts).toMatch(/Codex CLI and Codex App/);
    expect(hosts).toMatch(
      /OpenCode[\s\S]{0,200}roadmap|roadmap[\s\S]{0,200}OpenCode/i,
    );
    expect(hosts).toMatch(
      /OpenCode[\s\S]{0,120}do \*\*not\*\* install|do \*\*not\*\* install them yet[\s\S]{0,80}OpenCode/i,
    );
    expect(hosts).toMatch(/Stop-continue hard-capped at 1|≤1 continue \/ turn|Stop continue ≤1|Stop≤1\/turn/i);
    expect(hosts).toMatch(/Stop consecutive ≤8|consecutive ≤8/);
    expect(hosts).toMatch(/Stop ≤8\/turn|≤8\/turn|≤8 continues \/ turn/);
    expect(hosts).toMatch(/per-turn reset|resets each user turn|resets on next user prompt/i);
    expect(hosts).toMatch(/hooks-trust|--trust/);
    expect(hosts).toMatch(/compat\.cursor|compat\.claude|compat\.\*\.hooks/i);
    expect(hosts).toMatch(/\.grok\/hooks\/autopilot-harness\.json/);
    expect(hosts).toMatch(/\.gemini\/settings\.json/);
    expect(hosts).toMatch(/MAX_TURNS/);
    expect(hosts).toMatch(/0\.31\.0/);
    expect(hosts).toMatch(/\/hooks panel|folder trust/);
    expect(hosts).toMatch(/GEMINI_PLANS_DIR/);
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
    expect(hosts).toMatch(/\*\*no\*\* `preToolUse`|no `preToolUse`|\*\*No\*\* PreToolUse/i);
    expect(hosts).toMatch(/Grok\+Claude|Grok\+Cursor|multi-fingerprint/i);
    expect(hosts).toMatch(
      /Grok[\s\S]{0,160}both enabled or leftover|multi-fingerprints \(both enabled or leftover/i,
    );
    expect(hosts).toMatch(/re-submits with slug|re-submit with slug|重提 slug/i);
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
    // Adequate host ceilings (Gemini MAX_TURNS) ship full Autopilot — not the degraded pattern.
    expect(hosts).toMatch(
      /below a usable Autopilot review chain|too small for a full review chain/i,
    );
    expect(hosts).toMatch(
      /ship full Autopilot with an honest documented ceiling[\s\S]{0,40}not the degraded pattern/i,
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
      /installs Cursor, Claude Code, Codex, Kimi Code, Copilot CLI, Grok Build CLI, Gemini CLI, Factory Droid, Hermes Agent, and\/or Antigravity/i,
    );
    expect(body).toMatch(/and\/or Runner|Runner.*surface: runner/i);
    expect(body).toMatch(/ports\/claude-code/);
    expect(body).toMatch(/ports\/codex/);
    expect(body).toMatch(/ports\/kimi-code/);
    expect(body).toMatch(/ports\/copilot-cli/);
    expect(body).toMatch(/ports\/grok-build/);
    expect(body).toMatch(/ports\/gemini-cli/);
    expect(body).toMatch(/ports\/factory-droid/);
    expect(body).toMatch(/ports\/antigravity/);
    expect(body).toMatch(/ports\/runner/);
    expect(body).toMatch(/antigravity`\/`cli|antigravity\/cli/);
    expect(body).toMatch(/runner`\/`runner|runner\/runner/);
    expect(body).toMatch(
      /Cursor, Claude Code, Codex, Kimi Code, Copilot CLI, Grok Build, Gemini CLI, Factory Droid, Hermes Agent, and Antigravity/,
    );
    expect(body).toMatch(
      /\|\s*\*\*Runner\*\* \(shipped, meta\)[\s\S]{0,400}runner\.command/,
    );
    expect(body).toMatch(/one_executor/);
    expect(body).toMatch(/--on[\s\S]{0,40}deferred|deferred[\s\S]{0,40}--on/i);
    expect(body).toMatch(/handleCodex\*/);
    expect(body).toMatch(/handleKimi\*/);
    expect(body).toMatch(/handleCopilot\*/);
    expect(body).toMatch(/handleGrok\*/);
    expect(body).toMatch(/handleGemini\*/);
    expect(body).toMatch(/handleFactory\*/);
    expect(body).toMatch(/handleHermes\*/);
    expect(body).toMatch(/handleAntigravity\*/);
    expect(body).toMatch(/ten-way/);
    expect(body).not.toMatch(/\bnine-way\b/);
    expect(body).not.toMatch(/\beight-way\b/);
    expect(body).not.toMatch(/\bseven-way\b/);
    expect(body).not.toMatch(/\bsix-way\b/);
    expect(body).toMatch(/never `local\.toml`|never local\.toml/i);
    expect(body).toMatch(/triggers\.on\s*\/\s*`?triggers\.run|triggers\.on`\s*\/\s*`triggers\.run/);
    expect(body).toMatch(/npm public/);
    // Forbid recommending bare `npx autopilot-harness …` as an install command.
    // Allow prose that warns against it (e.g. "not bare `npx autopilot-harness`").
    expect(body).not.toMatch(/(?:^|[^\w`])npx autopilot-harness(?:\s|$)/);
    expect(body).toMatch(/Kimi Code[\s\S]*≤1 continuation \/ turn|Kimi Code[\s\S]*≤1 continue \/ turn|Stop≤1\/turn/i);
    expect(body).toMatch(/degraded[\s\S]*confirm_rounds:\s*1|confirm_rounds:\s*1[\s\S]*degraded/i);
    expect(body).toMatch(/Copilot CLI[\s\S]*≤8|consecutive ≤8|Stop consecutive ≤8/i);
    expect(body).toMatch(/Grok Build[\s\S]*≤8\/turn|Stop ≤8\/turn/i);
    expect(body).toMatch(/Gemini CLI[\s\S]*MAX_TURNS|AfterAgent[\s\S]*≤100/i);
    expect(body).toMatch(/0\.31\.0/);
    expect(body).toMatch(/Factory Droid[\s\S]*live-proved|Factory Droid[\s\S]*FACTORY_PROJECT_DIR/i);
    expect(body).toMatch(/FACTORY_PROJECT_DIR/);
    expect(body).toMatch(/waive[\s\S]*degraded≤1|Waive live → degraded≤1/i);
    expect(body).toMatch(/handleHermes\*/);
    expect(body).toMatch(/HERMES_HOME/);
    expect(body).toMatch(/0\.21\.3|max_verify_nudges/);
    expect(body).toMatch(
      /\|\s*\*\*Hermes Agent\*\* \(shipped\)[\s\S]{0,500}(?:mid-cutoff → pending|nudge still \*\*3\*\*)/,
    );
    expect(body).toMatch(
      /Hermes Agent uses `surface: cli`[\s\S]{0,220}HERMES_HOME/,
    );
    expect(body).toMatch(/per-turn reset|not consecutive/i);
    expect(body).toMatch(/hooks-trust|--trust/);
    expect(body).toMatch(/userPromptSubmitted/);
    expect(body).toMatch(/[Nn]o `preToolUse`|[Nn]o PreToolUse/);
    expect(body).toMatch(/pending|RESUME|nudge/i);
    expect(body).toMatch(/Restart Copilot CLI/i);
    expect(body).toMatch(/Grok\+Claude|Grok\+Cursor/i);
    expect(body).toMatch(
      /Grok[\s\S]{0,80}enabled or leftover|Grok\+Claude\/Cursor dual \(enabled or leftover/i,
    );
    expect(body).toMatch(
      /UserPromptSubmit` \/ `userPromptSubmitted|userPromptSubmitted[\s\S]*loop_limit/i,
    );
    expect(body).toMatch(/enabled or leftover|leftover/i);
    expect(body).toMatch(
      /when possible[\s\S]*hard-caps[\s\S]*keep the stop streak short/i,
    );
    expect(body).toMatch(/below a usable Autopilot review chain/i);
    expect(body).toMatch(
      /ship full Autopilot with an honest documented ceiling[\s\S]{0,40}not the degraded pattern/i,
    );
  });

  it("CHANGELOG records 0.1.0 / 0.2.0 / 0.2.1 / 0.2.2 / 0.2.3 / 0.2.4 / 0.2.5 / 0.2.6 / 0.2.7 / 0.2.8 / 0.2.9 / 0.2.10 / 0.2.11 / 0.2.12 / 0.2.13 / 0.2.14 / 0.2.15 / 0.3.0 / 0.4.0 / 0.4.1 / 0.5.0 / 0.6.0 / 0.7.0 / 0.8.0 / 0.9.0 / 0.10.0 and CONTRIBUTING keeps dogfood", () => {
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
    expect(log).toMatch(/## \[0\.6\.0\]/);
    expect(log).toMatch(/## \[0\.7\.0\]/);
    expect(log).toMatch(/## \[0\.8\.0\]/);
    expect(log).toMatch(/## \[0\.9\.0\]/);
    expect(log).toMatch(/## \[0\.10\.0\]/);
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
    const section060 = changelogSection(log, "0.6.0");
    expect(section060).toMatch(/port-grok-build|@autopilot-harness\/port-grok-build/i);
    expect(section060).toMatch(/handleGrokUserPromptSubmit/);
    expect(section060).toMatch(/handleGrokPostToolUse/);
    expect(section060).toMatch(/handleGrokStop/);
    expect(section060).toMatch(/docs-grok-shipped/i);
    expect(section060).toMatch(/marked \*\*Shipped\*\*/);
    expect(section060).toMatch(/packages\/ports\/grok-build\/package\.json/);
    expect(section060).toMatch(/Stop ≤8\/turn|≤8\/turn/);
    expect(section060).toMatch(/per-turn reset|not consecutive/i);
    expect(section060).toMatch(/pending|RESUME|nudge/i);
    expect(section060).toMatch(/hooks-trust|--trust/);
    expect(section060).toMatch(/Grok\+Claude|Grok\+Cursor|multi-fingerprint/i);
    expect(section060).toMatch(/both enabled or leftover|enabled or leftover/i);
    expect(section060).toMatch(/compat\.hooks tip|compat\.hooks/i);
    expect(section060).toMatch(/no PreToolUse|explicitly \*\*no PreToolUse\*\*/i);
    expect(section060).toMatch(/\.grok\/hooks/);
    expect(section060).toMatch(/six-way|Six-way/i);
    expect(section060).toMatch(/grok-build/);
    expect(section060).toMatch(
      /core\s*→\s*i18n\s*→\s*ports[\s\S]*grok-build[\s\S]*→\s*cli|ports \(cursor, claude-code, codex, kimi-code, copilot-cli, grok-build\)/i,
    );
    expect(section060).toMatch(/pnpm publish|pnpm pack/i);
    expect(section060).toMatch(/1 \(next\)[\s\S]{0,80}Gemini/);
    const section070 = changelogSection(log, "0.7.0");
    expect(section070).toMatch(/port-gemini-cli|@autopilot-harness\/port-gemini-cli/i);
    expect(section070).toMatch(/handleGeminiUserPromptSubmit/);
    expect(section070).toMatch(/handleGeminiPostToolUse/);
    expect(section070).toMatch(/handleGeminiStop/);
    expect(section070).toMatch(/docs-gemini-shipped/i);
    expect(section070).toMatch(/marked \*\*Shipped\*\*/);
    expect(section070).toMatch(/packages\/ports\/gemini-cli\/package\.json/);
    expect(section070).toMatch(/MAX_TURNS|AfterAgent turn cap ≤100|≤100/);
    expect(section070).toMatch(/0\.31\.0/);
    expect(section070).toMatch(/re-trust|\/hooks panel|folder trust/);
    expect(section070).toMatch(/GEMINI_PLANS_DIR/);
    expect(section070).toMatch(/hooksConfig/);
    expect(section070).toMatch(/Gemini\+Claude|Gemini CLI \+ Claude/i);
    expect(section070).toMatch(/no BeforeTool|explicitly \*\*no BeforeTool/i);
    expect(section070).toMatch(/\.gemini\/settings\.json/);
    expect(section070).toMatch(/seven-way|Seven-way/i);
    expect(section070).toMatch(/gemini-cli/);
    expect(section070).toMatch(
      /core\s*→\s*i18n\s*→\s*ports[\s\S]*gemini-cli[\s\S]*→\s*cli|ports \(cursor, claude-code, codex, kimi-code, copilot-cli, grok-build, gemini-cli\)/i,
    );
    expect(section070).toMatch(/pnpm publish|pnpm pack/i);
    expect(section070).toMatch(/1 \(next\)[\s\S]{0,80}Factory/);
    const section080 = changelogSection(log, "0.8.0");
    expect(section080).toMatch(/port-factory-droid|@autopilot-harness\/port-factory-droid/i);
    expect(section080).toMatch(/handleFactoryUserPromptSubmit/);
    expect(section080).toMatch(/handleFactoryPostToolUse/);
    expect(section080).toMatch(/handleFactoryStop/);
    expect(section080).toMatch(/docs-factory-shipped/i);
    expect(section080).toMatch(/marked \*\*Shipped\*\*/);
    expect(section080).toMatch(/packages\/ports\/factory-droid\/package\.json/);
    expect(section080).toMatch(/FACTORY_PROJECT_DIR/);
    expect(section080).toMatch(/multi-block|stop_hook_active|live-proved/i);
    expect(section080).toMatch(/waive[\s\S]*degraded/i);
    expect(section080).toMatch(/Factory\+Claude|Factory Droid \+ Claude/i);
    expect(section080).toMatch(/no PreToolUse|explicitly \*\*no PreToolUse/i);
    expect(section080).toMatch(/\.factory\/hooks\.json/);
    expect(section080).toMatch(/symlink|fail-closed/i);
    expect(section080).toMatch(/fail-open/i);
    expect(section080).toMatch(
      /\*\*FAIL\*\*s on missing\/incomplete\/unreadable|\*\*FAIL\*\*s on missing\/incomplete/,
    );
    expect(section080).toMatch(/Gemini\/Factory cross-fire|Grok\/Gemini\/Factory cross-fire/i);
    expect(section080).toMatch(/eight-way|Eight-way/i);
    expect(section080).toMatch(/factory-droid/);
    expect(section080).toMatch(
      /core\s*→\s*i18n\s*→\s*ports[\s\S]*factory-droid[\s\S]*→\s*cli|ports \(cursor, claude-code, codex, kimi-code, copilot-cli, grok-build, gemini-cli, factory-droid\)/i,
    );
    expect(section080).toMatch(/pnpm publish|pnpm pack/i);
    expect(section080).toMatch(/1 \(next\)[\s\S]{0,80}Hermes/);
    const section090 = changelogSection(log, "0.9.0");
    expect(section090).toMatch(/port-hermes-agent|@autopilot-harness\/port-hermes-agent/i);
    expect(section090).toMatch(/handleHermesPreLlmCall/);
    expect(section090).toMatch(/handleHermesPostToolCall/);
    expect(section090).toMatch(/handleHermesPreVerify/);
    expect(section090).toMatch(/docs-hermes-shipped/i);
    expect(section090).toMatch(/marked \*\*Shipped\*\*/);
    expect(section090).toMatch(/packages\/ports\/hermes-agent\/package\.json/);
    expect(section090).toMatch(/packages\/cli\/README|cli README/i);
    expect(section090).toMatch(/HERMES_HOME/);
    expect(section090).toMatch(/pre_verify|max_verify_nudges|0\.21\.3/);
    expect(section090).toMatch(
      /Silence `\{\}`|allow \/ hard-stop \*\*`\{\}`\*\*|allow \/ hard-stop \*\*`\{\}`/,
    );
    expect(section090).toMatch(
      /waive live → degraded \+ human R1 ack|waive → degraded \+ R1|Waive live → degraded \+ explicit R1/i,
    );
    expect(section090).toMatch(
      /mid-cutoff recovery via \*\*pending \/ RESUME \/ nudge\*\*|machine-wide home trust/,
    );
    expect(section090).toMatch(/Hermes\+Claude|Hermes Agent \+ Claude/i);
    expect(section090).toMatch(/no `pre_tool_call`|explicitly \*\*no `pre_tool_call`|no pre_tool_call/i);
    expect(section090).toMatch(/relative command|relative `node/i);
    expect(section090).toMatch(/accept-hooks|HERMES_ACCEPT_HOOKS|consent/i);
    expect(section090).toMatch(/hermes hooks doctor/i);
    expect(section090).toMatch(
      /timeout omit\/&lt;120 \(host default 60s; \*\*not\*\* Codex-style/,
    );
    expect(section090).toMatch(/nudge missing\/still 3\/&lt;32/);
    expect(section090).toMatch(/Factory\/Hermes cross-fire|Gemini\/Factory\/Hermes cross-fire|nine-host|Nine-way|nine-way/i);
    expect(section090).toMatch(/nine-way|Nine-way/i);
    expect(section090).toMatch(/hermes-agent/);
    expect(section090).toMatch(
      /core\s*→\s*i18n\s*→\s*ports[\s\S]*hermes-agent[\s\S]*→\s*cli|ports \(cursor, claude-code, codex, kimi-code, copilot-cli, grok-build, gemini-cli, factory-droid, hermes-agent\)/i,
    );
    expect(section090).toMatch(/pnpm publish|pnpm pack/i);
    expect(section090).toMatch(/1 \(next\)[\s\S]{0,80}Antigravity/);
    const section010 = changelogSection(log, "0.10.0");
    expect(section010).toMatch(/docs-antigravity-shipped/i);
    expect(section010).toMatch(/handleAntigravityPreInvocation/);
    expect(section010).toMatch(/handleAntigravityPostToolUse/);
    expect(section010).toMatch(/handleAntigravityStop/);
    expect(section010).toMatch(/port-antigravity|@autopilot-harness\/port-antigravity/i);
    expect(section010).toMatch(/ten-way|Ten-way/i);
    expect(section010).toMatch(/\.agents\/hooks\.json/);
    expect(section010).toMatch(/\.agents\/skills/);
    expect(section010).toMatch(/decision:"continue"|decision:continue/);
    expect(section010).toMatch(/degraded/);
    expect(section010).toMatch(/OAuth-blocked/);
    expect(section010).toMatch(/unproven/i);
    expect(section010).toMatch(/human gate/i);
    expect(section010).toMatch(/OpenCode/);
    expect(section010).toMatch(/dual Antigravity\+Gemini/i);
    expect(section010).toMatch(/\.gemini\/skills/);
    expect(section010).toMatch(/\.factory\/skills/);
    expect(section010).toMatch(/\$HERMES_HOME\/skills|HERMES_HOME\/skills/);
    expect(section010).toMatch(/Shipped \(degraded/);
    expect(section010).toMatch(/packages\/ports\/antigravity\/package\.json/);
    expect(section010).toMatch(/Silence `\{\}`|allow \/ no-op \*\*`\{\}`\*\*/);
    expect(section010).toMatch(/fullyIdle/);
    expect(section010).toMatch(/transcriptPath/);
    expect(section010).toMatch(/auto-attach ≠ Autopilot ON|auto-attach ≠ ON/i);
    expect(section010).toMatch(/does not write `\.agent\/`/);
    expect(section010).toMatch(
      /core\s*→\s*i18n\s*→\s*ports[\s\S]*antigravity[\s\S]*→\s*cli|ports \(cursor, claude-code, codex, kimi-code, copilot-cli, grok-build, gemini-cli, factory-droid, hermes-agent, antigravity\)/i,
    );
    expect(section010).toMatch(/pnpm publish|pnpm pack/i);
    expect(section010).toMatch(/1 \(next\)[\s\S]{0,80}OpenCode/);
    const section0101 = changelogSection(log, "0.10.1");
    expect(section0101).toMatch(/NO_TOOL_CALL/);
    expect(section0101).toMatch(/transcript_full\.jsonl/);
    expect(section0101).toMatch(/\.agents\/bin|shim/i);
    expect(section0101).toMatch(/live-proved|0\.10\.1/);
    expect(section0101).toMatch(/pnpm publish|pnpm pack/i);
    const section012 = changelogSection(log, "0.12.0");
    expect(section012).toMatch(/port-runner|@autopilot-harness\/port-runner/i);
    expect(section012).toMatch(/Shipped \(meta\)|Runner \(meta\)/i);
    expect(section012).toMatch(/runner start|runner\.command/i);
    expect(section012).toMatch(/one_executor/);
    expect(section012).toMatch(/--on[\s\S]{0,40}deferred|deferred[\s\S]{0,40}--on/i);
    expect(section012).toMatch(/skip 0\.11|跳过 0\.11|skip 0\.11\.x/i);
    expect(section012).toMatch(/OpenCode/);
    expect(section012).toMatch(
      /ports[\s\S]*runner[\s\S]*→\s*cli|ports \(cursor[\s\S]*runner\)/i,
    );
    expect(section012).toMatch(/pnpm publish|pnpm pack/i);
    expect(log).not.toMatch(/## \[0\.11(\.\d+)?\]/);
    const unreleased = changelogSection(log, "Unreleased");
    expect(unreleased).not.toMatch(/docs-copilot-shipped/i);
    expect(unreleased).not.toMatch(/handleCopilot/i);
    expect(unreleased).not.toMatch(/docs-kimi-shipped/i);
    expect(unreleased).not.toMatch(/docs-grok-shipped/i);
    expect(unreleased).not.toMatch(/handleGrok/i);
    expect(unreleased).not.toMatch(/docs-gemini-shipped/i);
    expect(unreleased).not.toMatch(/handleGemini/i);
    expect(unreleased).not.toMatch(/docs-factory-shipped/i);
    expect(unreleased).not.toMatch(/handleFactory/i);
    expect(unreleased).not.toMatch(/docs-hermes-shipped/i);
    expect(unreleased).not.toMatch(/handleHermes/i);
    expect(unreleased).not.toMatch(/docs-antigravity-shipped/i);
    expect(unreleased).not.toMatch(/handleAntigravity/i);
    expect(unreleased).not.toMatch(/docs-runner-shipped/i);
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
      /Cursor, Claude Code, Codex, Kimi Code, Copilot CLI, Grok Build, Gemini CLI, Factory Droid, Hermes Agent, Antigravity, and Runner/,
    );
    const cliPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "packages/cli/package.json"), "utf8"),
    ) as { description?: string; keywords?: string[] };
    expect(cliPkg.description).toMatch(
      /Cursor, Claude Code, Codex, Kimi Code, Copilot CLI, Grok Build, Gemini CLI, Factory Droid, Hermes Agent, Antigravity, and Runner/,
    );
    expect(cliPkg.keywords).toEqual(
      expect.arrayContaining([
        "cursor",
        "claude-code",
        "codex",
        "kimi-code",
        "copilot-cli",
        "grok-build",
        "gemini-cli",
        "factory-droid",
        "hermes-agent",
        "antigravity",
        "runner",
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
    const grokPkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages/ports/grok-build/package.json"),
        "utf8",
      ),
    ) as { description?: string; private?: boolean };
    expect(grokPkg.private).not.toBe(true);
    expect(grokPkg.description).toMatch(/Grok Build/i);
    expect(grokPkg.description).toMatch(/degraded Stop/i);
    expect(grokPkg.description).not.toMatch(/Coming v0\.6\b/);
    const geminiPkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages/ports/gemini-cli/package.json"),
        "utf8",
      ),
    ) as { description?: string; private?: boolean };
    expect(geminiPkg.private).not.toBe(true);
    expect(geminiPkg.description).toMatch(/Gemini CLI/i);
    expect(geminiPkg.description).toMatch(/MAX_TURNS|turn cap/i);
    expect(geminiPkg.description).not.toMatch(/Coming v0\.7\b/);
    const factoryPkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages/ports/factory-droid/package.json"),
        "utf8",
      ),
    ) as { description?: string; private?: boolean };
    expect(factoryPkg.private).not.toBe(true);
    expect(factoryPkg.description).toMatch(/Factory Droid/i);
    expect(factoryPkg.description).toMatch(/multi-block/i);
    expect(factoryPkg.description).toMatch(/degraded/i);
    expect(factoryPkg.description).not.toMatch(/Coming v0\.8\b/);
    const hermesPkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages/ports/hermes-agent/package.json"),
        "utf8",
      ),
    ) as { description?: string; private?: boolean };
    expect(hermesPkg.private).not.toBe(true);
    expect(hermesPkg.description).toMatch(/Hermes Agent/i);
    expect(hermesPkg.description).toMatch(/pre_llm_call|pre_verify/i);
    expect(hermesPkg.description).not.toMatch(/Coming v0\.9\b/);
    const antigravityPkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages/ports/antigravity/package.json"),
        "utf8",
      ),
    ) as { description?: string; private?: boolean };
    expect(antigravityPkg.private).not.toBe(true);
    expect(antigravityPkg.description).toMatch(/Antigravity/i);
    expect(antigravityPkg.description).toMatch(
      /PreInvocation|injectSteps|fullyIdle/i,
    );
    expect(antigravityPkg.description).not.toMatch(/Coming v0\.10\b/);
    const runnerPkg = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages/ports/runner/package.json"),
        "utf8",
      ),
    ) as { description?: string; private?: boolean; publishConfig?: { access?: string } };
    expect(runnerPkg.private).not.toBe(true);
    expect(runnerPkg.publishConfig?.access).toBe("public");
    expect(runnerPkg.description).toMatch(/runner|external process/i);
    expect(runnerPkg.description).not.toMatch(/Coming v0\.4/);
    expect(runnerPkg.description).not.toMatch(/Coming v0\.11\b/);
  });
});
