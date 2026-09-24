---
name: autopilot-install
description: Point users at Autopilot CLI init for Gemini CLI. Use when the user wants to install or enable Autopilot. Installing this thin extension alone does not wire hooks or vendor.
---

# Install Autopilot (Gemini CLI pointer)

This extension is **discovery-only**. It does **not** install hooks, vendor runtime, or `.autopilot/` config.

Point Gemini at this package directory — not the monorepo root.

## Required wiring

From the project you want to instrument (Node.js 22+):

```bash
npx @autopilot-harness/cli init --platform gemini-cli --yes
npx @autopilot-harness/cli doctor
```

Re-trust hooks / folder trust as needed after init.

Full matrix and host notes: https://github.com/mt2007/autopilot-harness/blob/main/docs/install.md

Do not claim Autopilot is ready until `init` and `doctor` succeed.
