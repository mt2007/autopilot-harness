import { stockTriggers } from "@autopilot-harness/i18n";
import type { InitLocale } from "./types.js";
import {
  mergePlatformBindings,
  mergedIncludesAllRequested,
  normalizeBinding,
  primaryBinding,
  MAX_PLATFORM_BINDINGS,
  type PlatformBinding,
} from "./platforms.js";
import { normalizePlansDir } from "./wizard-helpers.js";

function resolveConfigPlatforms(opts: {
  platform?: string;
  surface?: string;
  platforms?: readonly PlatformBinding[];
}): PlatformBinding[] {
  if (opts.platforms && opts.platforms.length > 0) {
    const list = mergePlatformBindings([], opts.platforms);
    if (!mergedIncludesAllRequested(list, opts.platforms)) {
      throw new Error(
        `platforms list exceeds cap of ${MAX_PLATFORM_BINDINGS} unique entries; trim the list and retry`,
      );
    }
    return list;
  }
  const b = normalizeBinding(opts.platform ?? "cursor", opts.surface ?? "ide");
  return b ? [b] : [{ id: "cursor", surface: "ide" }];
}

function formatPlatformsYamlBlock(platforms: readonly PlatformBinding[]): string {
  const lines = ["platforms:"];
  for (const b of platforms) {
    lines.push(`  - id: ${b.id}`);
    lines.push(`    surface: ${b.surface}`);
  }
  return lines.join("\n");
}

/** Default `.autopilot/config.yml` body for init (v0.1). */
export function defaultConfigYaml(opts: {
  platform?: string;
  surface?: string;
  /** Preferred over legacy platform/surface when non-empty. */
  platforms?: readonly PlatformBinding[];
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
  const platforms = resolveConfigPlatforms(opts);
  const primary = primaryBinding(platforms);
  const triggers = stockTriggers(opts.locale);
  const on = JSON.stringify(triggers.on);
  const run = JSON.stringify(triggers.run);
  const off = JSON.stringify(triggers.off);
  const resume = JSON.stringify(triggers.resume);
  const replan = JSON.stringify(triggers.replan);
  const resumeReview = JSON.stringify(triggers.resume_review);

  return `# Autopilot Harness — project config (init defaults)
# Enabled hosts (id + surface). surface: ide | cli | runner
${formatPlatformsYamlBlock(platforms)}
# Primary host (installable preferred) — kept for older readers
platform: ${primary.id}
surface: ${primary.surface}
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
