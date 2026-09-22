---
name: autopilot-archive
description: "{{description}}"
---

## Purpose

Merge this track's **`## Behavior deltas`** (from its `brief.md`) into cross-track behavior specs under **`artifacts.specs_dir`** in `.autopilot/config.yml` (new-init default: `docs/autopilot/specs`).

This skill is **optional** (suggest only — never required). It does **not** change Autopilot phase, does **not** advance the checklist, and does **not** arm a new review chain by itself.

## Gate

Before writing under `specs_dir`, confirm:

1. **`artifacts.specs_dir` is configured** in `.autopilot/config.yml` (non-empty, valid in-project path). If unset/invalid, stop — explain that archive needs `specs_dir`; do not invent a path.
2. **This turn is an explicit archive request** — user message is `/autopilot-archive` (or the host's skill attach for this skill), not a casual mention.

If the gate fails: do not edit specs; reply how to configure `artifacts.specs_dir` or invoke `/autopilot-archive`. User-visible replies must match the user's language.

## Steps

1. Resolve `<plansDir>` = `artifacts.plans_dir` and `<specsDir>` = `artifacts.specs_dir` from config (do not assume literal `plans/` or `docs/autopilot/specs`).
2. Identify the active track slug (status / session / user-provided). Read `<plansDir>/<slug>/brief.md`.
3. If there is **no** `## Behavior deltas` section (or it is empty): say so and stop — **do not** invent deltas; **do not** rewrite specs.
4. Choose domain file(s) under `<specsDir>/` (e.g. `review.md`, `init.md`) by topic. Create the file if missing (keep a short heading). Prefer merging into existing domain docs over one mega-file.
5. Merge each delta as durable behavior truth (ADDED / MODIFIED / REMOVED). Deduplicate. Do **not** copy track checklist progress or ephemeral implementation notes.
6. Stay inside `<specsDir>/**` (and optionally a one-line note in the brief that archive ran). **No product code.** `.autopilotignore` should already cover `specs_dir` so these edits do not arm product-code self-review.
7. Summarize which files changed. User-visible replies must match the user's language.
