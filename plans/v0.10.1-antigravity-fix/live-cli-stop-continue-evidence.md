# Live evidence — `live-cli-stop-continue` (**FAIL / 停发**)

## Verdict

**Not passed** (2026-09-17). Ship gate: **FAIL** — do **not** release **0.10.1**.

| Requirement | Result |
|-------------|--------|
| `$HOME` disposable repo | **Yes** — `/Users/zhaoqingli/ap-agy-live-1fxxrj` |
| Workspace mounted (`--add-dir`) | **Yes** |
| Host hooks fire | **Yes** — PreInvocation ×2, Stop ×2 |
| Edit non-ignore file via host | **No** — no PostToolUse; `app.js` unchanged by host |
| Host Stop `decision:continue` ≥1× | **Yes (1×)** — recover tip on host `terminationReason: ERROR` |
| Host `NO_TOOL_CALL` + edit-arm continue | **Not this session** |

Surface: **CLI** (`agy` / antigravity-cli). IDE not attempted.

## Host live (this session)

| Check | Result |
|-------|--------|
| Init | `packages/cli` dist → antigravity + `.agents/bin` shim + vendor |
| Doctor | hook binary / vendor OK; CLI workspace tip WARN present |
| Hook command (CLI cwd `.agents`) | `node bin/autopilot-harness-hook.mjs --platform antigravity --event …` (evidence wrap → real `.autopilot/bin` hook) |
| Prompt | overwrite `app.js` → `export const n = 2`; stop |
| Host Stop #1 stdout | `{"decision":"continue","reason":"Recover: … Autopilot RUN is not active."}` |
| Host Stop stdin shape | `terminationReason: "ERROR"`, `fullyIdle: true`, `transcriptPath: …/logs/transcript_full.jsonl` |
| Host Stop #2 stdout | `{}` |
| PostToolUse | **0** |

Host agent turn did not edit files (host returned Eligibility / `PERMISSION_DENIED` on the turn — **out of Autopilot scope** per plan; not expanded here).

## Supplementary (not ship-gate alone)

Prior-day **host-captured** Stop stdin (`terminationReason: NO_TOOL_CALL`, `fullyIdle: true`, `transcript_full.jsonl`) replayed through **today’s** installed vendor/hook with an armed executing session →

`{"decision":"continue","reason":"Review fix round 1 …"}`

Confirms the Autopilot-side `NO_TOOL_CALL` gate fix on a real host payload shape. **Does not** replace a full host edit+Stop continue on an eligible agent turn.

## Artifacts

Under `plans/v0.10.1-antigravity-fix/live-artifacts/`:

- `hook-invocations.jsonl`, `hook-stdout.jsonl`, `Stop-last-stdin.json`
- `replay-no-tool-call.out`, `err.txt`, `cli-excerpt.txt`, `meta.txt`

## Unblock

When the host can complete an agent edit turn on this machine, re-run print-mode on a `$HOME` disposable with `--add-dir` and require: PostToolUse arm + Stop `decision:continue` (prefer `NO_TOOL_CALL`). Until then **do not ship 0.10.1**.
