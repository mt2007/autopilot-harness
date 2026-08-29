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

### Hook vendor runtime

The project Stop / submit / edit hooks load a **vendored** ESM bundle so consumer
repos do not need `@autopilot-harness/core` in `node_modules`:

1. **Source of truth (CLI package):** `packages/cli/assets/vendor/`
   - `runtime.mjs` — esbuild bundle of core + Cursor port (`pnpm bundle-vendor`)
   - `migrations/001_initial.sql` — schema the runtime applies on first open
2. **Installed into each project:** `.autopilot/bin/vendor/` (copied by `init` / `upgrade`)
3. **Entry:** `.autopilot/bin/autopilot-harness-hook.mjs` imports `./vendor/runtime.mjs`

The vendor runtime reads `.autopilot/config.yml` at hook time (`confirm_rounds`,
verify, stuck, locale). Commit order prefers migration then runtime so a torn
upgrade keeps a loadable (old runtime + new SQL) pair rather than the reverse.

Hostile-workspace I/O helpers live in `packages/cli/src/read-untrusted-file.ts`
(open/copy/replace) and `packages/cli/src/project-fs.ts` (mkdir / assert / package probes).

See the v0.1 plan for full FSM (E2–E5 review chain, OFF/ON/RESUME side effects).
