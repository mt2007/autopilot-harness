import { stockTriggers } from "@autopilot-harness/i18n";
import type { InitLocale } from "./types.js";
import {
  mergePlatformBindings,
  mergedIncludesAllRequested,
  normalizeBinding,
  isInstallableBinding,
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
  /** project (default) | executing_only */
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
  const triggers = stockTriggers(opts.locale);
  const on = JSON.stringify(triggers.on);
  const run = JSON.stringify(triggers.run);
  const off = JSON.stringify(triggers.off);
  const resume = JSON.stringify(triggers.resume);
  const replan = JSON.stringify(triggers.replan);
  const resumeReview = JSON.stringify(triggers.resume_review);
  const reviewScope =
    opts.reviewScope === "executing_only" ? "executing_only" : "project";

  return `# Autopilot Harness — project config (init defaults)
# Enabled hosts (id + surface). surface: ide | cli | runner
# Primary = first installable binding in this list (no separate platform/surface keys).
${formatPlatformsYamlBlock(platforms)}
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
  # project = any product-code edit (default); executing_only = only after Autopilot RUN
  scope: ${reviewScope}
  # 5 = full lenses; 3 = light mode (lenses 1→2→5 only)
  # Kimi Code hard-caps Stop-continue at 1/turn — use 1 when that installable host is enabled.
  confirm_rounds: ${platforms.some((b) => isInstallableBinding(b) && b.id === "kimi-code") ? 1 : 5}
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

runner:
  # Required for autopilot-harness runner start — set a real agent CLI template
  # (no fake default). Examples ({prompt} = tip argv; {prompt_file} = path the CLI must read):
  # command: "claude -p {prompt}"
  # command: "codex exec -- {prompt}"
  max_iterations: 32
  # prompt_mode: auto   # argv | file | auto
`;
}
