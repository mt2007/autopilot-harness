import type { InitLocale } from "./types.js";

/** Default `.autopilot/config.yml` body for `init --yes` (v0.1). */
export function defaultConfigYaml(opts: {
  platform: string;
  surface: string;
  locale: InitLocale;
}): string {
  const onTriggers =
    opts.locale === "zh-CN"
      ? `["Autopilot ON", "开启自动驾驶"]`
      : `["Autopilot ON"]`;
  const runTriggers =
    opts.locale === "zh-CN"
      ? `["Autopilot RUN", "开始执行"]`
      : `["Autopilot RUN"]`;
  const offTriggers =
    opts.locale === "zh-CN"
      ? `["Autopilot OFF", "关闭自动驾驶"]`
      : `["Autopilot OFF"]`;
  const resumeTriggers =
    opts.locale === "zh-CN"
      ? `["Autopilot RESUME", "继续执行"]`
      : `["Autopilot RESUME"]`;
  const replanTriggers =
    opts.locale === "zh-CN"
      ? `["Autopilot REPLAN", "修改方案"]`
      : `["Autopilot REPLAN"]`;
  const resumeReviewTriggers =
    opts.locale === "zh-CN"
      ? `["继续自审", "Resume review"]`
      : `["Resume review"]`;

  return `# Autopilot Harness — project config (init --yes defaults)
platform: ${opts.platform}
surface: ${opts.surface}
integration: hook
locale: ${opts.locale}

artifacts:
  plans_dir: plans
  files:
    brief: brief.md
    plan: plan.md
    checklist: checklist.md

cli:
  preferred_name: Autopilot

concurrency:
  mode: one_executor
  worktree: false
  worktrees_dir: .autopilot/worktrees

review:
  confirm_rounds: 5
  verify:
    enabled: false
  stuck:
    max_idle_stops: 5

triggers:
  match: line_start
  on: ${onTriggers}
  run: ${runTriggers}
  off: ${offTriggers}
  resume: ${resumeTriggers}
  replan: ${replanTriggers}
  resume_review: ${resumeReviewTriggers}

security:
  require_token: false
`;
}

export const SKILL_DESCRIPTIONS: Record<string, string> = {
  "autopilot-on":
    "Start Autopilot planning: grill frontier, write plans/<slug> artifacts",
  "autopilot-run":
    "Enter Autopilot executing for a track checklist (after planning)",
  "autopilot-off": "Pause Autopilot (human gate) without wiping review state",
  "autopilot-resume": "Resume a paused Autopilot session in this conversation",
  "autopilot-replan":
    "Return to planning for the current track; reset review chain",
};
