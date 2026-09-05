# Architecture

Product front door: English [README.md](../README.md) is authoritative.

Also: [CONTRIBUTING.md](../CONTRIBUTING.md) · [CHANGELOG.md](../CHANGELOG.md) · [Config](./config.md) · [Troubleshooting](./troubleshooting.md) · [Hosts](./hosts.md) · [Plan bridge](./host-plan-bridge.md).

Autopilot Harness separates **core** (FSM, SQLite, checklist, review) from **ports** (Cursor, Claude Code, …).

Project config (`.autopilot/config.yml`) lists enabled hosts under `platforms:`
(`id` + `surface`: `ide` | `cli` | `runner`). Legacy `platform` / `surface`
scalars remain as the primary host for older readers (prefer an installable
binding when the list mixes wired and future hosts). Config may list multiple
`platforms`; **this build installs Cursor and/or Claude Code** when those
bindings are present (`cursor`/`ide`, `claude-code`/`cli`). Other ids are
reserved for future ports. For Claude, `surface: cli` means official hooks are
**shared across terminal + IDE** — not CLI-only.

```
packages/core               StateStore, ReviewEngine, project-config, checklist, triggers
packages/ports/cursor       beforeSubmitPrompt / afterFileEdit / stop adapters
packages/ports/claude-code  UserPromptSubmit / PostToolUse / Stop / StopFailure adapters
packages/cli                @autopilot-harness/cli (bin: autopilot-harness; npm public)
packages/i18n               en + zh-CN
packages/templates          skills (*.tpl) + planning/executing workflows
```

State lives in `.autopilot/state.db`. Progress authority is `plans/<slug>/checklist.md`.

`review.scope` in `.autopilot/config.yml`: **`executing_only`** (default) runs fix→confirm only during Autopilot RUN; **`project`** runs on any product-code edit without ON/RUN (idle/ambient or **planning** ends at review-complete, not checklist advance). See README **When does self-review run?** and [Config](./config.md).

### Hook vendor runtime

The project Stop / submit / edit hooks load a **vendored** ESM bundle so consumer
repos do not need `@autopilot-harness/core` in `node_modules`:

1. **Source of truth (CLI package):** `packages/cli/assets/vendor/`
   - `runtime.mjs` — esbuild bundle of core + **Cursor and Claude Code** ports (`pnpm bundle-vendor`)
   - `migrations/001_initial.sql` — schema the runtime applies on first open
2. **Installed into each project:** `.autopilot/bin/vendor/` (copied by `init` / `upgrade`)
3. **Entry:** `.autopilot/bin/autopilot-harness-hook.mjs` imports `./vendor/runtime.mjs` and dispatches by **`--platform <id>`** (when present) + host event + payload conflict resolver (cross-fire)

The vendor runtime reads `.autopilot/config.yml` on **stop** (`locale`,
`review.*`) and on **edit** (`review.scope` only). Submit does not load review
config (built-in slash `/autopilot-on` … `/autopilot-replan` + `DEFAULT_TRIGGERS`; not YAML
`triggers.*`). Other init keys
(`concurrency.*`, `triggers.*` phrase lists, `artifacts.files.*`, …) are
**not** loaded by the hook runtime yet — see [Config](./config.md) wiring table.
Commit order prefers migration then runtime so a torn
upgrade keeps a loadable (old runtime + new SQL) pair rather than the reverse.

Hostile-workspace I/O helpers live in `packages/cli/src/read-untrusted-file.ts`
(open/copy/replace) and `packages/cli/src/project-fs.ts` (mkdir / assert / package probes).

### Host followup / stop-loop caps (port gotcha)

Autopilot’s fix + multi-angle confirm routinely needs **many consecutive**
stop continuations in one streak. Each **host** enforces its own circuit
breaker; ports must disable or raise it, or the chain stalls mid-confirm
(pending followup left in DB).

| Host | Mechanism | Default | Autopilot mitigation |
| --- | --- | --- | --- |
| **Cursor** (shipped) | `hooks.json` `loop_limit` on **stop** / **subagentStop** | `5` if omitted | Write `"loop_limit": null` on Autopilot stop (`mergeHooksJson` / init / upgrade). `doctor` WARNs if missing. |
| **Claude Code** (v0.2 shipped) | Stop `decision: "block"` consecutive **block cap** | **8**; `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (`0` disables) | Init writes `.claude/settings.json` hooks + `env.CLAUDE_CODE_STOP_HOOK_BLOCK_CAP=0`; `doctor` WARNs when missing or not `0`. Workspace **trust** may gate project `env`. |
| **Codex** (v0.3/v0.4 planned) | Stop `decision: "block"` + `reason` as next user prompt; `stop_hook_active` | No documented numeric block cap (2026-09 research) | **Planned** hook port (not Runner-first): `.codex/hooks.json` + skills; require `/hooks` trust. Measure long chains at implement time. |
| **Runner** ports (later) | External process loop `max iterations` | Port-defined | Size the runner budget ≥ worst-case review chain, or chunk work. For hosts without stop continuation only. |

`beforeSubmitPrompt` / `afterFileEdit` (and Claude `UserPromptSubmit` analogues)
are **not** subject to Cursor’s stop `loop_limit`; they do not emit Autopilot
followup loops.

A human nudge (e.g. typing `continue`) may reset some host counters but is **not** a
substitute for correct port install. Global Cursor self-review hooks that inject
on every stop typically use `loop_limit: null` for this reason.

Review-chain FSM (fix → confirm lenses → advance/done, OFF/ON/RESUME/REPLAN side effects) lives in `packages/core` (`ReviewEngine`). Host port status and stop-loop caps: [hosts.md](./hosts.md). User-facing triggers: [quickstart](./autopilot/quickstart.md).
