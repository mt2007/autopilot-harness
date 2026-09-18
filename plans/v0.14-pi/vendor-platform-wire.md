# vendor-platform-wire — 2026-09-18

## Delivered

- `INSTALLABLE_BINDINGS` + default surface: **`pi` / `cli`**
- Vendor: `vendor-entry.ts` re-exports `handlePi*` + `PI_*`; `bundle-vendor.mjs` aliases `@autopilot-harness/port-pi`; `runtime.mjs` rebuilt
- Init asset: `packages/cli/assets/pi-extension/autopilot.ts` (direct-write template; loads `.autopilot/bin/vendor/runtime.mjs`)
- **R7**: shell `KNOWN_PLATFORMS` stays **ten-way** (no `pi`); `NON_SHELL_PLATFORMS` aborts `--platform pi|runner` before FSM
- CLI `package.json` depends on `@autopilot-harness/port-pi` (`workspace:*`); public npm list + publish-workspace-deps include `packages/ports/pi`
- Contract: `packages/cli/tests/pi-vendor-wire.test.ts`

## Deferred to init-doctor-upgrade-uninstall

- Actually writing `.pi/extensions` on init/upgrade/uninstall
- doctor FAIL/WARN (fingerprint, trust, print/JSON, skills share)
- `--add-platform pi` wizard tips / ignore narrow rules
