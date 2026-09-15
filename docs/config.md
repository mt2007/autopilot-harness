# Config reference

Product front door: [README.md](../README.md). Architecture: [architecture.md](./architecture.md).

Project settings live in **`.autopilot/config.yml`** (written by `init`, editable later). Paths below are relative to the **project root** (CLI `cwd`).

Canonical defaults: `packages/cli/src/init/default-config.ts`.

**What actually reads which keys (this Cursor + Claude Code + Codex + Kimi Code + Copilot CLI + Grok Build CLI + Gemini CLI + Factory Droid build):**

| Consumer | Keys |
|----------|------|
| **Stop hook** (via `loadProjectReviewConfig` / `createConfiguredReviewEngine`) | `locale`, `review.*` |
| **Edit hook** | `review.scope` + `artifacts.plans_dir` (plans bind / `notePlansDirEdit`; other `review.*` / `locale` unused on edit) |
| **Submit hook** | Built-in slash `/autopilot-on` … `/autopilot-replan` (separate parser; Cursor skill files only surface slash in the UI; Claude skills under `.claude/skills/`; the hook parses typed slash commands either way) + line-start phrases from YAML `triggers.*` when a list has **≥1 non-blank phrase** (after trim), else that key falls back to `DEFAULT_TRIGGERS` (incl. resume_review; empty/`[]`/whitespace-only does **not** wipe builtins). Also loads `artifacts.plans_dir` for RUN / needPick / phaseActions. Does **not** load `review.*` / `locale` on submit. |
| **`status`** | `locale`, `platforms` (legacy top-level `platform`/`surface` still read as fallback), `artifacts.plans_dir`, `cli.preferred_name` |
| **`doctor`** | `artifacts.plans_dir` (path checks), `session.stale_after_hours` (WARN/FAIL/prune); also checks config.yml readable; Cursor `loop_limit` / Claude `BLOCK_CAP` / Codex hooks + timeout&lt;120 WARN + `/hooks` trust / Kimi Code user-home `config.toml` + Stop≤1/turn WARN (and symlink FAIL) / Copilot `.github/hooks` (missing/incomplete **FAIL**; timeout&lt;120 / ≤8 / Restart / dual **WARN**, dual = both enabled **or** leftover hooks on disk) / Grok `.grok/hooks` (missing/incomplete **FAIL**; timeout omit or &lt;120 / ≤8/turn / trust / Grok+Claude and/or Grok+Cursor dual **WARN**, dual = both enabled **or** leftover hooks on disk) / Gemini `.gemini/settings.json` (missing/incomplete **FAIL**; timeout omit or &lt;120000 / AfterAgent cap ≤100 / min-CLI / re-trust / `/hooks panel` / folder trust / Gemini+Claude dual **WARN**, dual = both enabled **or** leftover on disk / `hooksConfig` **WARN**) / Factory `.factory/hooks.json` (missing/incomplete/unreadable **FAIL**; no raise/hard-cap live-proved / `/hooks`+snapshot/reload / missing `--platform` or `$FACTORY_PROJECT_DIR` / timeout omit or &lt;120 / Factory+Claude dual / `~/.factory` residual / `settings.json` hooks leftover / `hooksDisabled` / `allowManagedHooksOnly` **WARN**) |
| **`session list`** | `session.stale_after_hours` only (via `readStaleAfterHours`; invalid → treat as `0` / disabled) |
| **`init` / `upgrade`** | Read `locale` + `platforms` (upgrade reinstall hints); **init** also creates `artifacts.plans_dir` and writes the full default YAML; installs Cursor, Claude Code, Codex, Kimi Code, Copilot CLI, Grok Build CLI, Gemini CLI, and/or Factory Droid wiring for installable bindings |
| **`locale set`** | Updates `locale`, rewrites **stock** `triggers.*` lists in config.yml (custom lists preserved), rewrites skill descriptions |
| **Written by init, not wired into the hook runtime yet** | `concurrency.*`, `artifacts.files.*`, `security.require_token` |

Effective RUN concurrency gate is still **`one_executor`** (code default when the hook does not pass `phaseActions`). Changing `concurrency.mode` in YAML alone does **not** switch modes today. The gate matches sessions with `phase=executing`, `armed=1`, and `paused=0`. **Planning / ON sessions never satisfy this gate** and do not block another chat’s RUN. Multi-plan selection (`needPick`) happens only on RUN and uses an allowed agent turn (not a hard block); busy/hard failures still block submit.

## Locale & hosts

| Key | Default | Meaning |
|-----|---------|---------|
| `locale` | `en` | Template / followup **template** language (`en` \| `zh-CN`). User-visible chat replies still follow the **user’s** language. Change later with `locale set <code>`. |
| `platforms` | `[{ id: cursor, surface: ide }]` | Enabled hosts (`surface`: `ide` \| `cli` \| `runner`). Cap: 32 unique bindings. **Primary** = first installable binding in list order (no separate primary key). **This build installs Cursor, Claude Code, Codex, Kimi Code, Copilot CLI, Grok Build CLI, Gemini CLI, and/or Factory Droid** when those bindings are present. Claude/Codex/Kimi/Copilot/Grok/Gemini/Factory use `surface: cli` (Claude hooks shared across terminal + IDE — not CLI-only; Codex: `.codex/hooks.json` + `/hooks` trust; Kimi: user-home `config.toml`, **Stop≤1/turn** degraded; Copilot: `.github/hooks/autopilot-harness.json`, **Stop consecutive ≤8** degraded, restart CLI after install; Grok: `.grok/hooks/autopilot-harness.json`, **Stop ≤8/turn** degraded, trust via `/hooks-trust` or `--trust`; Gemini: `.gemini/settings.json`, **AfterAgent ≤100** / `MAX_TURNS`, prefer CLI ≥0.31.0, re-trust / `/hooks panel` / folder trust; Factory: `.factory/hooks.json`, **`$FACTORY_PROJECT_DIR`**, multi-block live-proved, `/hooks`+snapshot/reload). Multi-host: `init --yes --add-platform <host>`. Installed Autopilot hook commands include `--platform <id>` for eight-way dispatch. |
| `platform` / `surface` | — | **Deprecated.** Older configs may still have these scalars; readers fall back to them only when `platforms` is absent. Fresh `init` does not write them; `upgrade` / `init --force` remove them after materializing `platforms`. |
| `integration` | `hook` | Integration style written by init (`hook`). |

## Artifacts & CLI label

| Key | Default | Meaning |
|-----|---------|---------|
| `artifacts.plans_dir` | `plans` | Track directory for **init** (creates the folder), **doctor/status** path checks, and the **hook** (submit RUN / needPick / phaseActions + edit plans-bind). Init TUI can offer a custom path. **Hook** invalid/non-string values fail-open to `plans/`; **status** shows `plans: invalid (…)`; **doctor** **FAIL**s on invalid paths. Init also covers this dir in `.autopilotignore`. |
| `artifacts.files.brief` | `brief.md` | Written by init. Filenames are **fixed** in core (`brief.md` / `plan.md` / `checklist.md`) — renaming these keys does not change runtime paths yet. |
| `artifacts.files.plan` | `plan.md` | Same as above. |
| `artifacts.files.checklist` | `checklist.md` | Same as above. Checklist is **progress authority**; hook/core resolve it as `<plansDir>/<slug>/checklist.md` where **`plansDir` comes from YAML `artifacts.plans_dir`** (default `plans`). Renaming `artifacts.files.*` still does **not** change those fixed basenames. |
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
| `review.scope` | `project` (fresh init YAML) | When fix→confirm may run. Fresh `init` writes **`project`**. **Missing / invalid** values still load as **`executing_only`** (runtime fail-open). `upgrade` fill-missing writes `executing_only` and does **not** rewrite an existing scope key. See [README — When does self-review run?](../README.md#when-does-self-review-run-reviewscope). |
| `review.confirm_rounds` | `5` (no Kimi); **`1` when installable `kimi-code` is enabled at init** | Confirm lenses per item. Clamped to **1..5**. Only **`3`** is light mode (`1 → 2 → 5`, skip concurrency & security); other values use sequential lenses `1..N`. **Kimi Code** hard-caps Stop-continue at ≤1/turn — do **not** expect confirm×5 there; prefer `confirm_rounds: 1`. When installable `kimi-code` is enabled (platforms list or legacy `platform`/`surface`), the hook **clamps** effective rounds to **1** **project-wide** (shared `.autopilot/config.yml` — Cursor / Claude / Codex / Copilot / Grok / Gemini / Factory sessions in the same project are clamped too). **GitHub Copilot CLI** does **not** clamp `confirm_rounds` (nor do **Grok Build CLI**, **Gemini CLI**, or **Factory Droid**); Copilot is **degraded Stop consecutive ≤8**, Grok is **degraded Stop ≤8/turn** (mid-chain cutoffs → pending / RESUME / nudge). Gemini AfterAgent deny→retry shares host **`MAX_TURNS` ≤100** (no raise; prefer CLI **≥0.31.0**). Factory Stop multi-block under `stop_hook_active` is **live-proved** (no raise; **waive → degraded≤1**). |
| `review.verify.enabled` | `false` | When `true`, advance/done gates on `.autopilot/verify-last.json` (agent runs the listed commands and writes that report). |
| `review.verify.commands` | `[]` | List of `{ id, run, required? }` shell commands (only when verify enabled). Treat `run` as **trusted project config** (agent will execute it). |
| `review.stuck.max_idle_stops` | `5` | Idle-stop streak before a stuck nudge. Clamped to **1..100**. Soft `need_evidence` idle hits the nudge **without** hard-pausing / disarming the track; repeated required-verify failures still hard-stuck pause. |
| `review.errors.max_before_pause` | `0` | Consecutive turn errors/aborts before `repeated_errors` pause. `0` = never pause on errors (unlimited recover). Clamped to **0..1000**. |

Aliases accepted for scope: `project`, `always`, and `all` all map to **`project`**. Missing key, empty, or anything else falls back to **`executing_only`**.

## Triggers

Init seeds bilingual stock phrases under `triggers.*` (aligned with `DEFAULT_TRIGGERS`); `locale set` rewrites those lists in **config.yml** when they still match stock/legacy (custom lists are preserved). Prefer `/autopilot-*` skills in Cursor or Claude Code. **Codex / Kimi Code / Copilot CLI / Grok Build CLI / Gemini CLI / Factory Droid P0** have no Autopilot skills path / no default `AGENTS.md`; use line-start `triggers.on` / `triggers.run` (typed `/autopilot-*` still parses).

| Key | Role |
|-----|------|
| `triggers.match` | Written by init as `line_start`. Parser only supports `line_start`; **YAML `triggers.match` is not applied** (changing it has no effect today). |
| `triggers.on` / `run` / `off` / `resume` / `replan` / `resume_review` | Phrase lists loaded by the **submit** hook for line-start matching. A YAML list with **≥1 non-blank phrase** (after trim) replaces that key; empty/`[]`/whitespace-only/missing falls back to `DEFAULT_TRIGGERS` for that key. Slash `/autopilot-on` … `/autopilot-replan` is a separate built-in parser path (not these lists; no slash for resume_review). |

## Security

| Key | Default | Meaning |
|-----|---------|---------|
| `security.require_token` | `false` | Appears in default YAML but is **not enforced** yet — do not rely on it for access control. |

## Product-code path filters (not in `config.yml`)

| File | Role |
|------|------|
| **`.autopilotignore`** | Gitignore-style globs: matching edits do **not** count as product code (do not open fix→confirm). Missing file → built-in defaults (`plans/**`, `.autopilot/**`, `.cursor/**`, `.claude/**`, `.codex/**`, `.github/hooks/**`, `.grok/hooks/**`, `.gemini/settings.json`, `.factory/hooks.json`, `node_modules/**`, …). Does **not** change `git status` / `git diff`. |
| **`.gitignore`** | Untracked ignored paths are also skipped as product code; **tracked** files still count even if listed in `.gitignore`. |

On completed stop, Autopilot also treats **git-dirty product paths** (vs HEAD / untracked product files) as code edits even when the host never fired `afterFileEdit` (e.g. Shell writes) — same `.autopilotignore` / untracked-gitignore filters. See [Troubleshooting](./troubleshooting.md#edited-code-but-no-self-review).

## Related

- [Troubleshooting](./troubleshooting.md) — `doctor` WARNs, double hooks, missing skills, Claude `BLOCK_CAP` / trust, Copilot Stop≤8 / restart / dual, Grok Stop≤8/turn / trust / multi-FP, Gemini AfterAgent cap ≤100 / min-CLI / re-trust / folder trust / `hooksConfig`, Factory multi-block / `$FACTORY_PROJECT_DIR` / `/hooks` snapshot  
- [Hosts](./hosts.md) — Cursor / Claude Code / Codex / Kimi Code / Copilot CLI / Grok Build / Gemini CLI / Factory Droid (shipped; Kimi **degraded Stop ≤1/turn**; Copilot **degraded Stop consecutive ≤8**; Grok **degraded Stop ≤8/turn**; Gemini **AfterAgent ≤100** / min-CLI **≥0.31.0**; Factory **multi-block live-proved**; next=Hermes); roadmap + stop-loop caps  
- [Host Plan-mode bridge](./host-plan-bridge.md) — why Cursor/Claude Plan modes are not Autopilot ON  
- [Quickstart](./autopilot/quickstart.md) — commands and claim/resume/replan boundaries  
