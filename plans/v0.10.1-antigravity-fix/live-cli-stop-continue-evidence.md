# Live evidence — `live-cli-stop-continue` (**PASS**)

## Verdict

**Passed** (2026-09-17, replan). Ship gate: **PASS** — may proceed to **0.10.1** release items.

| Requirement | Result |
|-------------|--------|
| Workspace project | **Yes** — `/Users/zhaoqingli/workspaces/tmp/agy` |
| Workspace mounted | **Yes** — agy CLI `workspaceDirs=[…/tmp/agy]` |
| Host hooks fire | **Yes** — PreInvocation / PostToolUse / Stop |
| Edit non-ignore file via host | **Yes** — `app.js` gained `add` / `multiply` / `factorial` |
| Host Stop `decision:continue` ≥1× | **Yes (≥2×)** — 自审修复第 1 / 2 轮（transcript SYSTEM_MESSAGE: *Stop hook blocked termination*） |

Surface: **CLI** (`agy` / antigravity-cli). Conversation: `379d6609-256a-442d-b431-74ca4131b72e`.

## Host live (accepted session)

| Check | Result |
|-------|--------|
| Init | Autopilot antigravity on `tmp/agy`；`.agents/bin` shim + hooks |
| Flow | `/autopilot-on` → plan `demo-math-utils` → `/autopilot-run` |
| Tools | `write_to_file` / `replace_file_content` / `run_command`（transcript） |
| Autopilot state | session `379d6609` · `executing` · armed；`verify-last` math-functions `ok: true` |
| Transcript | `~/.gemini/antigravity-cli/brain/379d6609-…/logs/transcript_full.jsonl` |

## Historical note (not blocking)

Earlier `$HOME` disposables (`ap-agy-live-1fxxrj`, `ap-agy-live-HJWfJO`) failed host edit (Eligibility / PERMISSION_DENIED) — kept under `live-artifacts/` as history. Human replan **2026-09-17** accepts `tmp/agy` session as the ship-gate proof.

## Artifacts

- Historical FAIL captures: `plans/v0.10.1-antigravity-fix/live-artifacts/`
- PASS proof: host transcript + project `app.js` / `.autopilot/state.db` on `tmp/agy` (paths above)
