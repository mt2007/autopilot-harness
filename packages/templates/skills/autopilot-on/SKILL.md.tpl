---
name: autopilot-on
description: "{{description}}"
---

The submit hook has already set phase=planning for this conversation.

Follow **autopilot-planning** workflow (docs/autopilot/workflows/autopilot-planning.md).

- initial_brief from text after /autopilot-on → seed Round 1
- Look up repo facts with platform tools; do not ask the user for what you can inspect
- Write plans/<slug>/ artifacts; no product code until /autopilot-run
- User-visible replies must match the user's language
