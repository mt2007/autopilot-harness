# autopilot-harness

**Autopilot** — a project-level agent harness for Planning → Executing with structured self-review.

Install with `npx autopilot-harness init --yes`, then use `/autopilot-on` to plan and `/autopilot-run` to execute.

## Quick start

```bash
npx autopilot-harness init --platform cursor --yes
npx autopilot-harness doctor
```

Interactive TUI init lands in a later slice; `--yes` writes `.autopilot/`, merges `.cursor/hooks.json`, installs skills/workflows.

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
pnpm test
pnpm build
```

SQLite: v0.1 uses `node:sqlite` (`DatabaseSync`) so hooks run without native addons. `better-sqlite3` may return as an optional fast path when prebuilds cover your Node version.

## License

MIT — see [LICENSE](./LICENSE).
