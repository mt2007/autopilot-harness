# Install

**Source of truth** for discovering and wiring Autopilot on every shipped host. Product overview: [README.md](../README.md). Host capabilities: [hosts.md](./hosts.md). Cheat sheet: [autopilot/quickstart.md](./autopilot/quickstart.md).

**Hard rule:** host-native discovery (plugin / marketplace / extension) is optional. **Wiring always requires** `npx @autopilot-harness/cli init` (or `upgrade`) so hooks, vendor runtime, and `.autopilot/` stay consistent. A thin plugin or skill that only points at Autopilot is **not** a substitute for `init`.

Requires **Node.js 22+**. Prefer the scoped package `@autopilot-harness/cli` (bin: `autopilot-harness`). Run commands with **cwd = the project** you want to instrument.

[中文](./install.zh-CN.md)

## Universal path

```bash
cd /path/to/your-app
npx @autopilot-harness/cli init --yes
# or pick a host:
# npx @autopilot-harness/cli init --platform <id> --yes
# after first install, add another host:
# npx @autopilot-harness/cli init --yes --add-platform <id>
npx @autopilot-harness/cli status
npx @autopilot-harness/cli doctor
```

Interactive TUI: omit `--yes`. Flags: `npx @autopilot-harness/cli init --help`.

## Matrix (all installable ids)

| `id` | Surface | Init (required) | Discover (optional Batch 1) | After init |
|------|---------|-----------------|-----------------------------|------------|
| `cursor` | ide | `init --platform cursor --yes` | When present: `.cursor-plugin/marketplace.json` → `plugins/cursor/` | Reload Window; `/autopilot-on` |
| `claude-code` | cli | `init --platform claude-code --yes` | When present: `.claude-plugin/marketplace.json` → `plugins/claude-code/` | Restart/new session; `/autopilot-on` |
| `codex` | cli | `init --platform codex --yes` | When present: thin package `plugins/codex/` | `/hooks` trust; line-start or skills |
| `kimi-code` | cli | `init --platform kimi-code --yes` | Docs / `npx` only this release | Prefer `confirm_rounds: 1`; `/skill:autopilot-on` |
| `copilot-cli` | cli | `init --platform copilot-cli --yes` | Docs / `npx` only this release | **Restart Copilot CLI** |
| `grok-build` | cli | `init --platform grok-build --yes` | Docs / `npx` only this release | `/hooks-trust` or `--trust` |
| `gemini-cli` | cli | `init --platform gemini-cli --yes` | When present: `plugins/gemini-cli/` (`gemini-extension.json`) | Re-trust / `/hooks panel` / folder trust |
| `factory-droid` | cli | `init --platform factory-droid --yes` | When present: thin package `plugins/factory-droid/` | `$FACTORY_PROJECT_DIR`; `/hooks` + reload |
| `hermes-agent` | cli | `init --platform hermes-agent --yes` | Docs / `npx` only this release | Consent; `hermes hooks doctor` |
| `antigravity` | cli | `init --platform antigravity --yes` | Docs / `npx` only this release | Mount workspace; reload |
| `pi` | cli (in-process) | `init --platform pi --yes` | **Never** `pi install` for Autopilot | `/trust` then `/reload`; **TUI only** |
| `devin` | cli | `init --platform devin --yes` | Docs / `npx` only this release | `$DEVIN_PROJECT_DIR`; `/hooks`; **CLI only** |
| `runner` | runner | `init --yes --add-platform runner` (or `init --platform runner --yes` as first host) | **npm / docs only** — no host marketplace plugin | Set `runner.command`; `npx @autopilot-harness/cli runner start …` |

**OpenCode** is roadmap-only — `init` does **not** install it. Use another shipped host or Runner until upstream stop-continue ships.

**Batch-1 discover honesty:** paths like `.cursor-plugin/marketplace.json`, `.claude-plugin/marketplace.json`, and `plugins/<id>/` are this repository’s thin-discovery layout. If those files are missing on the revision you cloned, **skip Discover** and use **Init** only — wiring never depends on the thin packages.

## Per host

### cursor

1. **Discover (optional):** when root `.cursor-plugin/marketplace.json` and `plugins/cursor/` exist on your clone, add this repo as a Cursor marketplace and install the Autopilot thin entry if offered.
2. **Init (required):** `npx @autopilot-harness/cli init --platform cursor --yes`
3. **Doctor:** `npx @autopilot-harness/cli doctor` → Reload Window → `/autopilot-on`

### claude-code

1. **Discover (optional):** when `.claude-plugin/marketplace.json` and `plugins/claude-code/` exist, `/plugin marketplace add mt2007/autopilot-harness` (or git URL), then install the listed Autopilot plugin.
2. **Init (required):** `npx @autopilot-harness/cli init --platform claude-code --yes`
3. **Doctor:** `doctor` → new session → `/autopilot-on`

### codex

1. **Discover (optional):** when `plugins/codex/` exists, install / link that thin package per Codex plugin docs (still not a replacement for hooks).
2. **Init (required):** `npx @autopilot-harness/cli init --platform codex --yes`
3. **Doctor:** trust `/hooks` (re-trust after changes) → line-start `Autopilot ON` or skills under `.agents/skills`

### kimi-code

1. **Discover:** use `npx` (no Batch-1 thin package this release).
2. **Init:** `npx @autopilot-harness/cli init --platform kimi-code --yes` (writes user-home hooks; prefer `confirm_rounds: 1`).
3. **Doctor:** `doctor` → `/skill:autopilot-on` and/or line-start triggers.

### copilot-cli

1. **Discover:** `npx` only this release.
2. **Init:** `npx @autopilot-harness/cli init --platform copilot-cli --yes`
3. **Doctor:** **Restart Copilot CLI** → `doctor`.

### grok-build

1. **Discover:** `npx` only this release.
2. **Init:** `npx @autopilot-harness/cli init --platform grok-build --yes`
3. **Doctor:** `/hooks-trust` or `--trust` → reload/new session → `doctor`.

### gemini-cli

1. **Discover (optional):** when `plugins/gemini-cli/gemini-extension.json` exists, point Gemini extensions at that directory — **not** the monorepo root.
2. **Init (required):** `npx @autopilot-harness/cli init --platform gemini-cli --yes`
3. **Doctor:** re-trust hooks, `/hooks panel`, folder trust → `doctor`.

### factory-droid

1. **Discover (optional):** when `plugins/factory-droid/` exists, add / install from it per Droid plugin docs.
2. **Init (required):** `npx @autopilot-harness/cli init --platform factory-droid --yes`
3. **Doctor:** ensure `$FACTORY_PROJECT_DIR` is the instrumented root; `/hooks` then reload → `doctor`.

### hermes-agent

1. **Discover:** `npx` only this release (Autopilot uses shell hooks in `$HERMES_HOME/config.yaml`, not a Hermes plugin substitute).
2. **Init:** `npx @autopilot-harness/cli init --platform hermes-agent --yes`
3. **Doctor:** consent / `--accept-hooks`; `hermes hooks doctor` → `doctor`.

### antigravity

1. **Discover:** `npx` only this release.
2. **Init:** `npx @autopilot-harness/cli init --platform antigravity --yes`
3. **Doctor:** CLI must mount the project workspace; reload → `doctor`. Auto-attach ≠ Autopilot ON.

### pi

1. **Discover:** **do not** use `pi install` for Autopilot (R6). Init **direct-writes** `.pi/extensions/autopilot.ts`.
2. **Init:** `npx @autopilot-harness/cli init --platform pi --yes`
3. **Doctor:** `/trust` then `/reload` → interactive **TUI only** (not `pi -p` / JSON / print).

### devin

1. **Discover:** `npx` only this release.
2. **Init:** `npx @autopilot-harness/cli init --platform devin --yes`
3. **Doctor:** `$DEVIN_PROJECT_DIR` = instrumented root; `/hooks` + new session. **CLI only** — not Desktop / cloud Devin / Cascade.

### runner

1. **Discover:** npm / docs only — no host marketplace plugin.
2. **Init:** `npx @autopilot-harness/cli init --platform runner --yes` (first host) **or** `init --yes --add-platform runner` after another host; set trusted **`runner.command`**.
3. **Doctor / run:** `npx @autopilot-harness/cli doctor`; then `npx @autopilot-harness/cli runner start --on …` / `--run <slug>` / resume. See [hosts.md](./hosts.md) Runner row and [config.md](./config.md).

## Multi-host

After the first `init`, add another installable host with `--add-platform <id>` (does not invent OpenCode). Enabling `kimi-code` clamps `review.confirm_rounds` to **1** for the whole project.

## Related

- [Hosts](./hosts.md) — caps, skills paths, roadmap  
- [Config](./config.md) — `.autopilot/config.yml`, `review.scope`, triggers  
- [Troubleshooting](./troubleshooting.md) — doctor WARNs  
- [Quickstart](./autopilot/quickstart.md) · [中文](./autopilot/quickstart.zh-CN.md)  
- [CLI package README](../packages/cli/README.md)
