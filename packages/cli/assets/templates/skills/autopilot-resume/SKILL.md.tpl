---
name: autopilot-resume
description: "{{description}}"
---

The submit hook has resumed Autopilot for **this** conversation (cleared pause if any; review chain preserved).

If this chat had no session, the hook may have **claimed** an executing track from another conversation (same project) onto this one — including when the old Cursor chat is dead/unreadable. Optional: `/autopilot-resume <slug>` to pick the track when several are executing.

Continue from checklist progress and current phase. Do not reset review confirm rounds unless asked.
