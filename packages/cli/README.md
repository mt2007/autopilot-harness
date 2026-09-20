# @autopilot-harness/cli

CLI for **Autopilot** — a vibecoding harness that turns open-ended agent chat into **structured planning → checklist execution → multi-lens self-review**.

Bin name: `autopilot-harness`. Requires **Node.js 22+**. **This build ships Cursor, Claude Code, Codex, Kimi Code, GitHub Copilot CLI, Grok Build CLI, Gemini CLI, Factory Droid, Hermes Agent, Antigravity, Pi, Devin CLI, and Runner (meta)** (Kimi is **degraded Stop≤1/turn**; Copilot is **degraded Stop consecutive ≤8**; Grok is **degraded Stop ≤8/turn**; Gemini is **Shipped** with honest AfterAgent turn cap ≤100 / `MAX_TURNS` and soft min-CLI **≥0.31.0**; Factory is **Shipped** with multi-block under `stop_hook_active` live-proved — waive → degraded≤1; Hermes is **Shipped** with shell `pre_verify` continue live-proved — nudge ≥32; edit-only; soft min **≥0.21.3**; waive → degraded + human R1 ack; Antigravity is **Shipped** (**host Stop continue live-proved** in **0.10.1**) — `.agents/bin` shim; CLI must mount workspace; **Pi** is **Shipped** (**interactive TUI live Stop-continue ≥1× proved**) — in-process **`.pi/extensions/autopilot.ts`** (**never** `pi install`); soft min **≥0.85.1**; **`/trust` + `/reload`**; **R10** TUI only (**not** `pi -p` / JSON / print); shares **`.agents/skills`**; outside shell `KNOWN_PLATFORMS` (eleven-way shell + Pi extension); **Runner** is **Shipped (meta)** — `runner start|status`, requires **`runner.command`**, outside the eleven-way hook stamp set; **`--on` / `--brief` / `--message`** planning shipped (**C6** planning `stopped`→0); **Devin CLI** is **Shipped** (**interactive CLI live Stop-continue ≥1× proved**; **CLI only** — not Desktop; `.devin/hooks.v1.json`; `$DEVIN_PROJECT_DIR`; skills `.devin/skills`; **eleven-way** shell). **OpenCode** is **1 (next)** (wait upstream).

Autopilot does **not** guarantee bug-free software. It raises confidence that work was planned, checklist-scoped, and pressure-tested under several review lenses.

## Install & init

From the app you want to instrument (`cwd` = that project):

```bash
npx @autopilot-harness/cli init --yes
# Default host = Cursor. Commented `--platform` lines are alternatives; `--add-platform` only after first install.
# Or pick a host explicitly:
# npx @autopilot-harness/cli init --platform cursor --yes
# npx @autopilot-harness/cli init --platform claude-code --yes
# npx @autopilot-harness/cli init --platform codex --yes
# npx @autopilot-harness/cli init --platform kimi-code --yes
# npx @autopilot-harness/cli init --platform copilot-cli --yes
# npx @autopilot-harness/cli init --platform grok-build --yes
# npx @autopilot-harness/cli init --platform gemini-cli --yes
# npx @autopilot-harness/cli init --platform factory-droid --yes
# npx @autopilot-harness/cli init --platform hermes-agent --yes
# npx @autopilot-harness/cli init --platform antigravity --yes
# npx @autopilot-harness/cli init --platform pi --yes
# npx @autopilot-harness/cli init --platform devin --yes
# multi-host later (example; requires prior init):
npx @autopilot-harness/cli init --yes --add-platform claude-code
```

Interactive TUI (platform still defaults to cursor):

```bash
npx @autopilot-harness/cli init
```

Reload the host (Cursor: Reload Window; Claude Code / Codex / Kimi Code / Copilot CLI / Grok Build / Gemini CLI / Factory Droid / Hermes Agent / Antigravity / Devin / Pi: restart / new session / `/reload`). **Restart Copilot CLI** after install or upgrade so hooks reload. Trust Codex via `/hooks`, Grok via `/hooks-trust` or `--trust`, Gemini via re-trust / `/hooks panel` / folder trust, Factory via **`$FACTORY_PROJECT_DIR`** commands + **`/hooks` + snapshot/reload**, Hermes via **`$HERMES_HOME`** + relative command + consent / **`hermes hooks doctor`**, Antigravity via **`.agents`** reload / CLI firing surface when applicable (**auto-attach ≠ Autopilot ON**), Devin via **`$DEVIN_PROJECT_DIR`** + **`/hooks` + new session**, and Pi via **`/trust` then `/reload`** (soft min **≥0.85.1**; **R10** interactive TUI only — **not** `pi -p` / JSON), then:

1. Plan — Cursor/Claude: `/autopilot-on`; Codex / Kimi / Copilot / Grok: line-start `triggers.on`; Gemini / Factory / Hermes / Antigravity / Devin / Pi: host skills **and** line-start (typed slash still parses)
2. Execute — Cursor/Claude: `/autopilot-run`; Codex / Kimi / Copilot / Grok: line-start `triggers.run`; Gemini / Factory / Hermes / Antigravity / Devin / Pi: host skills **and** line-start

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
