/**
 * Public npm packages that must share PACKAGE_VERSION on release bumps.
 * Keep docs-contract + publish-workspace-deps in sync via this single list.
 */
export const PUBLIC_PACKAGE_JSON_PATHS = [
  "packages/cli/package.json",
  "packages/core/package.json",
  "packages/i18n/package.json",
  "packages/ports/cursor/package.json",
  "packages/ports/claude-code/package.json",
  "packages/ports/codex/package.json",
  "packages/ports/kimi-code/package.json",
  "packages/ports/copilot-cli/package.json",
  "packages/ports/grok-build/package.json",
  "packages/ports/gemini-cli/package.json",
  "packages/ports/factory-droid/package.json",
  "packages/ports/hermes-agent/package.json",
  "packages/ports/antigravity/package.json",
  "packages/ports/pi/package.json",
  "packages/ports/runner/package.json",
] as const;

export const PUBLIC_PACKAGE_DIRS = PUBLIC_PACKAGE_JSON_PATHS.map((rel) =>
  rel.replace(/\/package\.json$/, ""),
);
