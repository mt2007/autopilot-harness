import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@autopilot-harness/core": path.resolve(
        __dirname,
        "packages/core/src/index.ts",
      ),
      "@autopilot-harness/i18n": path.resolve(
        __dirname,
        "packages/i18n/src/index.ts",
      ),
      "@autopilot-harness/cli": path.resolve(
        __dirname,
        "packages/cli/src/index.ts",
      ),
      "@autopilot-harness/port-claude-code": path.resolve(
        __dirname,
        "packages/ports/claude-code/src/index.ts",
      ),
      "@autopilot-harness/port-codex": path.resolve(
        __dirname,
        "packages/ports/codex/src/index.ts",
      ),
      "@autopilot-harness/port-kimi-code": path.resolve(
        __dirname,
        "packages/ports/kimi-code/src/index.ts",
      ),
      "@autopilot-harness/port-copilot-cli": path.resolve(
        __dirname,
        "packages/ports/copilot-cli/src/index.ts",
      ),
      "@autopilot-harness/port-cursor": path.resolve(
        __dirname,
        "packages/ports/cursor/src/index.ts",
      ),
      "@autopilot-harness/port-runner": path.resolve(
        __dirname,
        "packages/ports/runner/src/index.ts",
      ),
      "@autopilot-harness/port-pi": path.resolve(
        __dirname,
        "packages/ports/pi/src/index.ts",
      ),
    },
  },
});
