# Autopilot (Factory Droid) — thin discovery

This package is **discovery-only**. It does **not** install Autopilot hooks, vendor runtime, or `.autopilot/` config.

## Required wiring

```bash
cd /path/to/your-app
npx @autopilot-harness/cli init --platform factory-droid --yes
npx @autopilot-harness/cli doctor
```

Ensure `$FACTORY_PROJECT_DIR` is the instrumented root; use `/hooks` then reload.

Full matrix: https://github.com/mt2007/autopilot-harness/blob/main/docs/install.md
