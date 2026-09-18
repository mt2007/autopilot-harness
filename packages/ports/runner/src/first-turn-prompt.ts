import {
  isSafeTrackSlug,
  type ChecklistItem,
} from "@autopilot-harness/core";

/** Condensed executing workflow (English stock; followups use ReviewEngine locale). */
export const RUNNER_EXECUTING_SUMMARY = `Implement only the current unchecked checklist item (align with plan.md).
When required, write .autopilot/verify-last.json with matching itemId (and ok: true for hand-written reports).
End the turn by exiting the agent process so the Runner can inject the next fix/confirm/advance tip.
Do not invent Advance/Done; do not commit/push unless an Advance/Done tip explicitly asks for a local commit.
Follow only the next Runner-injected message for review lenses.`;

/** Condensed planning workflow (English stock; from autopilot-planning.md). */
export const RUNNER_PLANNING_SUMMARY = `Follow the Autopilot planning / grill workflow.
Open each round with a Round heading; number questions globally (Q1, Q2, … — do not restart at Q1).
Write plans/<slug>/brief.md, plan.md, and checklist.md when ready; update plans/README.md.
Planning may edit plans/** and docs only — no product code until /autopilot-run (or runner start --run).
User-visible replies must match the user's language.
End the turn by exiting the agent process so the Runner can continue (pending tip or a later start with --message).
Do not invent Advance/Done; do not start checklist execution in planning.`;

/**
 * First-turn prompt after `--run` when there is no pending followup.
 */
export function buildFirstTurnPrompt(opts: {
  slug: string;
  item: ChecklistItem;
}): string {
  const title = opts.item.title?.trim() || opts.item.id;
  return [
    "[Autopilot Runner — executing]",
    "",
    `Track: ${opts.slug}`,
    `Current item: ${opts.item.id} — ${title}`,
    "",
    RUNNER_EXECUTING_SUMMARY,
    "",
    "Rules: implement only this item; write verify-last.json when required; end the turn",
    "(exit the agent process). Do not invent Advance/Done — wait for the next Runner inject.",
  ].join("\n");
}

export interface BuildPlanningFirstTurnPromptOpts {
  /** Bound or explicit track slug when known. */
  slug?: string;
  /** Initial brief from `--brief` / parseSlugAndBrief (not persisted in session). */
  brief?: string;
  /** User turn from `--message` (grill answer / continuation). */
  message?: string;
}

function isPlainOpts(
  v: unknown,
): v is BuildPlanningFirstTurnPromptOpts {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v)
  );
}

/**
 * First-turn (or resume) prompt for `phase=planning` when there is no pending tip.
 */
export function buildPlanningFirstTurnPrompt(
  opts?: BuildPlanningFirstTurnPromptOpts | null,
): string {
  const o = isPlainOpts(opts) ? opts : {};
  const rawSlug = typeof o.slug === "string" ? o.slug.trim() : "";
  // Never echo unsafe/path-like slugs into the agent prompt (trust boundary).
  const slug = rawSlug && isSafeTrackSlug(rawSlug) ? rawSlug : "";
  const brief = typeof o.brief === "string" ? o.brief.trim() : "";
  const message = typeof o.message === "string" ? o.message.trim() : "";

  const lines: string[] = [
    "[Autopilot Runner — planning]",
    "",
  ];

  if (slug) {
    lines.push(`Track: ${slug}`, "");
  } else {
    lines.push(
      "Track: (unset — pick a safe slug when writing plans/<slug>/)",
      "",
    );
  }

  if (brief) {
    lines.push("Initial brief:", brief, "");
  }

  if (message) {
    lines.push("User message:", message, "");
  } else {
    lines.push(
      "No new user message this turn — continue from existing plans/ artifacts",
      "(advance the grill frontier or finalize brief/plan/checklist). Do not pretend",
      "the user answered in chat; use --message on the next runner start for replies.",
      "",
    );
  }

  lines.push(
    RUNNER_PLANNING_SUMMARY,
    "",
    "Rules: planning only (plans/** + docs); exit the agent process when the turn ends.",
    "Full oral grill is better on a hook host; Runner uses --brief / --message between starts.",
  );

  return lines.join("\n");
}
