# human-gate-confirm — 0.7.0

## Live chain

**Passed** — Gemini CLI live smoke on disposable repo (`plans/v0.7-gemini-cli/live-smoke-evidence.md` / `.json`).  
CLI **0.59.0** (≥ soft min **0.31.0**); **≥2×** AfterAgent `decision:"deny"` continue; relative hook path OK.  
See evidence caveats (headless tool flakiness; host API 400 after continues).  
**Live PASS ≠ publish OK.**

## Ready to ship (local)

| Check | Status |
|-------|--------|
| Tip commit | `24b070b` — commit-local gate recorded |
| Version bump | `3c02f16` — public packages @ **0.7.0** (incl. `port-gemini-cli`) |
| Branch | `main` ahead of origin by **15** (not pushed) |
| Working tree | clean (after commit-local evidence) |
| Pack assert | 10 public tarballs @0.7.0, no `workspace:*`; `--help` / `status` / `doctor` OK |
| Pin | still **0.6.0** (pin-upgrade-repo after publish) |
| Stop cap | honest **MAX_TURNS ≤100** (degraded); soft min CLI **≥0.31.0**; no raise found |
| Trust | hook re-trust / `/hooks panel` / **folder trust** after install/upgrade |

## Gate (presented)

Soft completion = **presentation done**. Do **not** push / tag `v0.7.0` / `gh release` / `pnpm publish` until chat explicitly replies:

> **同意发 0.7.0**

**Result: PASS (presented; publish still gated).**
