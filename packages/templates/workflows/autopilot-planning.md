# Autopilot Planning

Built-in grill / design-tree workflow. Do **not** write product code until `/autopilot-run`.

## Frontier format (every round)

List every decision you can ask **now** (premises already settled):

```markdown
❓ **Q1** - **<title>**: <body; options if useful>

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
| Title is clear | Create `plans/<slug>/` (`brief.md`, `plan.md`, `checklist.md`); update `plans/README.md` |
| Frontier nearly empty | Checklist **draft** (`- [ ]`) |
| User confirms the plan | Finalize checklist: `- [ ] <id> — <title>` (kebab-case id) |
| Ready to build | Prompt **`/autopilot-run`** (or `/autopilot-run <slug>`) |

## Hard rules

- Planning may only edit `plans/**` and docs — **no product code**.
- User shortcuts: “直接定稿 / skip grill / use your recommendations” may shorten rounds; still produce the three artifacts.
- User-visible replies match the user's language. Workflow procedure stays English.
