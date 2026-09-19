# push-tag-release — 0.14.0

- Date: 2026-09-19T10:57+08:00
- Tip: `30e5c0e` (`chore(plans): check off human-gate-confirm for 0.14.0`)
- Branch: `main` == `origin/main` (pushed)

## Actions

| Step | Result |
|------|--------|
| `git push origin HEAD` | OK (`ecd9cce..30e5c0e`) |
| `git tag -a v0.14.0` + `git push origin v0.14.0` | OK (annotated → `30e5c0e`) |
| `gh release create v0.14.0` | OK |

## Links

- Tag: `v0.14.0`
- Release: https://github.com/mt2007/autopilot-harness/releases/tag/v0.14.0

**Result: PASS** — push + tag + GitHub Release done. npm publish still pending.
