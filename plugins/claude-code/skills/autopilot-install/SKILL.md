---
name: autopilot-install
description: Point users at Autopilot CLI init for Claude Code. Use when the user wants to install or enable Autopilot. Installing this thin plugin alone does not wire hooks or vendor.
---

# Install Autopilot (Claude Code pointer)

This plugin is **discovery-only**. It does **not** install hooks, vendor runtime, or `.autopilot/` config.

## Required wiring

From the project you want to instrument (Node.js 22+):

```bash
npx @autopilot-harness/cli init --platform claude-code --yes
npx @autopilot-harness/cli doctor
```

Then start a new session and run `/autopilot-on`.

Full matrix and host notes: https://github.com/mt2007/autopilot-harness/blob/main/docs/install.md

Do not claim Autopilot is ready until `init` and `doctor` succeed.
