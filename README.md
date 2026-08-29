# autopilot-harness

**Autopilot** — a project-level agent harness for Planning → Executing with structured self-review.

Install with `npx autopilot-harness init` (interactive) or `init --yes`, then use `/autopilot-on` to plan and `/autopilot-run` to execute.

## Quick start

```bash
npx autopilot-harness init                  # interactive TUI
npx autopilot-harness init --platform cursor --yes
npx autopilot-harness status
npx autopilot-harness doctor
npx autopilot-harness doctor --prune-stale
npx autopilot-harness session list
npx autopilot-harness locale set zh-CN
npx autopilot-harness upgrade --dry-run
npx autopilot-harness upgrade
```

`init` writes `.autopilot/`, merges `.cursor/hooks.json`, installs skills/workflows, and prints a cheat sheet. `status` / `doctor` report pin, sessions, schema, and hooks (`doctor --prune-stale` purges old sessions). `session list|rename|purge|reset-review` manages SQLite sessions. `locale set` rewrites skill descriptions and stock triggers (custom triggers kept). `upgrade` refreshes those files, appends missing config keys, and migrates `state.db` (with backup).

## Monorepo packages

| Package | Description |
|---------|-------------|
| `@autopilot-harness/core` | StateStore, review engine, checklist parser, triggers |
| `@autopilot-harness/cli` | `autopilot-harness` CLI |
| `@autopilot-harness/i18n` | Locale strings (v0.1.0: en + zh-CN) |
| `@autopilot-harness/templates` | Skill and config templates |
| `@autopilot-harness/port-cursor` | Cursor hook adapter |

## Development

Requires **Node.js 22+** (uses built-in `node:sqlite` for the state store).

```bash
pnpm install
pnpm test          # bundles hook vendor, then Vitest
pnpm bundle-vendor # refresh .autopilot hook runtime (core + port-cursor)
pnpm build
```

`init` / `upgrade` copy `assets/vendor/runtime.mjs` next to the project hook so Cursor can run Autopilot **without** installing `@autopilot-harness/*` into the consumer `node_modules`.

SQLite: v0.1 uses `node:sqlite` (`DatabaseSync`) so hooks run without native addons. `better-sqlite3` may return as an optional fast path when prebuilds cover your Node version.

## License

MIT — see [LICENSE](./LICENSE).
