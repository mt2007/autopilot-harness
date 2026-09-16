# Live smoke evidence — `live-antigravity-smoke` (**blocked**)

## Verdict

**Blocked / not passed** (2026-09-16→17). Host live **Stop-continue = 0**.  
**Ship gate: FAIL** — do **not** release 0.10 until live CLI (or IDE) proves Stop ≥1× + edit arm, **or** human-gate explicitly accepts **degraded**.

Surface attempted: **CLI** (`antigravity-cli` / `agy`). IDE not attempted (no Automation permission to drive Terminal/IDE from this session).

## Environment

| Item | Value |
|------|-------|
| Antigravity CLI | Homebrew cask `antigravity-cli` **1.2.4,6085322963025920** → `/opt/homebrew/bin/agy` |
| Runnable binary | **`/tmp/agy-bin`** copy — Caskroom binary often stuck at `_dyld_start` (quarantine / 32KB RSS); copy reaches main |
| Autopilot CLI | workspace `packages/cli` rebuild (dist includes `antigravity` / surface `cli`) |
| Disposable repo | `/tmp/ap-agy-live-vNdJJs` |
| Init | `init --yes --platform antigravity --surface cli` → `.agents/hooks.json` + `.agents/skills/autopilot-*` |
| Doctor | Autopilot hooks **OK**; WARN Stop-cap / IDE reload / auto-attach≠ON |

## Host live checks

| Check | Result |
|-------|--------|
| Hook fire by host | **No** |
| Edit / dirty-arm by host | **No** |
| Stop `decision:continue` | **0×** |
| Blocker | **Not logged into Antigravity** — print-mode silent auth failed; interactive OAuth waited 60s then timed out (`agy-print8.err`). Playwright browser driver 404. Terminal AppleEvent denied (−1743). |

## Wiring proof (synthetic — **not** ship-gate)

Same installed hook command + Antigravity-shaped stdin (gemini live used a similar AfterTool synthetic arm):

| Step | Stdout |
|------|--------|
| PostToolUse `write_to_file` | `{}` |
| Stop ×2 `fullyIdle:true` | `{"decision":"continue","reason":"Review fix round 1…"}` |

Confirms **installed** Autopilot Antigravity I/O shape on this machine; **does not** replace host live fire.

## What you need to unblock

In a normal Terminal (outside Cursor), once:

```bash
# optional if Caskroom agy hangs at launch:
cp /opt/homebrew/Caskroom/antigravity-cli/*/antigravity /tmp/agy-bin && xattr -c /tmp/agy-bin
/tmp/agy-bin   # or: agy
# complete Google OAuth when prompted
```

Then reply **继续** in this chat so the session can re-run print-mode on `/tmp/ap-agy-live-vNdJJs` (or a fresh disposable) for Stop ≥1× + edit arm.

## Artifacts

See `live-smoke-evidence.json` + `live-artifacts/` under this slug.
