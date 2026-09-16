# pin-upgrade-repo — 0.10.0

- Date: 2026-09-16T21:55Z
- Command: `node packages/cli/dist/bin.js upgrade` (CLI `0.10.0`)

## Pin

```json
{
  "autopilot-harness": "0.10.0"
}
```

`doctor`: `OK pin.json → 0.10.0` (no longer WARN pin ≠ package).

## Operator reminders

1. **Trust (Antigravity)**: after install/upgrade prefer a **firing surface (CLI)**; reload IDE if hooks silent; **auto-attach ≠ Autopilot ON**; `.agents/hooks.json` + `.agents/skills/autopilot-*` (does **not** write `.agent/`). Host live Stop-continue was **unproven** at ship — posture **degraded** until re-live.
2. **Skills co-install**: when Gemini/Factory/Hermes are enabled, Autopilot skills live under `.gemini/skills`, `.factory/skills`, `$HERMES_HOME/skills` respectively (Gemini stays under `.gemini/skills` even if Antigravity is also on).
3. Cursor: Reload Window if skills/hooks look stale; Claude Code / other CLIs: restart / new session if needed.

**Result: PASS**
