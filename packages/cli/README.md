# @autopilot-harness/cli

CLI for **Autopilot** — a vibecoding harness that turns open-ended agent chat into **structured planning → checklist execution → multi-lens self-review**.

Bin name: `autopilot-harness`. Requires **Node.js 22+**. **This build ships Cursor, Claude Code, and Codex.**

Autopilot does **not** guarantee bug-free software. It raises confidence that work was planned, checklist-scoped, and pressure-tested under several review lenses.

## Install & init

From the app you want to instrument (`cwd` = that project):

```bash
npx @autopilot-harness/cli init --platform cursor --yes
# or: --platform claude-code | --platform codex
# dual/triple-host: init --yes --add-platform <id>
```

Interactive TUI (platform still defaults to cursor):

```bash
npx @autopilot-harness/cli init
```

Reload the host (Cursor: Reload Window; Claude Code / Codex: restart / new session). Trust Codex hooks via `/hooks` when applicable, then:

1. Plan — Cursor/Claude: `/autopilot-on`; Codex: line-start `triggers.on` (typed slash still parses)
2. Execute — Cursor/Claude: `/autopilot-run`; Codex: line-start `triggers.run`

## Useful commands

```bash
npx @autopilot-harness/cli status
npx @autopilot-harness/cli doctor
npx @autopilot-harness/cli upgrade --dry-run
npx @autopilot-harness/cli --help
```

Global install (optional):

```bash
npm i -g @autopilot-harness/cli
autopilot-harness init --platform cursor --yes
```

Use the scoped package name (`@autopilot-harness/cli`). There is no bare npm package named `autopilot-harness`.

## Docs

- [GitHub README](https://github.com/mt2007/autopilot-harness#readme) — product overview
- [Quickstart](https://github.com/mt2007/autopilot-harness/blob/main/docs/autopilot/quickstart.md)
- [Config](https://github.com/mt2007/autopilot-harness/blob/main/docs/config.md)
- [Troubleshooting](https://github.com/mt2007/autopilot-harness/blob/main/docs/troubleshooting.md)

## License

MIT — see [LICENSE](https://github.com/mt2007/autopilot-harness/blob/main/LICENSE).
