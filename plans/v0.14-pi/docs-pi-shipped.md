# docs-pi-shipped — evidence

**Date:** 2026-09-18  
**Posture:** **Pi = Shipped** (full) — interactive TUI live Stop-continue **≥1× proved** + edit arm yes (see `live-smoke-evidence.md`). Aim ≥2× optional. **Roadmap 1 (next) = OpenCode** (wait upstream). No public **0.14.0** bump in this item; do **not** edit older CHANGELOG sections.

## Living docs updated

| Doc | Pi markers |
|-----|------------|
| `docs/hosts.md` | Status row **Shipped**; skills share `.agents/skills`; roadmap already covered; stop-loop row; doctor FAIL/leftover; Related tip |
| `README.md` / `README.zh-CN.md` | Ships list includes Pi full Shipped; init `--platform pi`; OpenCode **1 (next)** wait upstream / 等上游; monorepo `port-pi` |
| `docs/architecture.md` | Ports tree + vendor `handlePi*`; stop-loop **Shipped**; ten-way shell + Pi extension |
| `docs/config.md` | platforms / doctor (FAIL + leftover WARN) / confirm_rounds / ignore defaults / Related |
| `docs/troubleshooting.md` | `### Pi` — path, `/trust`+`/reload`, soft min **≥0.85.1**, **R10** TUI-only, leftover WARN, live ≥1× |
| `packages/cli/README.md` | Ships Pi Shipped; **never** `pi install`; `--platform pi`; trust/reload; KNOWN_PLATFORMS tip |
| `.autopilotignore` | `.pi/extensions/autopilot*` |
| `packages/cli/tests/docs-contract.test.ts` | Pi Shipped + negatives against degraded/unproven; OpenCode next + wait upstream; R10 / soft min / paths / leftover |

## Contract notes

- Soft min Pi **≥0.85.1** (doctor WARN).
- **R10:** Autopilot surface = interactive TUI only — **`pi -p` / JSON / print unsupported**.
- Paths: **`.pi/extensions/autopilot.ts`** (direct write; never `pi install`); skills **share** Antigravity **`.agents/skills/autopilot-*`**.
- Trust: after install/upgrade **`/trust` then `/reload`**.
- Shell matrix stays **ten-way** (Pi not in `KNOWN_PLATFORMS`).
- Live gate for this docs item: continue ≥1× + edit arm proved — **full Shipped** (not degraded).
