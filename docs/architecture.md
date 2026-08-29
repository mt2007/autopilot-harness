# Architecture

Autopilot Harness separates **core** (FSM, SQLite, checklist, review) from **ports** (Cursor, Claude Code, …).

```
packages/core          StateStore, ReviewEngine, project-config, checklist, triggers
packages/ports/cursor  beforeSubmitPrompt / afterFileEdit / stop adapters
packages/cli           npx autopilot-harness (init default config.yml lives here)
packages/i18n          en + zh-CN (v0.1.0)
packages/templates     skills (*.tpl) + planning/executing workflows
```

State lives in `.autopilot/state.db`. Progress authority is `plans/<slug>/checklist.md`.
The project Stop hook loads a bundled `vendor/runtime.mjs` (next to the hook) which reads
`.autopilot/config.yml` at runtime (`confirm_rounds`, verify, stuck, locale).

See the v0.1 plan for full FSM (E2–E5 review chain, OFF/ON/RESUME side effects).
