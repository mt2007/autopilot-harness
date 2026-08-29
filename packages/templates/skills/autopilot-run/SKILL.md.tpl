---
name: autopilot-run
description: "{{description}}"
---

The submit hook has already set phase=executing (or will after track pick) for this conversation.

Follow **autopilot-executing** workflow (docs/autopilot/workflows/autopilot-executing.md).

- Read plans/<slug>/checklist.md; implement the first unchecked item
- Obey fix/confirm/advance followups from the stop hook
- User-visible replies must match the user's language
