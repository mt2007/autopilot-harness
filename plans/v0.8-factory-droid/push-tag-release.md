# push-tag-release — 0.8.0

- Date: 2026-09-15T11:36Z
- Tip: `66ff843`
- Branch: `main` == `origin/main` (pushed)

## Actions

| Step | Result |
|------|--------|
| `git push origin HEAD` | OK (`e1ec0fe..66ff843`) |
| `git tag -a v0.8.0` + `git push origin v0.8.0` | OK |
| `gh release create v0.8.0` | OK |

## Links

- Tag: `v0.8.0`
- Release: https://github.com/mt2007/autopilot-harness/releases/tag/v0.8.0

**Result: PASS** — push + tag + GitHub Release done. npm publish still pending.
