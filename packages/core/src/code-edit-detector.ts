import path from "node:path";

/** Broad source/config extensions — language-agnostic product edits. */
const CODE_EXTENSIONS = new Set([
  // JS / TS
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  // Web
  ".vue",
  ".svelte",
  ".astro",
  ".css",
  ".scss",
  ".sass",
  ".less",
  // Systems / native
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".hh",
  ".m",
  ".mm",
  ".rs",
  ".go",
  ".zig",
  ".nim",
  ".v",
  // JVM / .NET
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".groovy",
  ".cs",
  ".fs",
  ".fsx",
  ".vb",
  // Mobile / UI
  ".swift",
  ".dart",
  // Scripting
  ".py",
  ".rb",
  ".php",
  ".pl",
  ".pm",
  ".lua",
  ".r",
  ".jl",
  ".ex",
  ".exs",
  ".erl",
  ".hrl",
  ".clj",
  ".cljs",
  ".cljc",
  ".edn",
  ".hs",
  ".lhs",
  ".ml",
  ".mli",
  ".elm",
  // Shell
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  // Data / IDL / infra
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".tf",
  ".toml",
  ".yaml",
  ".yml",
  ".json",
  ".jsonc",
  ".xml",
  ".prisma",
]);

const ROOT_CONFIG_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Dockerfile",
  "Makefile",
  "makefile",
  "CMakeLists.txt",
  "pyproject.toml",
  "Pipfile",
  "requirements.txt",
  "Gemfile",
  "composer.json",
  "tsconfig.json",
  "jsconfig.json",
  "deno.json",
  "deno.jsonc",
]);

function normalizePosix(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** Returns true if the edited path counts as product code (triggers fix review). */
export function isProductCodeEdit(filePath: string): boolean {
  const posix = normalizePosix(filePath);
  const base = path.posix.basename(posix);
  const lower = posix.toLowerCase();

  // Built-in excludes
  if (
    lower.includes("/docs/") ||
    lower.startsWith("docs/") ||
    lower.includes("/plans/") ||
    lower.startsWith("plans/") ||
    lower.includes("/.autopilot/") ||
    lower.startsWith(".autopilot/") ||
    lower.includes("/.cursor/") ||
    lower.startsWith(".cursor/") ||
    lower.endsWith(".md") ||
    lower.endsWith(".mdx")
  ) {
    return false;
  }

  // Runtime dot files under .cursor/hooks/ (belt-and-suspenders; .cursor/ already excluded)
  if (/\/\.cursor\/hooks\/\./.test(lower) || /^\.cursor\/hooks\/\./.test(lower)) {
    return false;
  }

  const ext = path.posix.extname(posix).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return true;
  if (ROOT_CONFIG_NAMES.has(base)) return true;

  return false;
}
