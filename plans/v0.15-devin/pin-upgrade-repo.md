# pin-upgrade-repo — 0.15.0

- Date: 2026-09-19T20:07+08:00
- Command: `node packages/cli/dist/bin.js upgrade` (CLI `0.15.0`)

## Pin

```json
{
  "autopilot-harness": "0.15.0"
}
```

`doctor`: `OK pin.json → 0.15.0` (no longer WARN pin ≠ package).

## Operator reminders

1. **Devin CLI**: hooks `.devin/hooks.v1.json` (not `config.json` hooks); commands use `$DEVIN_PROJECT_DIR`; after install/upgrade check **`/hooks`**, then open a **new session**; soft min **≥3000.10.31**; **CLI only** — not Desktop.
2. **Pi**: extension `.pi/extensions/autopilot.ts` (never `pi install`); after install/upgrade **`/trust` then `/reload`**; soft min **≥0.85.1**; surface is interactive TUI only (**R10**, not `pi -p` / JSON).
3. **OpenCode** remains hosts **1 (next)** (wait upstream).
4. Cursor: Reload Window if skills/hooks look stale; Claude Code / other CLIs: restart / new session if needed.
5. Shell hooks are **eleven-way**; Pi is an in-process extension, not a `--platform` stamp. Runner stays meta (not a shell platform).

**Result: PASS**
