# Contributing

Thanks for contributing to **autopilot-harness**.

## Develop

Requires **Node.js 22+** and **pnpm**.

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

After changing hook/runtime code, refresh the vendor bundle with `pnpm bundle-vendor` when needed.

## Docs & translations

- Prefer English for `README.md` (authority) and code comments aimed at contributors.
- Doc and README translations are welcome; open a PR and keep the English front door in sync when behavior changes.
- Deep design notes: [docs/architecture.md](./docs/architecture.md).

## Pull requests

- Keep changes focused; match existing TypeScript style.
- Add or update tests when you change `packages/core` behavior.
- Do not commit secrets, `.env`, or `.autopilot/state.db`.
