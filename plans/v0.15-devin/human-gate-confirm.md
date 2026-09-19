# human-gate-confirm — 0.15.0

## Live chain

**Not waived.** Interactive CLI live Stop-continue **≥1× proved** + edit arm (`live-smoke-evidence.md`, 2026-09-19).

- continue **1×** (harness `Review fix round 1` injected as the next user turn)
- edit arm **yes** (`edit` tool + `// live-smoke`)
- aim **≥2× not reached** — still meets the hard gate **≥1×**
- posture: **full Shipped** (not degraded; no degraded ack required)
- surface: **CLI only** — not Desktop / cloud Devin / Cascade

## Ready to ship (local)

| Check | Status |
|-------|--------|
| Tip | `f99dd40` chore(plans): check off commit-local for 0.15.0 |
| Branch | `main` ahead of `origin/main` by 20 — **not pushed** |
| Commit-local | recorded — tree clean at that item; no push/tag/publish (`commit-local.md`) |
| Pack assert | 16 public tarballs @0.15.0 (incl. `port-devin`), no `workspace:*`; publish-workspace-deps 17/17 (`local-npm-pack-assert.md`) |
| Version bump | public packages + `PACKAGE_VERSION` @ **0.15.0** |
| Docs | Devin CLI **Shipped** (full, CLI only); OpenCode restored as **1 (next)** (wait upstream); eleven-way |
| Pin | still **0.14.0** (pin-upgrade-repo →0.15.0 after publish) |
| Live | **passed ≥1×** — not a waive; not degraded |

## Gate (presented)

Required ack before push/tag:

1. **同意发 0.15.0**
2. Degraded ack **not required** (full Shipped; live ≥1× proved)

## Consent

- Soft: gate presentation recorded (2026-09-19T19:42+08:00).
- **Received** (2026-09-19T19:49+08:00): human wrote **同意发 0.15.0**.
- Interpreted as consent: ship **0.15.0** **full Shipped** (live ≥1× proved; degraded ack not required).
- Tip at consent: `f99dd40`. Push/tag/publish still not done in this turn.

**Result: PASS (consented; full Shipped; degraded ack not required).**
