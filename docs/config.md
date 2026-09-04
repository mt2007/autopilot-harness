# Config reference

Product front door: [README.md](../README.md). Architecture: [architecture.md](./architecture.md).

Project settings live in **`.autopilot/config.yml`** (written by `init`, editable later). Hooks re-read this file at runtime. Paths below are relative to the **project root** (CLI `cwd`).

## Locale & hosts

| Key | Default | Meaning |
|-----|---------|---------|
| `locale` | `en` | Template / followup **template** language (`en` \| `zh-CN`). User-visible chat replies still follow the **user’s** language. |
| `platforms` | `[{ id: cursor, surface: ide }]` | Enabled hosts (`surface`: `ide` \| `cli` \| `runner`). |
| `platform` / `surface` | primary binding | Legacy scalars for older readers; prefer `platforms`. |

## Review

| Key | Default | Meaning |
|-----|---------|---------|
| `review.scope` | `executing_only` | When fix→confirm may run. See [README — When does self-review run?](../README.md#when-does-self-review-run-reviewscope). |
| `review.confirm_rounds` | `5` | Confirm lenses per item. Clamped to **1..5**. Only **`3`** is light mode (`1 → 2 → 5`, skip concurrency & security); other values use sequential lenses `1..N`. |
| `review.verify.enabled` | `false` | When `true`, advance/done gates on `.autopilot/verify-last.json` (agent runs the listed commands and writes that report; see comments in default config). |
| `review.verify.commands` | `[]` | List of `{ id, run, required? }` shell commands (only when verify enabled). |
| `review.stuck.max_idle_stops` | `5` | Idle-stop streak before a stuck nudge. Clamped to **1..100**. |
| `review.errors.max_before_pause` | `0` | Consecutive turn errors/aborts before `repeated_errors` pause. `0` = never pause on errors (unlimited recover). Clamped to **0..1000**. |

Aliases accepted for scope: `project`, `always`, and `all` all map to **`project`**. Anything else falls back to **`executing_only`**.

## Artifacts & session

| Key | Default | Meaning |
|-----|---------|---------|
| `artifacts.plans_dir` | `plans` | Directory for `plans/<slug>/` tracks. |
| `session.stale_after_hours` | `72` | Stale-session WARN / prune threshold for `doctor`. `0` disables stale detection. Invalid values make `doctor` **FAIL** (fix or remove the key); `session list` then treats stale hours as disabled (`0`). |

Other keys written by `init` (triggers, `concurrency.*`, artifact filenames, …) live in the same file — see `packages/cli/src/init/default-config.ts` / your generated `.autopilot/config.yml`. This page focuses on review / path-filter knobs. (`security.require_token` appears in the default YAML but is **not enforced** yet — do not rely on it.)

## Product-code path filters (not in `config.yml`)

| File | Role |
|------|------|
| **`.autopilotignore`** | Gitignore-style globs: matching edits do **not** count as product code (do not open fix→confirm). Missing file → built-in defaults (`plans/**`, `.autopilot/**`, `node_modules/**`, …). Does **not** change `git status` / `git diff`. |
| **`.gitignore`** | Untracked ignored paths are also skipped as product code; **tracked** files still count even if listed in `.gitignore`. |

## Related

- [Troubleshooting](./troubleshooting.md) — `doctor` WARNs, double hooks, missing skills  
- [Host roadmap](./hosts.md) — Cursor / Claude Code / Codex stop-loop caps  
- [Quickstart](./autopilot/quickstart.md) — commands and claim/resume/replan boundaries  
