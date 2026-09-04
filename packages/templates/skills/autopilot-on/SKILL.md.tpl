---
name: autopilot-on
description: "{{description}}"
---

The submit hook has already set phase=planning for this conversation.

Follow **autopilot-planning** workflow (docs/autopilot/workflows/autopilot-planning.md).

- initial_brief from text after /autopilot-on → seed Round 1
- Optional slug: alone after the command, or after `·`, matching `[a-z0-9]+([.-][a-z0-9]+)*` and ≤128 chars (same as RUN); other text is initial_brief. Unsafe explicit slugs (e.g. from API) are rejected by the hook.
- Look up repo facts with platform tools; do not ask the user for what you can inspect
- Write plans/<slug>/ artifacts (slug rule above); no product code until /autopilot-run
- User-visible replies must match the user's language
