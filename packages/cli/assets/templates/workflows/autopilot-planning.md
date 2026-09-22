# Autopilot Planning

Built-in grill / design-tree workflow. Do **not** write product code until `/autopilot-run`.

Track artifacts live under **`artifacts.plans_dir`** in `.autopilot/config.yml` (new-init default: `docs/autopilot/plans`). Below, `<plansDir>` means that configured directory.

## Frontier format (every round)

Open each round with a round heading, then list every decision you can ask **now** (premises already settled).

Number questions **globally across rounds** (`Q1`, `Q2`, …). Continue numbering from the last question in prior rounds; **do not restart at Q1**.

```markdown
### Round k

❓ **Qn** - **<title>**: <body; options if useful>

➡️ <recommended answer>
```

Wait for the user to answer the round, then open the next frontier. Round 1 usually covers goal / scope / acceptance. Later rounds go block → detail.

## Brownfield (existing repo)

1. Read README and manifests (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, …).
2. Search / skim modules related to the request.
3. Put constraints under **Existing context** in `brief.md`.
4. Cite **real repo paths** in questions — do not ask the user for facts you can inspect.

## Greenfield

Skip repo survey; start from goals and constraints.

## Artifact timing

| When | Write |
|------|--------|
| Title is clear | Create `<plansDir>/<slug>/` (`brief.md`, `plan.md`, `checklist.md`); update `<plansDir>/README.md`. **Slug** = `[a-z0-9]+([.-][a-z0-9]+)*`, length 1–128 (kebab; single dots OK, e.g. `v0.1-npm-release`; no `..`, `/`, `\`, `_`) — same rule as `/autopilot-on|run <slug>` |
| Frontier nearly empty | Checklist **draft** (`- [ ]`); optional `## Behavior deltas` in brief for later archive into `artifacts.specs_dir` |
| User confirms the plan | Finalize checklist: `- [ ] <id> — <title>` (**item id** kebab-case letters/digits/hyphens only — **no dots**) |
| Ready to build | Prompt **`/autopilot-run`** (or `/autopilot-run <slug>`) |

## Hard rules

- Planning may only edit **`<plansDir>/**`** and docs — **no product code**. Do not assume the literal path `plans/` — use the configured `artifacts.plans_dir`.
- Directory `<slug>` must match `[a-z0-9]+([.-][a-z0-9]+)*` and ≤128 chars (same gate as `/autopilot-on|run <slug>`); checklist **item** ids stay `[a-z0-9]+(-[a-z0-9]+)*` (no dots).
- User shortcuts: “直接定稿 / skip grill / use your recommendations” may shorten rounds; still produce the three artifacts.
- User-visible replies match the user's language. Workflow procedure stays English.
