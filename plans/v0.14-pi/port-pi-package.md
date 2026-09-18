# port-pi-package — 2026-09-18

## Delivered

- Package `@autopilot-harness/port-pi` @ `packages/ports/pi` (workspace; version **0.13.0** until bump item)
- Exports `handlePiInput` / `handlePiBeforeAgentStart` (`handlePiSubmit`) / `handlePiToolResult` / `handlePiAgentSettled` (`handlePiStop`) + R2 `buildPiConversationId`
- R1: settled returns `continueMessage` only when `action.loop` + message
- R8: dirty-tree via `ReviewEngine.handleStop`
- R9: port never calls UI; `PI_CONTINUE_DELIVER` documents followUp+triggerTurn
- Fail-open try/catch on all handlers
- Tests: `packages/ports/pi/tests/port-pi.test.ts` — **10 passed**

## Not in this item

- init / vendor extension stamp → `vendor-platform-wire` / `init-doctor-upgrade-uninstall`
- live smoke → `live-pi-smoke`
