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
    },
  },
});
