import {
  applyRun,
  firstUnchecked,
  isHarnessFollowupMessage,
  isSafeTrackSlug,
  loadProjectReviewConfig,
  normalizeProjectRoot,
  parseChecklist,
  sessionReviewRunnable,
  type FollowupLocaleBundle,
  type PhaseActionConfig,
  type StateStore,
} from "@autopilot-harness/core";
import type { RunnerConfig } from "./config.js";
import { RUNNER_PLATFORM, assertRunnerCommand } from "./config.js";
import { CliDriver } from "./cli-driver.js";
import { resolveChecklistPathInProject } from "./command-template.js";
import type { AgentDriver } from "./driver.js";
import { driverResultToStopStatus } from "./driver.js";
import { buildFirstTurnPrompt } from "./first-turn-prompt.js";
import { canResumeRunnerSession } from "./resume.js";
import {
  runStopTick,
  shouldContinueAfterStop,
} from "./stop-tick.js";

export type RunnerLoopOutcome =
  | "completed"
  | "budget_exhausted"
  | "stopped"
  | "error";

export interface RunnerLoopResult {
  outcome: RunnerLoopOutcome;
  iterations: number;
  conversationId: string;
  lastMessage?: string;
  errorMessage?: string;
}

export interface RunRunnerLoopOptions {
  store: StateStore;
  projectRoot: string;
  conversationId: string;
  config: RunnerConfig;
  /** When set, applyRun before the loop (fresh start). */
  runSlug?: string;
  phaseActions?: PhaseActionConfig;
  /** Override driver (tests). Default: CliDriver when command set. */
  driver?: AgentDriver;
  localeBundle?: FollowupLocaleBundle;
  /** Called before each agent turn with the prompt that will be sent. */
  onPrompt?: (prompt: string, iteration: number) => void;
  /** Override Stop tick (tests). Default: runStopTick. */
  stopTick?: typeof runStopTick;
}

function resolveInitialPrompt(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): string {
  const chain = store.getReviewChain(conversationId);
  const pending = chain?.pending_followup?.trim() ?? "";
  if (pending) return pending;

  const session = store.getSession(conversationId);
  const slug = session?.track_id?.trim() ?? "";
  const root =
    normalizeProjectRoot(store.projectRoot) ??
    normalizeProjectRoot(projectRoot);
  const checklistPath = session?.checklist_path?.trim();
  if (!root || !slug || !checklistPath) {
    throw new Error(
      "Cannot build first-turn prompt: missing track or checklist path.",
    );
  }
  if (!isSafeTrackSlug(slug)) {
    throw new Error(`Unsafe track slug in session: "${slug.slice(0, 64)}"`);
  }
  const abs = resolveChecklistPathInProject(root, checklistPath);
  if (!abs) {
    throw new Error(`Checklist not found or outside project: ${checklistPath}`);
  }
  const cl = parseChecklist(abs, { projectRoot: root });
  const item = firstUnchecked(cl);
  if (!item) {
    throw new Error(`No unchecked items in track "${slug}".`);
  }
  return buildFirstTurnPrompt({ slug, item });
}

/**
 * External Autopilot loop: spawn agent → handleStop → re-inject tip / stop.
 */
export async function runRunnerLoop(
  opts: RunRunnerLoopOptions,
): Promise<RunnerLoopResult> {
  const root =
    normalizeProjectRoot(opts.projectRoot) ??
    normalizeProjectRoot(opts.store.projectRoot);
  if (!root) {
    return {
      outcome: "error",
      iterations: 0,
      conversationId: opts.conversationId,
      errorMessage: "Invalid project root.",
    };
  }
  if (!opts.store.isConversationIdOk(opts.conversationId)) {
    return {
      outcome: "error",
      iterations: 0,
      conversationId: opts.conversationId,
      errorMessage: "Invalid conversation id.",
    };
  }

  const driver =
    opts.driver ??
    (() => {
      assertRunnerCommand(opts.config);
      return new CliDriver(opts.config);
    })();

  if (opts.runSlug !== undefined) {
    const runResult = applyRun(opts.store, opts.conversationId, root, {
      slug: opts.runSlug === "" ? undefined : opts.runSlug,
      config: opts.phaseActions,
      platform: RUNNER_PLATFORM,
    });
    if (!runResult.ok) {
      return {
        outcome: "error",
        iterations: 0,
        conversationId: opts.conversationId,
        errorMessage: runResult.userMessage,
      };
    }
  } else {
    const resume = canResumeRunnerSession(
      opts.store,
      opts.conversationId,
      root,
    );
    if (!resume.ok) {
      return {
        outcome: "error",
        iterations: 0,
        conversationId: opts.conversationId,
        errorMessage: resume.message,
      };
    }
  }

  let prompt: string;
  try {
    prompt = resolveInitialPrompt(opts.store, opts.conversationId, root);
  } catch (err) {
    return {
      outcome: "error",
      iterations: 0,
      conversationId: opts.conversationId,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  const max = opts.config.maxIterations;
  let lastMessage = prompt;
  const reviewScope = loadProjectReviewConfig(root).reviewScope;

  for (let i = 0; i < max; i += 1) {
    opts.onPrompt?.(prompt, i);
    let driverResult;
    try {
      driverResult = await driver.run({
        prompt,
        iteration: i,
        conversationId: opts.conversationId,
        projectRoot: root,
      });
    } catch (err) {
      return {
        outcome: "error",
        iterations: i + 1,
        conversationId: opts.conversationId,
        lastMessage: prompt,
        errorMessage:
          err instanceof Error
            ? err.message
            : `Agent spawn failed: ${String(err)}`,
      };
    }

    const status = driverResultToStopStatus(driverResult);
    const tick = opts.stopTick ?? runStopTick;
    let action;
    try {
      ({ action } = tick(
        opts.store,
        root,
        {
          conversationId: opts.conversationId,
          status,
          loopCount: i,
        },
        opts.localeBundle,
      ));
    } catch (err) {
      // Agent turn already finished — return structured error so callers can
      // resume (pending / dirty tree) instead of an unhandled rejection.
      return {
        outcome: "error",
        iterations: i + 1,
        conversationId: opts.conversationId,
        lastMessage: prompt,
        errorMessage:
          err instanceof Error
            ? err.message
            : `Stop tick failed: ${String(err)}`,
      };
    }

    if (shouldContinueAfterStop(action)) {
      prompt = action.message.trim();
      lastMessage = prompt;
      continue;
    }

    // Explicit one-shot halt (loop:false) — do not redeliver pending in this start.
    if (action && action.loop === false) {
      return {
        outcome: "stopped",
        iterations: i + 1,
        conversationId: opts.conversationId,
        lastMessage: action.message,
      };
    }

    const session = opts.store.getSession(opts.conversationId);
    const chain = opts.store.getReviewChain(opts.conversationId);
    let pending = chain?.pending_followup?.trim() ?? "";
    const runnable = Boolean(
      session && sessionReviewRunnable(session, reviewScope),
    );
    // No transcript_path: ReviewEngine will not clear "delivered" pending
    // (tryRedeliverPending skips; pendingBlocksAdvance fails open). Runner
    // injected lastMessage as the agent prompt — ack matching *harness*
    // followup only while still runnable (disarmed/paused must keep pending
    // for a later resume; never clear unrelated pending text).
    if (
      pending &&
      pending === lastMessage &&
      isHarnessFollowupMessage(pending) &&
      runnable
    ) {
      try {
        opts.store.clearPendingFollowupIf(
          opts.conversationId,
          (m) => m.trim() === pending,
        );
      } catch {
        /* best-effort */
      }
      pending =
        opts.store.getReviewChain(opts.conversationId)?.pending_followup?.trim() ??
        "";
    }
    // Null action + a *different* live pending: redeliver while still runnable.
    if (pending && pending !== lastMessage && runnable) {
      prompt = pending;
      lastMessage = pending;
      continue;
    }
    if (pending) {
      return {
        outcome: "stopped",
        iterations: i + 1,
        conversationId: opts.conversationId,
        lastMessage: pending,
      };
    }
    if (session?.phase === "done" || session?.phase === "idle") {
      return {
        outcome: "completed",
        iterations: i + 1,
        conversationId: opts.conversationId,
        lastMessage: action?.message,
      };
    }
    // No loop tip — stop cleanly (item may still be mid-flight without pending).
    return {
      outcome: "stopped",
      iterations: i + 1,
      conversationId: opts.conversationId,
      lastMessage: action?.message ?? lastMessage,
    };
  }

  return {
    outcome: "budget_exhausted",
    iterations: max,
    conversationId: opts.conversationId,
    lastMessage,
  };
}
