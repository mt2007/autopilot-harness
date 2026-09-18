import {
  countUnchecked,
  isSafeTrackSlug,
  normalizeProjectRoot,
  parseChecklist,
  type StateStore,
} from "@autopilot-harness/core";
import { resolveChecklistPathInProject } from "./command-template.js";

/** Idle / missing-session hint: planning flags + executing --run. */
export const RUNNER_RESUME_START_HINT =
  "npx @autopilot-harness/cli runner start --on [--brief ...] [--message ...] or --run <slug>";

export type ResumeDecision =
  | { ok: true; reason: "pending" | "planning" | "executing" }
  | { ok: false; reason: "missing" | "paused" | "idle"; message: string };

/**
 * Whether `runner start` may continue without `--run` / `--on` (research §5).
 * When there is no pending tip, gates must match first-turn prompt builders
 * so resume never ok-then-throw: planning needs only unpaused phase;
 * executing needs track + in-project checklist + unchecked item.
 */
export function canResumeRunnerSession(
  store: StateStore,
  conversationId: string,
  projectRoot: string,
): ResumeDecision {
  if (!store.isConversationIdOk(conversationId)) {
    return {
      ok: false,
      reason: "missing",
      message: "Invalid conversation id.",
    };
  }
  const session = store.getSession(conversationId);
  if (!session) {
    return {
      ok: false,
      reason: "missing",
      message: `No runner session. Start with: ${RUNNER_RESUME_START_HINT}`,
    };
  }
  if (session.paused !== 0) {
    return {
      ok: false,
      reason: "paused",
      message:
        "Runner session is paused. Use Autopilot OFF / RESUME (or session tools) before starting again.",
    };
  }

  const chain = store.getReviewChain(conversationId);
  const pending = chain?.pending_followup?.trim() ?? "";
  if (pending) {
    return { ok: true, reason: "pending" };
  }

  if (session.phase === "planning") {
    return { ok: true, reason: "planning" };
  }

  if (session.phase === "executing") {
    const root =
      normalizeProjectRoot(store.projectRoot) ??
      normalizeProjectRoot(projectRoot);
    const slug = session.track_id?.trim() ?? "";
    const checklistPath = session.checklist_path?.trim() ?? "";
    if (!root || !slug || !checklistPath) {
      return {
        ok: false,
        reason: "idle",
        message: `Cannot resume: missing track or checklist path. Start with: ${RUNNER_RESUME_START_HINT}`,
      };
    }
    if (!isSafeTrackSlug(slug)) {
      return {
        ok: false,
        reason: "idle",
        message: `Unsafe track slug in session: "${slug.slice(0, 64)}"`,
      };
    }
    try {
      const abs = resolveChecklistPathInProject(root, checklistPath);
      if (!abs) {
        return {
          ok: false,
          reason: "idle",
          message: `Checklist not found or outside project. Start with: ${RUNNER_RESUME_START_HINT}`,
        };
      }
      const cl = parseChecklist(abs, { projectRoot: root });
      if (countUnchecked(cl) > 0) {
        return { ok: true, reason: "executing" };
      }
      return {
        ok: false,
        reason: "idle",
        message: `Track has no unchecked items. Start with: ${RUNNER_RESUME_START_HINT}`,
      };
    } catch {
      return {
        ok: false,
        reason: "idle",
        message: `Cannot read checklist for resume. Start with: ${RUNNER_RESUME_START_HINT}`,
      };
    }
  }

  return {
    ok: false,
    reason: "idle",
    message: `Nothing to resume. Start with: ${RUNNER_RESUME_START_HINT}`,
  };
}
