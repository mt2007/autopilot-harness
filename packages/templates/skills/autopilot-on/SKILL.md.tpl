---
name: autopilot-on
description: "{{description}}"
---

## Gate: ON trigger or already planning

Do **not** assume the submit hook already set `phase=planning`. Casual chat or a misfired skill attach is **not** ON.

Track artifacts go under **`artifacts.plans_dir`** in `.autopilot/config.yml` (new-init default: `docs/autopilot/plans`). Below, `<plansDir>` means that configured directory — not necessarily the literal path `plans/`.

Before writing any `<plansDir>/` artifact or starting grill, confirm **either**:

1. **This turn is an ON trigger** — the **user message** is `/autopilot-on` (slash / explicit host skill command), **or** a line-start hit on a configured ON phrase (`triggers.on`, e.g. `Autopilot ON` / `开启自动驾驶`). Host **auto-attaching** this skill without that message does **not** count.
2. **Already planning** — this conversation is already `phase=planning` (confirm via `npx @autopilot-harness/cli status` or a known hook result).

If **neither** holds: do **not** follow **autopilot-planning**; do **not** write under `<plansDir>/`; do **not** start grilling; do **not** claim Autopilot is on. Reply normally, or briefly how to ON (slash + configured `triggers.on` phrases). User-visible replies must match the user's language. Stop.

If the gate passes:

Follow **autopilot-planning** workflow (docs/autopilot/workflows/autopilot-planning.md).

- initial_brief from text after /autopilot-on → seed Round 1
- Optional slug: alone after the command, or after `·`, matching `[a-z0-9]+([.-][a-z0-9]+)*` and ≤128 chars (same as RUN); other text is initial_brief. Unsafe explicit slugs (e.g. from API) are rejected by the hook.
- Look up repo facts with platform tools; do not ask the user for what you can inspect
- Write `<plansDir>/<slug>/` artifacts (slug rule above); no product code until /autopilot-run
- User-visible replies must match the user's language
