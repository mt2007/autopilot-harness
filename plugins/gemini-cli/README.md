# Autopilot (Gemini CLI) — thin discovery

This package is **discovery-only**. It does **not** install Autopilot hooks, vendor runtime, or `.autopilot/` config.

Point Gemini extensions at **this package directory** (the folder that contains `gemini-extension.json`) — **not** the monorepo root. In this repository that folder is `plugins/gemini-cli/`.

## Required wiring

```bash
cd /path/to/your-app
npx @autopilot-harness/cli init --platform gemini-cli --yes
npx @autopilot-harness/cli doctor
```

Re-trust hooks / folder trust as needed after init.

Full matrix: https://github.com/mt2007/autopilot-harness/blob/main/docs/install.md
