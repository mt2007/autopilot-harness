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
  /** 0 = unlimited (default). */
  maxErrorsBeforePause?: number;
  /** executing_only | project */
  reviewScope?: "executing_only" | "project";
}): string {
  const plansNorm = normalizePlansDir(opts.plansDir);
  const plansDir = plansNorm.ok ? plansNorm.value : "plans";
  const verifyEnabled = Boolean(opts.verifyEnabled);
  const maxErrors =
    typeof opts.maxErrorsBeforePause === "number" &&
    Number.isInteger(opts.maxErrorsBeforePause) &&
    opts.maxErrorsBeforePause >= 0
      ? opts.maxErrorsBeforePause
      : 0;
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
  # executing_only = self-review only after Autopilot RUN; project = any product-code edit
  scope: ${opts.reviewScope ?? "executing_only"}
  # 5 = full lenses; 3 = light mode (lenses 1→2→5 only)
  confirm_rounds: 5
  verify:
    enabled: ${verifyEnabled}
    # When enabled, Agent runs these and writes .autopilot/verify-last.json:
    # commands:
    #   - id: test
    #     run: "pnpm test"
    #     required: true
  stuck:
    max_idle_stops: 5
  errors:
    # Consecutive turn errors/aborts before pause (repeated_errors).
    # 0 = never pause (unlimited recoveries); e.g. 5 = pause after 5.
    max_before_pause: ${maxErrors}

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
