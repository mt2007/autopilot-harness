# human-gate-confirm — 0.8.0

## Live chain

**Passed** — Factory Droid live smoke on disposable repo (`plans/v0.8-factory-droid/live-smoke-evidence.md` / `.json`).  
CLI **0.218.2**; **≥2×** Stop `decision:block` continue; **≥3×** block while `stop_hook_active=true`.  
Ship posture: **full multi-block** (`FACTORY_DROID_ALLOW_MULTI_BLOCK_WHEN_ACTIVE=true`, `FACTORY_DROID_MULTI_BLOCK_ACROSS_ACTIVE_PROVEN=true`) — **not** degraded≤1.  
**No waive** — multi risk signed by live proof, not by human waiver.  
**Live PASS ≠ publish OK.**

## Ready to ship (local)

| Check | Status |
|-------|--------|
| Tip commit | `9548b27` — commit-local checked off on v0.8 checklist |
| Commit-local evidence | `5c13bef` — tree-clean gate recorded |
| Version bump | `fa21993` — public packages @ **0.8.0** (incl. `port-factory-droid`) |
| Branch | `main` ahead of origin by **16** (not pushed) |
| Working tree | clean (only untracked `tmp/` dumps, not staged) |
| Pack assert | 11 public tarballs @0.8.0, no `workspace:*`; `publish-workspace-deps` 12/12 |
| Pin | still **0.7.0** (0.7 publish+pin done; pin-upgrade-repo →0.8.0 after publish) |
| Stacked release | **Allowed** — repo pin already at 0.7.0; 0.8 ships on top |
| Stop / multi | live-proved multi across `stop_hook_active` (not degraded≤1) |
| Trust | `/hooks` + snapshot/reload; `$FACTORY_PROJECT_DIR` |

## Gate (presented)

Soft completion = **presentation done**. Do **not** push / tag `v0.8.0` / `gh release` / `pnpm publish` until chat explicitly replies:

> **同意发 0.8.0**

## Consent

- **Received** via advance instruction to check off `human-gate-confirm` and implement `push-tag-release` (push/tag/GH Release) — 2026-09-15.
- Tip at consent commit will record checklist `[x]` + this evidence.

**Result: PASS (consented; push/tag next; npm publish still gated).**
