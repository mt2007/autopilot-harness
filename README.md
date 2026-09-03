# Autopilot

**autopilot-harness** — a vibecoding harness that turns open-ended agent chat into **structured planning → checklist execution → multi-lens self-review**.

[![CI](https://github.com/mt2007/autopilot-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/mt2007/autopilot-harness/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-brightgreen.svg)](https://nodejs.org/)

## Why

Vibe coding is fast until scope drifts, acceptance stays implicit, and “looks done” skips hard review angles. Autopilot keeps the agent on a durable track:

1. **Grill the plan** before writing product code  
2. **Execute against a checklist** (`plans/<slug>/`)  
3. **Self-review under rotating lenses** before an item is marked done  

It is **not** a general-purpose chat agent, **not** a substitute for your CI/test framework, **not** a Jira/kanban product (checklist + execution FSM, not a board UI). **v0.1 is Cursor-first**; other hosts are on the roadmap.

Autopilot does **not** guarantee bug-free software. It **raises confidence** that work was planned, checklist-scoped, and pressure-tested under several review lenses before you call an item complete.

## How it works

```text
/autopilot-on  →  grill rounds  →  brief / plan / checklist
       ↓
/autopilot-run →  per item: implement → fix → confirm×N → advance
       ↓
done (checklist clear)
```

Pause, change the plan, or resume with `/autopilot-off`, `/autopilot-replan`, and `/autopilot-resume` (details in the [quickstart](./docs/autopilot/quickstart.md)).

### Author note (scale)

On one **author-run** track in **Cursor**, after `/autopilot-run`, Autopilot sustained about **351 agent turns** and about **13.9 hours of pure execution time**. That is an anecdote showing a large checklist-scoped effort can stay in a long structured loop—not a benchmark or SLA.

### Planning (grill)

`/autopilot-on` starts a design-tree grill: each round asks the current **frontier** of decisions (with recommended answers), then waits for you before the next round. Planning may edit `plans/**` and docs — **no product code** until `/autopilot-run`.

Artifacts land in `plans/<slug>/brief.md`, `plan.md`, and `checklist.md`.

Planning grill rounds are inspired by the **grill-me / grilling** design-tree skill.

### Multi-lens self-review

After product edits, Autopilot drives **fix**, then **confirm** rounds. Each confirm round uses a different lens (not the same checklist reread). Default `review.confirm_rounds: 5`. With `review.confirm_rounds: 3` (light), lenses are **1 → 2 → 5** (skip concurrency & security).

| Round (default 5) | Lens |
|------:|------|
| 1 | Correctness & invariants |
| 2 | Nulls, boundaries & error paths |
| 3 | Concurrency, races & partial failure |
| 4 | Security & trust boundaries |
| 5 | Test gaps & regression (read-only: record gaps, don’t add tests in that round) |

## Quick start

Requires **Node.js 22+** and **pnpm**. The CLI package is `@autopilot-harness/cli` (bin: `autopilot-harness`). It is **not on the public npm registry yet**, so install from this repo:

```bash
git clone https://github.com/mt2007/autopilot-harness.git
cd autopilot-harness && pnpm install && pnpm build
```

**`cd` into the project you want to instrument** (`init`, `status`, `doctor`, `upgrade`, and related commands use the **current working directory** as the project root), then run the built CLI via path:

```bash
cd /path/to/your-app
node /path/to/autopilot-harness/packages/cli/dist/bin.js init --platform cursor --yes
# interactive TUI: omit --yes (platform still defaults to cursor)
# more flags: node …/bin.js init --help   (e.g. --platforms, --add-platform)
```

After publish, the same entrypoint is intended as `npx @autopilot-harness/cli …` (not a bare `npx autopilot-harness` package name).

Reload the Cursor window (or start a new Agent chat), then:

1. `/autopilot-on` — plan (grill → artifacts under `plans/<slug>/`)  
2. `/autopilot-run` — execute the checklist  

More commands and skills: [docs/autopilot/quickstart.md](./docs/autopilot/quickstart.md) (Chinese cheat sheet).

Useful CLI — call the built binary (there is no root `pnpm exec autopilot-harness` alias). Commands apply to the **current working directory**:

```bash
# dogfood this repo (cwd = clone):
node packages/cli/dist/bin.js status
node packages/cli/dist/bin.js doctor
node packages/cli/dist/bin.js upgrade --dry-run

# or from another app (cwd = that app):
node /path/to/autopilot-harness/packages/cli/dist/bin.js status
```

`init` writes `.autopilot/`, merges host hooks, and installs skills/workflows. Review-oriented config keys include `locale`, `review.confirm_rounds`, and optional `review.verify.*` (see [Architecture](./docs/architecture.md)).

## Docs

- [Architecture](./docs/architecture.md) — packages, vendor runtime, host stop-loop caps  
- [Quickstart](./docs/autopilot/quickstart.md) — planning / executing cheat sheet  
- [Contributing](./CONTRIBUTING.md)  
- [Changelog](./CHANGELOG.md)  

## Monorepo (short)

| Package | Role |
|---------|------|
| `@autopilot-harness/core` | State store, review engine, checklist, triggers |
| `@autopilot-harness/cli` | `autopilot-harness` CLI |
| `@autopilot-harness/i18n` | Locale strings (`en`, `zh-CN`) |
| `@autopilot-harness/templates` | Skills + planning/executing workflows |
| `@autopilot-harness/port-cursor` | Cursor hook adapter |

## Development

```bash
pnpm install
pnpm test          # bundle hook vendor, then Vitest
pnpm bundle-vendor
pnpm build
```

Consumer projects get a vendored hook runtime under `.autopilot/bin/vendor/` so they do not need workspace packages in `node_modules`. Deeper notes (Windows symlink policy, SQLite, host caps): [Architecture](./docs/architecture.md).

## License

MIT — see [LICENSE](./LICENSE).
