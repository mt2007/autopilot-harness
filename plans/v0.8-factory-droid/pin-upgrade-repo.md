# pin-upgrade-repo — 0.8.0

- Date: 2026-09-15T12:04Z
- Command: `node packages/cli/dist/bin.js upgrade` (CLI `0.8.0`)

## Pin

```json
{
  "autopilot-harness": "0.8.0"
}
```

`doctor`: `OK pin.json → 0.8.0` (no longer WARN pin ≠ package).

## Operator reminders

1. **Trust (Factory Droid)**: after install/upgrade run **`/hooks` + snapshot/reload** when applicable; ensure `$FACTORY_PROJECT_DIR` is the instrumented project root.
2. **Stop multi-block**: live-proved under `stop_hook_active` (`FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE=true`, `FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN=true`) — **not** degraded≤1 for this release. Waive live → default degraded≤1.
3. Cursor: Reload Window if skills/hooks look stale; Claude Code / other CLIs: restart / new session if needed. If adding Factory: reload after `.factory/hooks.json` install. Allow path must be **zero-byte stdout** (never `{}`).

**Result: PASS**
