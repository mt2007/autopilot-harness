# tests-pi-contract — 2026-09-18

## Delivered

- `packages/cli/tests/pi-contract.test.ts` — umbrella matrix (10 tests):
  - vendor-entry aliases + `PI_CONTINUE_DELIVER` / customType
  - extension asset I/O (events, vendor runtime, R1 empty-continue guard, R9 no UI call)
  - R7 shell `--platform pi` → `{}`
  - harness-owned input / followup; R1 idle settled → no `continueMessage`
  - continue gate: `loop:true` only
  - harness-owned `before_agent_start` preserves `chain_pending`
  - dirty-arm: write/edit product; plans/** + bash do not
  - R8 settle dirty-tree → `continueMessage` + pending fix
  - merge/fingerprint: incomplete FAIL; leftover WARN; fingerprint uninstall
  - Pi + Antigravity dual WARN + PATH soft-min tip
- `packages/ports/pi/tests/port-pi.test.ts` — plans/** no-arm assertion on tool_result

## Self-review fixes

### Round 1
- HIGH: idle R1 used `new ReviewEngine(store)` without config → settle threw into fail-open `{}` (false green). Now `testEngine(...)` + assert `chain_pending === 0`.
- MEDIUM: R9 settled slice used fixed `"agent_settled"` `indexOf` (−1 → last char). Now `search` + `>= 0`.
- MEDIUM: tighten R8 `continueMessage` regex + assert `pending_followup`.

### Round 2
- HIGH: same false-green in `port-pi.test.ts` R1 idle settle → `testEngine` + stronger asserts.
- HIGH/MEDIUM: R1 whitespace-only `action.message` still returned `continueMessage`; port now trims; contract + port tests cover blank/whitespace.
- MEDIUM: leftover platforms rewrite anchored on `integration:` (init default), not loose `\n[a-z_]`.

### Round 3
- HIGH: R1 trim lived only in `port-pi` source; Pi extension loads vendor — rebuilt `assets/vendor/runtime.mjs`.
- MEDIUM: `!action.loop` → `!action?.loop`; PATH restore deletes key when previously unset.

## Not in this item

- matrix-host / smoke-repo / live-pi-smoke / docs
