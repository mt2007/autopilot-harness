# Research — Devin CLI hooks (v0.15)

**Date:** 2026-09-19  
**Probed:** `devin 3000.10.31 (b98cc431)` (`/Users/zhaoqingli/.local/bin/devin`) — `devin --version`, `devin --help`, `devin sandbox --help`, `devin skills paths`  
**Sources:** [Hooks](https://docs.devin.ai/cli/extensibility/hooks/overview), [Lifecycle](https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks), [Skills](https://docs.devin.ai/cli/extensibility/skills/overview), [Configuration](https://docs.devin.ai/cli/extensibility/configuration), [Config file](https://docs.devin.ai/cli/reference/configuration/config-file), [Sandbox](https://docs.devin.ai/cli/sandbox)  
**Budget:** ≤60m. Docs + local help/paths only. **No** live Stop-continue, **no** Desktop, **no** cloud Devin, **no** Cascade.

Closed source. Anything not in those pages or this CLI probe stays **unproven**.

## Verdict (for `decide-shape`)

| Field | Value |
|-------|--------|
| Stop-continue API | **Present (docs)** — Stop stdout `{"decision":"block","reason":"…"}` |
| Submit + edit-arm | **Present (docs)** — `UserPromptSubmit.prompt`; PostToolUse matcher + dirty-arm for `exec` |
| Hard Stop cap | **None documented** (no BLOCK_CAP). Blocking Stop can loop; docs only warn |
| Recommended decide | **`port × subprocess × full`** pending CLI live. Live fail or waive → **degraded + human gate**, not an empty port. No continue at all → **defer** |
| Soft min | **≥3000.10.31** (this probe). Below → doctor **WARN**. Unparseable version → 「以活链 CLI 为准」, do not invent a lower floor |
| Process | Subprocess command hook. **Not** in-process. **Do not** reuse the Claude port fingerprint |

Out of scope for ship claims: Desktop (`devin desktop` / `PATH` opens Desktop), `devin cloud`, Cascade. Same `.devin/` files might be readable there; **this track did not test that**.

---

## Locked I/O

| Autopilot role | Devin | Lock |
|----------------|-------|------|
| Submit | `UserPromptSubmit` | stdin **`prompt`** = user message text. Omit matcher or `""` (no `tool_name` on this event) |
| Edit arm | `PostToolUse` | Matcher **anchored** `^(write\|edit\|apply_patch\|notebook_edit)$`. `"edit"` alone is a **substring** regex and will also match names that merely contain `edit` |
| Exec edits | `exec` | **Not** in the matcher. Arm from a dirty worktree (dirty-arm). PostToolUse **never** `decision:block` |
| Continue | `Stop` | stdout JSON **`decision:"block"`** + **`reason`**. Docs example is exactly that |
| Allow | exit **0** | Success = hook continues. Optional stdout `{"decision":"approve"}`. **Do not** require Factory-style zero-byte stdout. Empty stdout + exit 0 is allow |
| Fail-open | exit **0** | Docs: exit **2** = block; any other non-zero = error, logged, **does not** block. Never use exit 2 for harness errors. This page does **not** document stderr-as-reason |
| Session | stdin **`session_id`** | Stable for the agent session. Also **`prompt_id`** (rotates each user prompt; absent before the first prompt, e.g. SessionStart). Conversation key = **`session_id` only** |
| Loop count | stdin **`stop_hook_active`** | Boolean: “whether a stop hook is already active”. **Not** a numeric cap. Map `true` → `loopCount ≥ 1` (a second block is not the first Stop). Missing/false → 0 |
| Project dir | **`DEVIN_PROJECT_DIR`** | Set on the hook process to the project root. Stock command: `node "$DEVIN_PROJECT_DIR"/.autopilot/bin/autopilot-harness-hook.mjs --platform devin --event …`. Relative `node .autopilot/bin/…` only if live disproves the env |
| Timeout | `timeout` | **Seconds**, optional. **No documented default.** Init writes **120**. Doctor WARN if omitted or &lt;120 |
| Hooks file | `.devin/hooks.v1.json` | **The file is the event map** (no `"hooks"` wrapper). Other locations nest under `"hooks"`. Merge Autopilot keys; **keep sibling events**; empty fingerprint → unlink. **Do not** write `.devin/config.json` `hooks` |
| Verify | `/hooks` | Lists loaded hooks and source files. After install: check `/hooks`, then new session |

`hookSpecificOutput.additionalContext` exists for UserPromptSubmit / SessionStart / PostToolUse. Continue stays **`decision`+`reason` on Stop**, not additionalContext.

Not wired: `PreToolUse`, `PermissionRequest`, `PostCompaction`, `SessionStart`, `SessionEnd`. Compaction can drop context (`PostCompaction.summary` may be null). Recorded risk only.

---

## Matcher (locked)

Docs: matcher is a regex on `tool_name` for `PreToolUse` / `PostToolUse` / `PermissionRequest` only. Empty or omitted matches all tool names. `"exec"` matches any name **containing** `exec`. `"^exec$"` is exact.

File tools named on the lifecycle page: `read`, `write`, `edit`, `apply_patch`, `notebook_read`, `notebook_edit`. Shell is `exec` (plus `get_output`, `write_to_process`, `kill_shell`). Subagent tools: `run_subagent`, `read_subagent`. Names can still vary by mode, model, and integrations — live may log stdin if a write tool is missing.

---

## Skills (locked)

| Item | Lock |
|------|------|
| Write target | **Always** `.devin/skills/autopilot-*/SKILL.md` when the binding is enabled. Do not skip because `.agents/skills` exists. Do **not** also write `.agents` or `.windsurf` by default |
| Docs discovery | `.devin/skills`, `.agents/skills`, `.windsurf/skills`, plus user `~/.config/devin/skills`, `~/.agents/skills`, `~/.codeium/<channel>/skills` |
| This CLI `devin skills paths` | Project: `.devin/skills`, `.cognition/skills`, `.agents/skills`. User: `~/.config/devin/skills`, `~/.config/cognition/skills`, `~/.agents/skills`. **Does not list** `.windsurf` on 3000.10.31 |
| Triggers | Frontmatter `triggers: [user, model]` both default **enabled**. Devin copies use **`triggers: [user]`** so the model does not invoke `/autopilot-*` on its own |
| Dual tip | Doctor WARN if Autopilot skills exist under both `.devin/skills` and `.agents/skills`. `.cognition/skills` is an extra root on this build — do not write it |

Slash form is `/skill-name`. Third-party skills can run arbitrary code; we only write our own tree.

---

## Dual load (locked)

`read_config_from` defaults (user and project examples; `null` counts as true):

| Key | Default | What it imports |
|-----|---------|-----------------|
| `claude` | `true` | `.claude/` including hooks in `.claude/settings.json` and `settings.local.json`, plus user `~/.claude.json` / `~/.claude/settings.json` |
| `cursor` | `true` | `.cursor/rules/` |
| `windsurf` | `true` | `.windsurf/rules/` |

Overview: hooks under `.claude/` are picked up when `read_config_from.claude` is enabled. Also imports `AGENTS.md` / `CLAUDE.md` / `.cursor/rules`. **Still do not write a default `AGENTS.md`.**

Doctor WARN Devin+Claude hook fingerprints (enabled or leftover on disk). **Do not** edit user config to turn `read_config_from.claude` off. Live repo must **not** already contain Claude Autopilot hooks, or both fingerprints run.

Independent fingerprint in `.devin/hooks.v1.json` only.

---

## `-p` / print (locked as unknown)

`devin --help`: `-p` / `--print` is non-interactive (“processes the prompt and exits”). An optional inline prompt is allowed. Docs **do not** say lifecycle hooks are skipped in print mode.

Print mode cannot show the workspace-trust prompt and **fails in an untrusted directory** unless `--respect-workspace-trust false`.

| Item | Lock |
|------|------|
| Product surface | **Interactive CLI only** |
| Doctor | WARN that Stop-under-`-p` is **unproven**. Do **not** FAIL merely because `-p` exists, and do **not** document “`-p` unsupported” as a proven fact |
| Live | Interactive session, not `-p`, until a probe shows Stop still runs |

---

## Sandbox vs hooks (locked as unknown)

`--sandbox` / `DEVIN_SANDBOX` / `devin sandbox` is **Research Preview** OS isolation for the **exec tool** (macOS seatbelt, Linux `bwrap`+seccomp). Writable roots = workspace + granted `Write(...)`. If sandbox setup fails, the CLI **refuses to start** (fail-closed), including when required by team policy. Windows hard-fails. Not on by default (`enforcement` Optional).

The sandbox page’s “hooks the sandbox blocks” sentence is about **commands such as git hooks inside sandboxed exec**, plus `sandbox.excluded` `Exec(...)` rules. It does **not** say `.devin/hooks.v1.json` command hooks are disabled.

| Item | Lock |
|------|------|
| Proven | Sandbox wraps **exec-tool** processes, not “hooks off” |
| Unproven | Whether the Stop/UPS `node …hook.mjs` child is inside that sandbox and cannot write `.autopilot/` |
| Doctor | WARN if the user is on `--sandbox` / `DEVIN_SANDBOX`. **Not** a FAIL by itself |
| Live | First continue proof **without** `--sandbox` |

---

## Subagent Stop (locked as unknown)

`subagents_enabled` defaults **true** (user-only). Tools: `run_subagent`, `read_subagent`. By default a subagent cannot spawn another. Docs call `session_id` the id for **the agent session**. They do **not** say a subagent gets its own id, and they do **not** say Stop is skipped inside a subagent.

| Item | Lock |
|------|------|
| Until live | One harness conversation per stdin `session_id`. Do not open a second track because `run_subagent` ran |
| If Stop is shared (same `session_id`) | Still only that id. Do not fan out. Pending-followup / harness-owned checks must ignore a Stop that is not this conversation’s continue |
| If live shows a different id | Ignore Stop whose `session_id` is not the armed conversation |

No live proof in this item.

---

## Not in this note

- Desktop live, cloud sessions, Cascade, `/handoff` (not the Stop loop)
- Numeric Stop cap (none documented — live decides full vs degraded)
- Implementing the port
