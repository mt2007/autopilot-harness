# Autopilot (Cursor) — thin discovery

This package is **discovery-only**. It does **not** install Autopilot hooks, vendor runtime, or `.autopilot/` config.

## Required wiring

```bash
cd /path/to/your-app
npx @autopilot-harness/cli init --platform cursor --yes
npx @autopilot-harness/cli doctor
```

Then reload the Cursor window and run `/autopilot-on`.

Full matrix: https://github.com/mt2007/autopilot-harness/blob/main/docs/install.md
