# @autopilot-harness/cli

CLI for **Autopilot** — a vibecoding harness that turns open-ended agent chat into **structured planning → checklist execution → multi-lens self-review**.

Bin name: `autopilot-harness`. Requires **Node.js 22+**. **v0.1 is Cursor-first.**

Autopilot does **not** guarantee bug-free software. It raises confidence that work was planned, checklist-scoped, and pressure-tested under several review lenses.

## Install & init

From the app you want to instrument (`cwd` = that project):

```bash
npx @autopilot-harness/cli init --platform cursor --yes
```

Interactive TUI (platform still defaults to cursor):

```bash
npx @autopilot-harness/cli init
```

Then reload the Cursor window (or start a new Agent chat) and run:

1. `/autopilot-on` — plan (grill → `plans/<slug>/`)
2. `/autopilot-run` — execute the checklist

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
