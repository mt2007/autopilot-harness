# @autopilot-harness/cli

CLI for **Autopilot** — a vibecoding harness that turns open-ended agent chat into **structured planning → checklist execution → multi-lens self-review**.

Bin name: `autopilot-harness`. Requires **Node.js 22+**. **This build ships Cursor, Claude Code, Codex, Kimi Code, GitHub Copilot CLI, Grok Build CLI, Gemini CLI, Factory Droid, Hermes Agent, and Antigravity** (Kimi is **degraded Stop≤1/turn**; Copilot is **degraded Stop consecutive ≤8**; Grok is **degraded Stop ≤8/turn**; Gemini is **Shipped** with honest AfterAgent turn cap ≤100 / `MAX_TURNS` and soft min-CLI **≥0.31.0**; Factory is **Shipped** with multi-block under `stop_hook_active` live-proved — waive → degraded≤1; Hermes is **Shipped** with shell `pre_verify` continue live-proved — nudge ≥32; edit-only; soft min **≥0.21.3**; waive → degraded + human R1 ack; Antigravity is **Shipped** (**host Stop continue live-proved** in **0.10.1**) — `.agents/bin` shim; CLI must mount workspace).

Autopilot does **not** guarantee bug-free software. It raises confidence that work was planned, checklist-scoped, and pressure-tested under several review lenses.

## Install & init

From the app you want to instrument (`cwd` = that project):

```bash
npx @autopilot-harness/cli init --platform cursor --yes
# or: --platform claude-code | --platform codex | --platform kimi-code | --platform copilot-cli | --platform grok-build | --platform gemini-cli | --platform factory-droid | --platform hermes-agent | --platform antigravity
# multi-host: init --yes --add-platform <id>
```

Interactive TUI (platform still defaults to cursor):

```bash
npx @autopilot-harness/cli init
```

Reload the host (Cursor: Reload Window; Claude Code / Codex / Kimi Code / Copilot CLI / Grok Build / Gemini CLI / Factory Droid / Hermes Agent / Antigravity: restart / new session). **Restart Copilot CLI** after install or upgrade so hooks reload. Trust Codex via `/hooks`, Grok via `/hooks-trust` or `--trust`, Gemini via re-trust / `/hooks panel` / folder trust, Factory via **`$FACTORY_PROJECT_DIR`** commands + **`/hooks` + snapshot/reload**, Hermes via **`$HERMES_HOME`** + relative command + consent / **`hermes hooks doctor`**, and Antigravity via **`.agents`** reload / CLI firing surface when applicable (**auto-attach ≠ Autopilot ON**), then:

1. Plan — Cursor/Claude: `/autopilot-on`; Codex / Kimi / Copilot / Grok: line-start `triggers.on`; Gemini / Factory / Hermes / Antigravity: host skills **and** line-start (typed slash still parses)
2. Execute — Cursor/Claude: `/autopilot-run`; Codex / Kimi / Copilot / Grok: line-start `triggers.run`; Gemini / Factory / Hermes / Antigravity: host skills **and** line-start

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
