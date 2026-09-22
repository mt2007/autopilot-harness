---
name: autopilot-diagnose
description: "{{description}}"
---

## Purpose

Read-only diagnosis when Autopilot looks stuck (review chain, pending followup, caps, status opacity).

This skill does **not** change Autopilot phase, does **not** arm/disarm, does **not** advance the checklist, and does **not** write product code. Prefer evidence from CLI outputs over guessing.

## Gate

1. **This turn is an explicit diagnose request** — user message is `/autopilot-diagnose` (or the host's skill attach for this skill), not a casual mention.
2. Stay **read-only** for Autopilot control plane: do not call submit actions that set phase; do not edit `.autopilot/state.db` by hand.

If the gate fails: explain how to invoke `/autopilot-diagnose`. User-visible replies must match the user's language.

## Steps

1. Resolve `<plansDir>` = `artifacts.plans_dir` from `.autopilot/config.yml` (do not assume a literal path).
2. Run `npx @autopilot-harness/cli status` and summarize phase, paused, armed, active slug, and any opaque/failed fields.
3. Prefer `npx @autopilot-harness/cli doctor` (or status lines that already surface caps) for config / skill / schema hints — read the printed lines; do not invent missing keys.
4. Check **pending followup / review** signals from status (pending action, confirm rounds, debounce). Quote what you see; do not invent a pending dump.
5. If a track slug is known, you may **read** `<plansDir>/<slug>/checklist.md` only to report sticky progress (open vs done counts). Do not mark items or rewrite the plan.
6. Report a short evidence-first conclusion: likely stuck point + next safe operator action — prefer documented commands such as `/autopilot-resume`, `/autopilot-replan`, `npx @autopilot-harness/cli upgrade`, `npx @autopilot-harness/cli session reset-review <id>`, or `npx @autopilot-harness/cli session purge <id>`. **Do not** promise raw `state.db` surgery.
7. Stop. No product-code edits. User-visible replies must match the user's language.
