import fs from "node:fs";
import path from "node:path";

/** Default ignore rules when `.autopilotignore` is missing (matches init template). */
export const DEFAULT_AUTOPILOT_IGNORE_TEXT = `# Autopilot — paths that do NOT trigger self-review (gitignore syntax).
#
# What this file is:
#   - Controls whether an afterFileEdit counts as "product code" (opens fix/confirm).
#   - Does NOT change \`git diff\` / \`git status\` output (that is \`.gitignore\`).
#   - Review followups ask the agent to skip these paths when reading diffs (soft).
#
# Semantics:
#   - Same glob rules as gitignore; last matching pattern wins.
#   - Use \`!\` to force-include an exception (e.g. \`!docs/feed/**/*.yml\`).
#   - Markdown (*.md / *.mdx) is NOT ignored by default — design docs can be reviewed.
#   - \`docs/**\` is NOT ignored by default.
#   - Also skip untracked paths ignored by \`.gitignore\` (tracked files still count).
#
# Later (not implemented): hard-filtered review-diff / path ledger — see
# docs/autopilot/workflows/autopilot-executing.md (B2 strong).

# Runtime / editor (prefer also listing these in .gitignore)
.autopilot/**
.cursor/**

# Planning artifacts
plans/**

# Common build / vendor trees
node_modules/**
dist/**
build/**
out/**
target/**
.target/**
coverage/**
.venv/**
venv/**
__pycache__/**

# Lockfiles / package manager noise
package-lock.json
pnpm-lock.yaml
yarn.lock
bun.lock
bun.lockb
Cargo.lock
poetry.lock
composer.lock

# Media / binary (do not trigger self-review)
*.png
*.jpg
*.jpeg
*.gif
*.webp
*.ico
*.svg
*.bmp
*.mp3
*.mp4
*.wav
*.webm
*.mov
*.woff
*.woff2
*.ttf
*.otf
*.eot
*.pdf
*.zip
*.gz
*.tgz
*.7z
*.rar
*.jar
*.class
*.o
*.a
*.so
*.dylib
*.dll
*.exe
*.wasm

# Prose / data noise (markdown is intentionally allowed)
*.txt
*.html
*.htm
*.csv
*.tsv
*.log
*.map
*.min.js
*.min.css
`;

export interface AutopilotIgnorePattern {
  negated: boolean;
  /** Regex tested against repo-relative posix path. */
  regex: RegExp;
}

/** Max bytes for `.autopilotignore` (untrusted project file). */
const MAX_AUTOPILOT_IGNORE_BYTES = 1_000_000;
/** Per-line cap — untrusted globs compile to RegExp on the edit hot path. */
const MAX_AUTOPILOT_IGNORE_LINE_CHARS = 4_096;
/** Cap compiled patterns to bound match cost per afterFileEdit. */
const MAX_AUTOPILOT_IGNORE_PATTERNS = 10_000;

const ignoreCache = new Map<
  string,
  { mtimeMs: number; patterns: AutopilotIgnorePattern[] }
>();

function escapeRegexChar(ch: string): string {
  return ch.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

/** Convert a gitignore-style glob segment to regex (no anchoring). */
function globBodyToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; ) {
    const ch = glob[i]!;
    if (ch === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 3;
        continue;
      }
      out += ".*";
      i += 2;
      continue;
    }
    if (ch === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    out += escapeRegexChar(ch);
    i += 1;
  }
  return out;
}

function compilePattern(raw: string): AutopilotIgnorePattern | null {
  let line = raw.trim();
  if (!line || line.startsWith("#")) return null;
  if (line.length > MAX_AUTOPILOT_IGNORE_LINE_CHARS) return null;

  let negated = false;
  if (line.startsWith("!")) {
    negated = true;
    line = line.slice(1).trim();
    if (!line || line.startsWith("#")) return null;
  }

  const dirOnly = line.endsWith("/");
  if (dirOnly) line = line.slice(0, -1);
  if (!line) return null;
  if (line.length > MAX_AUTOPILOT_IGNORE_LINE_CHARS) return null;

  let anchored = false;
  if (line.startsWith("/")) {
    anchored = true;
    line = line.slice(1);
  }

  const body = globBodyToRegex(line);
  let regexSource: string;
  if (anchored) {
    regexSource = `^${body}`;
    if (dirOnly || line.endsWith("/**") || line.endsWith("/*")) {
      regexSource += "(?:/.*)?";
    }
    regexSource += "$";
  } else if (line.includes("/")) {
    regexSource = `(?:^|.*/)${body}`;
    if (dirOnly || line.endsWith("/**") || line.endsWith("/*")) {
      regexSource += "(?:/.*)?";
    }
    regexSource += "$";
  } else {
    regexSource = `(?:^|.*/)?${body}$`;
  }

  return { negated, regex: new RegExp(regexSource) };
}

/** Parse `.autopilotignore` body into ordered patterns (gitignore semantics). */
export function parseAutopilotIgnore(text: string): AutopilotIgnorePattern[] {
  const patterns: AutopilotIgnorePattern[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const compiled = compilePattern(rawLine);
    if (!compiled) continue;
    patterns.push(compiled);
    if (patterns.length >= MAX_AUTOPILOT_IGNORE_PATTERNS) break;
  }
  return patterns;
}

export const DEFAULT_AUTOPILOT_IGNORE_PATTERNS = parseAutopilotIgnore(
  DEFAULT_AUTOPILOT_IGNORE_TEXT,
);

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * True when the relative path is ignored by autopilotignore rules.
 * Last matching pattern wins; `!` negates ignore.
 */
export function isAutopilotIgnoredPath(
  relativePath: string,
  patterns: AutopilotIgnorePattern[],
): boolean {
  const norm = normalizeRelativePath(relativePath);
  let ignored = false;
  for (const pat of patterns) {
    if (pat.regex.test(norm)) {
      ignored = !pat.negated;
    }
  }
  return ignored;
}

/** Resolve repo-relative posix path from hook file_path + optional project root. */
export function toProjectRelativePath(
  filePath: string,
  projectRoot?: string,
): string {
  const posix = filePath.replace(/\\/g, "/");
  if (!projectRoot?.trim()) {
    return normalizeRelativePath(posix);
  }
  const root = path.resolve(projectRoot);
  const abs = path.isAbsolute(posix)
    ? path.resolve(posix)
    : path.resolve(root, posix);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return "";
  }
  return normalizeRelativePath(rel.replace(/\\/g, "/"));
}

export function autopilotIgnorePath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".autopilotignore");
}

/** Load project `.autopilotignore`, or built-in defaults when missing. */
export function loadAutopilotIgnorePatterns(
  projectRoot: string,
): AutopilotIgnorePattern[] {
  const root = path.resolve(projectRoot);
  const filePath = path.join(root, ".autopilotignore");
  let st: fs.Stats;
  try {
    st = fs.lstatSync(filePath);
  } catch {
    return DEFAULT_AUTOPILOT_IGNORE_PATTERNS;
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    return DEFAULT_AUTOPILOT_IGNORE_PATTERNS;
  }
  if (st.size > MAX_AUTOPILOT_IGNORE_BYTES) {
    return DEFAULT_AUTOPILOT_IGNORE_PATTERNS;
  }

  const cached = ignoreCache.get(root);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return cached.patterns;
  }

  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return DEFAULT_AUTOPILOT_IGNORE_PATTERNS;
  }
  if (text.length > MAX_AUTOPILOT_IGNORE_BYTES) {
    return DEFAULT_AUTOPILOT_IGNORE_PATTERNS;
  }

  const patterns = parseAutopilotIgnore(text);
  ignoreCache.set(root, { mtimeMs: st.mtimeMs, patterns });
  return patterns;
}

/** Clear in-memory ignore cache (tests). */
export function clearAutopilotIgnoreCache(): void {
  ignoreCache.clear();
}
