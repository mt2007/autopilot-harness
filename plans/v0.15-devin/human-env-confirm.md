# human-env-confirm — 2026-09-19

CLI only. No Desktop gate.

| Check | Result |
|-------|--------|
| CLI | `command -v devin` → `/Users/zhaoqingli/.local/bin/devin` |
| Version | `devin --version` → **3000.10.31** (`b98cc431`) |
| Login | `devin auth status` → **Logged in (via Devin)** |
| Quota | Account tier **Devin Free**, plan **Free**, team membership **Approved**, enterprise **no** |
| Sandbox | Team setting **optional** (not required). Not a Desktop check |
| Research | `research-devin-hooks.md` present; Stop continue is documented → **do not** defer for missing CLI |
| Checklist rule | CLI present and logged in → record evidence. Defer only if there is no CLI |

**Outcome:** environment confirmed. Next item is `decide-shape` (research recommends `port × subprocess × full`), not defer. Desktop, cloud Devin, and Cascade were not probed.
