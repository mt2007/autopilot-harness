# Architecture

Autopilot Harness separates **core** (FSM, SQLite, checklist, review) from **ports** (Cursor, Claude Code, …).

```
packages/core          StateStore, ReviewEngine, ChecklistMd, triggers
packages/ports/cursor  beforeSubmitPrompt / afterFileEdit / stop adapters
packages/cli           npx autopilot-harness
packages/i18n          en + zh-CN (v0.1.0)
packages/templates     skills + planning/executing workflows
```

State lives in `.autopilot/state.db`. Progress authority is `plans/<slug>/checklist.md`.

See the v0.1 plan for full FSM (E2–E5 review chain, OFF/ON/RESUME side effects).
