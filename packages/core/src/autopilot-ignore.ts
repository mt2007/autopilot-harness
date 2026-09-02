import fs from "node:fs";
import path from "node:path";

/** Default ignore rules when `.autopilotignore` is missing (matches init template). */
export const DEFAULT_AUTOPILOT_IGNORE_TEXT = `# Autopilot — paths that do NOT trigger self-review (gitignore syntax).
# Use ! to force-include an exception (e.g. deliverable YAML under docs/).

# Planning artifacts
plans/**

# Documentation tree (negate deliverables you want reviewed)
docs/**

# Prose / design markdown
**/*.md
**/*.mdx
`;

export interface AutopilotIgnorePattern {
  negated: boolean;
  /** Regex tested against repo-relative posix path. */
  regex: RegExp;
}

/** Max bytes for `.autopilotignore` (untrusted project file). */
const MAX_AUTOPILOT_IGNORE_BYTES = 1_000_000;

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

  let negated = false;
  if (line.startsWith("!")) {
    negated = true;
    line = line.slice(1).trim();
    if (!line || line.startsWith("#")) return null;
  }

  const dirOnly = line.endsWith("/");
  if (dirOnly) line = line.slice(0, -1);
  if (!line) return null;

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
    if (compiled) patterns.push(compiled);
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
