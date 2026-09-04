# Contributing

Thanks for contributing to **autopilot-harness**.

## Develop

Requires **Node.js 22+** and **pnpm**.

```bash
pnpm install
pnpm test          # bundle hook vendor, then Vitest
pnpm typecheck
pnpm build
```

After changing hook / review-engine / port / i18n locale strings that ship in the stop-hook bundle, run `pnpm bundle-vendor` and keep `packages/cli/assets/vendor/` in sync before opening a PR.

Useful filters:

```bash
pnpm exec vitest run packages/core/tests/recover-debounce.test.ts
pnpm exec vitest run packages/cli/tests
```

## Docs PRs

- Product front door: English [README.md](./README.md) is **authoritative for behavior**.
- Chinese [README.zh-CN.md](./README.zh-CN.md) must stay behavior-aligned: when you change Why / How-it-works / `review.scope` / install paths / Docs list in English, update `README.zh-CN.md` **in the same PR** (or immediately after in the same change set). Do not leave the Chinese front door describing old scope or install rules.
- User cheat sheet: English [docs/autopilot/quickstart.md](./docs/autopilot/quickstart.md); Chinese [docs/autopilot/quickstart.zh-CN.md](./docs/autopilot/quickstart.zh-CN.md) — keep trigger aliases and claim/resume boundaries in sync.
- Design depth: [docs/architecture.md](./docs/architecture.md).
- Config / FAQ / hosts / Plan bridge: [docs/config.md](./docs/config.md), [docs/troubleshooting.md](./docs/troubleshooting.md), [docs/hosts.md](./docs/hosts.md), [docs/host-plan-bridge.md](./docs/host-plan-bridge.md).
- Release notes: [CHANGELOG.md](./CHANGELOG.md).
- Prefer small, reviewable doc PRs; match existing tone (no usage-limit / recover marketing in the front door).
- If you change CLI install paths or skills/triggers, update README + `README.zh-CN.md`, both quickstarts, and keep `writeQuickstart` in `packages/cli` aligned with the OSS quickstart sections that consumers receive on `init`.
- After npm publish of `@autopilot-harness/cli`, flip README / quickstart “Today” vs “After npm publish” so the scoped `npx @autopilot-harness/cli` path is primary (never document a bare `npx autopilot-harness` package name as the install).

## Translations

- Keep the English README as the source of truth for behavior.
- When behavior changes, update English first (or in the same PR as the translation).
- Product UI / followup strings live under `packages/i18n/locales/` (`en`, `zh-CN`). After editing them, run `pnpm bundle-vendor`. Do **not** put「必须用中文」/「reply in English」(or similar) inside those strings — `locale` selects the template language; user-visible chat replies follow the user's language.

## Pull requests

- Keep changes focused; follow existing TypeScript style (immutable data, small modules).
- Add or update tests when you change `packages/core` behavior (and CLI init/upgrade when you touch those paths).
- Do not commit secrets, `.env`, or `.autopilot/` runtime (`state.db`, `verify-last.json`, logs).
- Do not use `--no-verify` / force-push to `main` unless maintainers ask.

## License

By contributing, you agree that your contributions are licensed under the MIT License (see [LICENSE](./LICENSE)).
