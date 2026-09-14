# pin-upgrade-repo — 0.7.0

- Date: 2026-09-14T14:53Z
- Command: `node packages/cli/dist/bin.js upgrade` (CLI `0.7.0`)

## Pin

```json
{
  "autopilot-harness": "0.7.0"
}
```

`doctor`: `OK pin.json → 0.7.0` (no longer WARN pin ≠ package).

## Operator reminders

1. **Trust (Gemini CLI)**: after install/upgrade **re-trust** hooks, open **`/hooks panel`**, and ensure **folder trust** for the project.
2. **AfterAgent turn cap ≤100** (`MAX_TURNS`; `GEMINI_STOP_CAP_RAISE_FOUND=false`) — honest degraded ceiling; prefer CLI **≥0.31.0** so retry still fires AfterAgent + `stop_hook_active`. Mid-chain cutoffs → pending / `/autopilot-resume` / nudge.
3. Cursor: Reload Window if skills/hooks look stale; Claude Code: restart CLI if needed. If adding Gemini: reload/new session after `.gemini/settings.json` hooks install. Do **not** confuse host env `GEMINI_PLANS_DIR` with Autopilot `plans/`.

**Result: PASS**
