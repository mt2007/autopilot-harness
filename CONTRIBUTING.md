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

- Product front door: English [README.md](./README.md) is authoritative.
- User cheat sheet (zh): [docs/autopilot/quickstart.md](./docs/autopilot/quickstart.md).
- Design depth: [docs/architecture.md](./docs/architecture.md).
- Release notes: [CHANGELOG.md](./CHANGELOG.md).
- Prefer small, reviewable doc PRs; match existing tone (no usage-limit / recover marketing in the front door).
- If you change CLI install paths or skills/triggers, update README and quickstart in the same PR.

## Translations

README / docs translations are welcome later (e.g. `README.zh-CN.md`).

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
