# pin-upgrade-repo — 0.14.0

- Date: 2026-09-19T11:11+08:00
- Command: `node packages/cli/dist/bin.js upgrade` (CLI `0.14.0`)

## Pin

```json
{
  "autopilot-harness": "0.14.0"
}
```

`doctor`: `OK pin.json → 0.14.0` (no longer WARN pin ≠ package).

## Operator reminders

1. **Pi**: extension `.pi/extensions/autopilot.ts` (never `pi install`); after install/upgrade **`/trust` then `/reload`**; soft min **≥0.85.1**; surface is interactive TUI only (**R10**, not `pi -p` / JSON).
2. **OpenCode** remains hosts **1 (next)** (wait upstream).
3. Cursor: Reload Window if skills/hooks look stale; Claude Code / other CLIs: restart / new session if needed.
4. Shell hooks stay **ten-way**; Pi is an in-process extension, not a `--platform` stamp. Runner stays meta (not a shell platform).

**Result: PASS**
