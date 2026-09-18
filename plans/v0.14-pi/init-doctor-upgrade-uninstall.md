# init-doctor-upgrade-uninstall — 2026-09-18

## Delivered

- `packages/cli/src/init/pi-extension.ts`: R6 direct-write `.pi/extensions/autopilot.ts` (R4: no PATH `pi`); fingerprint; symlink fail-closed; `probePiCliVersion` / soft min **0.85.1**
- **init**: `wantPi` → write extension + share `.agents/skills` with Antigravity; **does not** write `.agents/hooks.json`
- **upgrade**: refresh extension (+ skills when Pi without Antigravity); preflight symlink on `.pi/`
- **uninstall**: remove extension; remove shared `.agents/skills` when `wantAntigravity || wantPi`
- **doctor**: FAIL missing/incomplete fingerprint; WARN PATH/version/trust/R10 print-JSON/dual Antigravity; skills via shared `.agents` host
- **wizard**: trust `/reload` / soft min / R10 / one_executor tips (en + zh plain)
- **locale-set**: Pi → rewrite `.agents/skills`
- **ignore**: narrow `.pi/extensions/autopilot*` in core + CLI + packages templates; vendor rebuilt
- **`--add-platform pi`**: covered via `INSTALLABLE_BINDINGS` + init merge
- Tests: `packages/cli/tests/pi-init-doctor.test.ts` (+ ignore regression)

## Not in this item

- Extension I/O contract / continue / dirty-arm → `tests-pi-contract`
- Matrix / live smoke / docs / 0.14 bump
