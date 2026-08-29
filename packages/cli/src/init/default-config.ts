import { stockTriggers } from "@autopilot-harness/i18n";
import type { InitLocale } from "./types.js";
import { normalizePlansDir } from "./wizard-helpers.js";

/** Default `.autopilot/config.yml` body for init (v0.1). */
export function defaultConfigYaml(opts: {
  platform: string;
  surface: string;
  locale: InitLocale;
  plansDir?: string;
  verifyEnabled?: boolean;
}): string {
  const plansNorm = normalizePlansDir(opts.plansDir);
  const plansDir = plansNorm.ok ? plansNorm.value : "plans";
  const verifyEnabled = Boolean(opts.verifyEnabled);
  const triggers = stockTriggers(opts.locale);
  const on = JSON.stringify(triggers.on);
  const run = JSON.stringify(triggers.run);
  const off = JSON.stringify(triggers.off);
  const resume = JSON.stringify(triggers.resume);
  const replan = JSON.stringify(triggers.replan);
  const resumeReview = JSON.stringify(triggers.resume_review);

  return `# Autopilot Harness — project config (init defaults)
platform: ${opts.platform}
surface: ${opts.surface}
integration: hook
locale: ${opts.locale}

artifacts:
  plans_dir: ${plansDir}
  files:
    brief: brief.md
    plan: plan.md
    checklist: checklist.md

cli:
  preferred_name: Autopilot

session:
  stale_after_hours: 72

concurrency:
  mode: one_executor
  worktree: false
  worktrees_dir: .autopilot/worktrees

review:
  confirm_rounds: 5
  verify:
    enabled: ${verifyEnabled}
  stuck:
    max_idle_stops: 5

triggers:
  match: line_start
  on: ${on}
  run: ${run}
  off: ${off}
  resume: ${resume}
  replan: ${replan}
  resume_review: ${resumeReview}

security:
  require_token: false
`;
}
