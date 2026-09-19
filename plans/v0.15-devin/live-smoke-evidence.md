# Live smoke evidence — `live-devin-smoke` (**proven ≥1**)

## Verdict

**Proven** (2026-09-19). Interactive Devin CLI, not `-p`. Edit arm **yes**. Host continue **1×**: the next user turn is the harness `Review fix round 1` text, and the model treated it as the request. Aim **≥2× not reached** — the driver was stopped during that first review turn.

Not degraded. Hard gate (≥1× + edit arm) is met. `0.15.0` bump is still a later checklist item.

## Environment

| Item | Value |
|------|-------|
| Devin | **3000.10.31** (`b98cc431`) |
| Surface | interactive CLI (`--permission-mode accept-edits`), **not** `-p` / `--print` |
| Model | `swe-1-6-slow` |
| Login | Logged in (via Devin), tier Devin Free |
| Disposable repo | `/Users/zhaoqingli/tmp/ap-devin-live-di5C0A` (`init --yes --platform devin --surface cli`) |
| Claude hooks | **absent** (no `.claude/settings.json`; hooks file has no `claude-code` stamp) |
| Session | Devin `green-node` |

`/tmp` print mode was refused as an untrusted workspace. The ship run used a directory under the already-trusted home path and an interactive PTY, not `--print`.

## What ran

1. Fresh disposable init wrote `.devin/hooks.v1.json` (`$DEVIN_PROJECT_DIR`, `--platform devin`) and `.devin/skills/autopilot-*` only.
2. One interactive prompt asked for a single edit: append `// live-smoke` to `src/hello.ts`.
3. The model used the **edit** tool. `src/hello.ts` ends with `// live-smoke`.
4. After that turn, Devin injected a user message whose content starts `Review fix round 1`. The next assistant turn reads `.autopilotignore` and answers the review.
5. SQLite: `platform=devin`, `phase=idle`, `armed=1`, `track_id` unset (no `Autopilot RUN` on the prompt). `review_chains`: `fix_round=1`, `chain_pending=1`, `pending_followup` starts `Review fix round 1`. `code_edited` is 0 after that followup was delivered.

## Gates

| Gate | Status |
|------|--------|
| Interactive CLI, not `-p` | **Yes** |
| No Claude Autopilot hooks | **Yes** |
| Edit arm (`edit` tool + `// live-smoke`) | **Yes** |
| continue ≥1× | **Yes** (1× user message = harness Review fix) |
| continue ≥2× (aim) | **No** |
| RUN binds `track_id=live-devin-smoke` / `phase=executing` | **No** (prompt was the edit only) |
| Desktop | **Not tested** |
| Ship 0.15.0 | **Not yet** — docs/bump still unchecked |
