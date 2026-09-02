import path from "node:path";
import {
  DEFAULT_AUTOPILOT_IGNORE_PATTERNS,
  isAutopilotIgnoredPath,
  loadAutopilotIgnorePatterns,
  toProjectRelativePath,
} from "./autopilot-ignore.js";

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

export interface ProductCodeEditOptions {
  /** Project root — loads `.autopilotignore` when present. */
  projectRoot?: string;
}

/** Immutable safety denylist — never counts as product code (not overridable). */
function isSafetyExcluded(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  if (
    lower.includes("/.autopilot/") ||
    lower.startsWith(".autopilot/") ||
    lower.includes("/.cursor/") ||
    lower.startsWith(".cursor/")
  ) {
    return true;
  }
  if (/\/\.cursor\/hooks\/\./.test(lower) || /^\.cursor\/hooks\/\./.test(lower)) {
    return true;
  }
  return false;
}

function isProductCandidate(relativePath: string): boolean {
  const base = path.posix.basename(relativePath);
  const ext = path.posix.extname(relativePath).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return true;
  if (ROOT_CONFIG_NAMES.has(base)) return true;
  return false;
}

/** Returns true if the edited path counts as product code (triggers fix review). */
export function isProductCodeEdit(
  filePath: string,
  opts?: ProductCodeEditOptions,
): boolean {
  const relative = toProjectRelativePath(filePath, opts?.projectRoot);
  if (!relative) return false;

  if (isSafetyExcluded(relative)) return false;
  if (!isProductCandidate(relative)) return false;

  const patterns = opts?.projectRoot?.trim()
    ? loadAutopilotIgnorePatterns(opts.projectRoot)
    : DEFAULT_AUTOPILOT_IGNORE_PATTERNS;

  if (isAutopilotIgnoredPath(relative, patterns)) return false;
  return true;
}
