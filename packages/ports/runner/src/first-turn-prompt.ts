import type { ChecklistItem } from "@autopilot-harness/core";

/** Condensed executing workflow (English stock; followups use ReviewEngine locale). */
export const RUNNER_EXECUTING_SUMMARY = `Implement only the current unchecked checklist item (align with plan.md).
When required, write .autopilot/verify-last.json with matching itemId (and ok: true for hand-written reports).
End the turn by exiting the agent process so the Runner can inject the next fix/confirm/advance tip.
Do not invent Advance/Done; do not commit/push unless an Advance/Done tip explicitly asks for a local commit.
Follow only the next Runner-injected message for review lenses.`;

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
