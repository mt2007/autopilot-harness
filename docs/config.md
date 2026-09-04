# Config reference

Product front door: [README.md](../README.md). Architecture: [architecture.md](./architecture.md).

Project settings live in **`.autopilot/config.yml`** (written by `init`, editable later). Paths below are relative to the **project root** (CLI `cwd`).

Canonical defaults: `packages/cli/src/init/default-config.ts`.

**What actually reads which keys (v0.2 Cursor + Claude Code build):**

| Consumer | Keys |
|----------|------|
| **Stop hook** (via `loadProjectReviewConfig` / `createConfiguredReviewEngine`) | `locale`, `review.*` |
| **Edit hook** | `review.scope` only (same loader; other `review.*` / `locale` unused on edit) |
| **Submit hook** | Built-in slash `/autopilot-on` … `/autopilot-replan` + line-start `DEFAULT_TRIGGERS` (incl. resume_review phrases) — does **not** load review config or YAML `triggers.*`. (Cursor skill files only surface slash in the UI; Claude skills under `.claude/skills/`; the hook parses typed slash commands either way.) |
| **`status`** | `locale`, `platforms` (+ legacy `platform`/`surface`), `artifacts.plans_dir`, `cli.preferred_name` |
| **`doctor`** | `artifacts.plans_dir` (path checks), `session.stale_after_hours` (WARN/FAIL/prune); also checks config.yml readable; Cursor `loop_limit` / Claude `BLOCK_CAP` when that host is installed |
| **`session list`** | `session.stale_after_hours` only (via `readStaleAfterHours`; invalid → treat as `0` / disabled) |
| **`init` / `upgrade`** | Read `locale` + `platforms` (upgrade reinstall hints); **init** also creates `artifacts.plans_dir` and writes the full default YAML; installs Cursor and/or Claude Code wiring for installable bindings |
| **`locale set`** | Updates `locale`, rewrites **stock** `triggers.*` lists in config.yml (custom lists preserved), rewrites skill descriptions |
| **Written by init, not wired into the hook runtime yet** | `concurrency.*`, `artifacts.files.*`, `security.require_token`, and **line-start phrase lists** under `triggers.*` |

Effective RUN concurrency gate is still **`one_executor`** (code default when the hook does not pass `phaseActions`). Changing `concurrency.mode` in YAML alone does **not** switch modes today. The gate matches sessions with `phase=executing`, `armed=1`, and `paused=0`.

## Locale & hosts

| Key | Default | Meaning |
|-----|---------|---------|
| `locale` | `en` | Template / followup **template** language (`en` \| `zh-CN`). User-visible chat replies still follow the **user’s** language. Change later with `locale set <code>`. |
| `platforms` | `[{ id: cursor, surface: ide }]` | Enabled hosts (`surface`: `ide` \| `cli` \| `runner`). Cap: 32 unique bindings. **This build installs Cursor and/or Claude Code** when those bindings are present. Claude uses `surface: cli` (hooks shared across terminal + IDE — not CLI-only). Dual-host: `init --yes --add-platform <host>`. |
| `platform` / `surface` | primary binding | Legacy scalars for older readers; prefer `platforms`. Primary prefers an installable binding when the list mixes wired and future hosts. |
| `integration` | `hook` | Integration style written by init (`hook`). |

## Artifacts & CLI label

| Key | Default | Meaning |
|-----|---------|---------|
| `artifacts.plans_dir` | `plans` | Track directory used by **init** (creates the folder) and **doctor/status** path checks. Prefer the default `plans/` — init TUI can offer a custom path, but the hook RUN path currently defaults to `plans/` and does **not** yet load this key from YAML (a non-default value can leave init layout and RUN looking at different trees). |
| `artifacts.files.brief` | `brief.md` | Written by init. Filenames are **fixed** in core (`brief.md` / `plan.md` / `checklist.md`) — renaming these keys does not change runtime paths yet. |
| `artifacts.files.plan` | `plan.md` | Same as above. |
| `artifacts.files.checklist` | `checklist.md` | Same as above. Checklist is **progress authority**; hook/core resolve it as `<plansDir>/<slug>/checklist.md` with **`plansDir` defaulting to `plans`** (YAML `artifacts.files.*` / custom `plans_dir` are not applied by the hook yet). |
| `cli.preferred_name` | `Autopilot` | Display name in status / some messages (sanitized). |

## Session

| Key | Default | Meaning |
|-----|---------|---------|
| `session.stale_after_hours` | `72` | Stale-session WARN / prune threshold for `doctor`. `0` disables stale detection. Invalid values make `doctor` **FAIL** (fix or remove the key); `session list` then treats stale hours as disabled (`0`). |

## Concurrency

| Key | Default | Meaning |
|-----|---------|---------|
| `concurrency.mode` | `one_executor` | **Intended** mode. Runtime today always applies the `one_executor` gate (refuse a second **armed executing** session) because the hook does not load this YAML key. Do not set other values expecting worktree isolation. |
| `concurrency.worktree` | `false` | Reserved for future per-session git worktrees. **Unused** while `false`. |
| `concurrency.worktrees_dir` | `.autopilot/worktrees` | Intended worktree parent (also listed in default `.autopilotignore`). Unused while `worktree: false`. |

## Review

| Key | Default | Meaning |
|-----|---------|---------|
| `review.scope` | `executing_only` | When fix→confirm may run. See [README — When does self-review run?](../README.md#when-does-self-review-run-reviewscope). |
| `review.confirm_rounds` | `5` | Confirm lenses per item. Clamped to **1..5**. Only **`3`** is light mode (`1 → 2 → 5`, skip concurrency & security); other values use sequential lenses `1..N`. |
| `review.verify.enabled` | `false` | When `true`, advance/done gates on `.autopilot/verify-last.json` (agent runs the listed commands and writes that report). |
| `review.verify.commands` | `[]` | List of `{ id, run, required? }` shell commands (only when verify enabled). Treat `run` as **trusted project config** (agent will execute it). |
| `review.stuck.max_idle_stops` | `5` | Idle-stop streak before a stuck nudge. Clamped to **1..100**. |
| `review.errors.max_before_pause` | `0` | Consecutive turn errors/aborts before `repeated_errors` pause. `0` = never pause on errors (unlimited recover). Clamped to **0..1000**. |

Aliases accepted for scope: `project`, `always`, and `all` all map to **`project`**. Anything else falls back to **`executing_only`**.

## Triggers

Init seeds locale stock phrases under `triggers.*`; `locale set` rewrites those lists in **config.yml** when they still match stock/legacy (custom lists are preserved). Prefer `/autopilot-*` skills in Cursor or Claude Code.

| Key | Role |
|-----|------|
| `triggers.match` | Documented as `line_start` (only matcher in the trigger parser). |
| `triggers.on` / `run` / `off` / `resume` / `replan` / `resume_review` | Phrase lists written for locale migration / future host wiring. **Hook line-start matching does not read these YAML lists yet** — it uses built-in `DEFAULT_TRIGGERS` (hardcoded bilingual phrases). Slash `/autopilot-on` … `/autopilot-replan` is a separate built-in parser path (not these lists; no slash for resume_review). |

## Security

| Key | Default | Meaning |
|-----|---------|---------|
| `security.require_token` | `false` | Appears in default YAML but is **not enforced** yet — do not rely on it for access control. |

## Product-code path filters (not in `config.yml`)

| File | Role |
|------|------|
| **`.autopilotignore`** | Gitignore-style globs: matching edits do **not** count as product code (do not open fix→confirm). Missing file → built-in defaults (`plans/**`, `.autopilot/**`, `node_modules/**`, …). Does **not** change `git status` / `git diff`. |
| **`.gitignore`** | Untracked ignored paths are also skipped as product code; **tracked** files still count even if listed in `.gitignore`. |

## Related

- [Troubleshooting](./troubleshooting.md) — `doctor` WARNs, double hooks, missing skills, Claude `BLOCK_CAP` / trust  
- [Hosts](./hosts.md) — Cursor / Claude Code (shipped) / Codex / Runner stop-loop caps  
- [Host Plan-mode bridge](./host-plan-bridge.md) — why Cursor/Claude Plan modes are not Autopilot ON  
- [Quickstart](./autopilot/quickstart.md) — commands and claim/resume/replan boundaries  
