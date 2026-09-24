---
name: autopilot-install
description: Point users at Autopilot CLI init for Codex. Use when the user wants to install or enable Autopilot. Installing this thin plugin alone does not wire hooks or vendor.
---

# Install Autopilot (Codex pointer)

This plugin is **discovery-only**. It does **not** install hooks, vendor runtime, or `.autopilot/` config.

## Required wiring

From the project you want to instrument (Node.js 22+):

```bash
npx @autopilot-harness/cli init --platform codex --yes
npx @autopilot-harness/cli doctor
```

Trust `/hooks` after init (re-trust after hook changes).

Full matrix and host notes: https://github.com/mt2007/autopilot-harness/blob/main/docs/install.md

Do not claim Autopilot is ready until `init` and `doctor` succeed.
