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

### Host followup / stop-loop caps (port gotcha)

Autopilot’s fix + multi-angle confirm routinely needs **many consecutive**
stop continuations in one streak. Each **host** enforces its own circuit
breaker; ports must disable or raise it, or the chain stalls mid-confirm
(pending followup left in DB).

| Host (planned) | Mechanism | Default | Autopilot mitigation |
| --- | --- | --- | --- |
| **Cursor** (v0.1) | `hooks.json` `loop_limit` on **stop** / **subagentStop** | `5` if omitted | Write `"loop_limit": null` on Autopilot stop (`mergeHooksJson` / init / upgrade). `doctor` WARNs if missing. |
| **Claude Code** (v0.2) | Stop `decision: "block"` consecutive **block cap** | **8**; override `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (`≤0` disables) | Port install/docs must set/raise the env (or document required shell profile). Not a Cursor-style `loop_limit` field. |
| **Codex** (later) | Stop continuation / `stop_hook_active`; caps still evolving | Research at port time | Do not assume Cursor’s `loop_limit`; verify current Codex Stop semantics. |
| **Runner** ports | External process loop `max iterations` | Port-defined | Size the runner budget ≥ worst-case review chain, or chunk work. |

`beforeSubmitPrompt` / `afterFileEdit` (and Claude `UserPromptSubmit` analogues)
are **not** subject to Cursor’s stop `loop_limit`; they do not emit Autopilot
followup loops.

A human nudge (e.g. 「继续」) may reset some host counters but is **not** a
substitute for correct port install. Global Cursor self-review hooks
already used `loop_limit: null` for this reason.

See the v0.1 plan for full FSM (E2–E5 review chain, OFF/ON/RESUME side effects).
