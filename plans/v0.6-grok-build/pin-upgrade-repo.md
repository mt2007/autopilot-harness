# pin-upgrade-repo — 0.6.0

- Date: 2026-09-13T16:28Z
- Command: `node packages/cli/dist/bin.js upgrade` (CLI `0.6.0`)

## Pin

```json
{
  "autopilot-harness": "0.6.0"
}
```

`doctor`: `OK pin.json → 0.6.0` (no longer WARN pin ≠ package).

## Operator reminders

1. **Trust (Grok Build)**: after install/upgrade run **`/hooks-trust`** or start with **`--trust`**. Optional compat tip: `compat.*.hooks=false` (does not auto-edit `~/.grok/config.toml`).
2. **Stop ≤8/turn** — no raise found (`GROK_STOP_CAP_RAISE_FOUND=false`); per-turn reset (not Copilot consecutive). Mid-chain cutoffs → pending / `/autopilot-resume` / nudge.
3. Cursor: Reload Window if skills/hooks look stale; Claude Code: restart CLI if needed. If adding Grok: reload/new session after hooks install.

**Result: PASS**
