# human-gate-confirm — 0.10.0

## Live chain

**Blocked / not passed** — Antigravity host live smoke (`plans/v0.10-antigravity/live-smoke-evidence.md` / `.json`).  
Surface attempted: **CLI** (`agy` / antigravity-cli); IDE not attempted.  
Host live **Stop-continue = 0**; edit/dirty-arm by host **No**.  
Blocker: **OAuth / not logged in** (print-mode auth fail; interactive OAuth timeout).  
Synthetic wiring proved `decision:continue`×2 on installed hooks — **does not** replace host live fire.  

Ship posture (docs): **Shipped (degraded — host live Stop-continue unproven)**.  
**Ship gate (brief/checklist): FAIL until live ≥1× Stop+edit OR human explicitly accepts degraded.**  
**Live FAIL ≠ auto-stop forever** — only human gate may authorize **degraded** ship.  
**Live PASS ≠ publish OK** (N/A here); **degraded consent ≠ push yet**.

## Ready to ship (local) — pending human consent

| Check | Status |
|-------|--------|
| Tip | `2d4c189` — docs: record 0.10.0 commit-local gate (tree clean) |
| Commit-local evidence | `2d4c189` — tree-clean gate recorded |
| Pack assert | `3229968` — 13 public tarballs @0.10.0, no `workspace:*`; publish-workspace-deps 14/14 |
| Version bump | `5a65ed9` — public packages @ **0.10.0** (incl. `port-antigravity`) |
| Docs | `f5b31c2` — Antigravity Shipped ten-way **degraded** + CHANGELOG `[0.10.0]` |
| Branch | `main` ahead of origin by **16** (not pushed) |
| Working tree | clean after this note is committed with checklist tick for prior item |
| Pin | still **0.9.0** (pin-upgrade-repo →0.10.0 after publish) |
| Live / waive | **host live FAIL**; degraded ship requires **explicit** human ack (below) |
| Trust | `.agents/hooks.json` + skills; symlink fail-closed; auto-attach ≠ ON; Prefer firing surface (CLI) |

## Gate (presented)

Soft completion = **presentation done**. Do **not** push / tag `v0.10.0` / `gh release` / `pnpm publish` until chat explicitly replies **both**:

1. > **同意发 0.10.0**
2. > **接受 degraded**（或同等明确认：活链未过仍诚实发半残）

Either alone is **not** enough. Re-live (Stop ≥1× + edit arm) may replace (2) with a fresh live PASS evidence update.

## Consent

- **Not received** in this turn — advance only checked off `commit-local` and asked to **present** this gate.
- Awaiting explicit dual ack before tick `human-gate-confirm` / any push-tag/publish.

**Result: PRESENTED (waiting dual consent; no push/tag/publish).**
