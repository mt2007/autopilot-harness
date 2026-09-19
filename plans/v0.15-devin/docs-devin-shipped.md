# docs-devin-shipped — evidence

**Date:** 2026-09-19  
**Posture:** **Devin CLI = Shipped** (full) — interactive CLI live Stop-continue **≥1× proved** + edit arm yes (see `live-smoke-evidence.md`). Aim ≥2× optional. **CLI only** — not Desktop / cloud Devin / Cascade. **Roadmap 1 (next) = OpenCode** (wait upstream). Public package bump stays in `changelog-bump-0-15-0`; living docs + CHANGELOG **`[0.15.0]`** notes land here. Do **not** edit older CHANGELOG sections.

## Living docs updated

| Doc | Devin markers |
|-----|---------------|
| `docs/hosts.md` | Status row **Shipped**; skills `.devin/skills`; roadmap OpenCode **1 (next)** wait upstream; stop-loop row; `$DEVIN_PROJECT_DIR`; **eleven-way**; Related tip |
| `README.md` / `README.zh-CN.md` | Ships list includes Devin full Shipped; init `--platform devin`; OpenCode **1 (next)** wait upstream / 等上游; monorepo `port-devin` |
| `docs/architecture.md` | Ports tree + vendor `handleDevin*`; stop-loop **Shipped**; **eleven-way shell + Pi extension** |
| `docs/config.md` | platforms / ignore defaults / confirm_rounds / Related (OpenCode next; Devin Shipped) |
| `docs/troubleshooting.md` | `### Devin CLI` — path, `$DEVIN_PROJECT_DIR`, soft min **≥3000.10.31**, `/hooks`, CLI-only, live ≥1× |
| `packages/cli/README.md` | Ships Devin Shipped; `--platform devin`; `$DEVIN_PROJECT_DIR`; OpenCode **1 (next)** |
| `.autopilotignore` | Already had `.devin/hooks.v1.json` + `.devin/skills/**` |
| `CHANGELOG.md` | New **`[0.15.0]`** section (docs-devin-shipped + port notes); Unreleased empty of Devin markers |
| `packages/cli/tests/docs-contract.test.ts` | Devin Shipped + eleven-way; OpenCode next + wait upstream; negatives against next/degraded/Desktop-supported |

## Contract notes

- Soft min Devin **≥3000.10.31** (doctor WARN).
- Paths: **`.devin/hooks.v1.json`** (not `config.json` hooks); skills **`.devin/skills/autopilot-*`**; commands **`$DEVIN_PROJECT_DIR`**.
- Trust: after install/upgrade **`/hooks` + new session**.
- Shell matrix is **eleven-way** (Devin in `KNOWN_PLATFORMS`) + Pi extension.
- Live gate for this docs item: continue ≥1× + edit arm proved — **full Shipped** (not degraded).
