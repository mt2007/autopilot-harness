import path from "node:path";

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".vue",
  ".svelte",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
]);

const ROOT_CONFIG_NAMES = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "docker-compose.yml",
  "docker-compose.yaml",
  "Makefile",
  "pyproject.toml",
  "tsconfig.json",
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
    lower.endsWith(".md") ||
    lower.endsWith(".mdx")
  ) {
    return false;
  }

  // Runtime dot files under .cursor/hooks/
  if (/\/\.cursor\/hooks\/\./.test(lower) || /^\.cursor\/hooks\/\./.test(lower)) {
    return false;
  }

  const ext = path.posix.extname(posix).toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return true;
  if (ROOT_CONFIG_NAMES.has(base)) return true;

  return false;
}
