import fs from "node:fs";
import path from "node:path";
import {
  isLexicallyInsideProject,
  isRealpathInsideProject,
  normalizeProjectRoot,
} from "@autopilot-harness/core";
import type { RunnerConfig, RunnerPromptMode } from "./config.js";
import { RUNNER_PROMPT_FILE_THRESHOLD } from "./config.js";
import { runnerConversationFileToken } from "./conversation-id.js";

const PROMPT_TOKEN = "{prompt}";
const PROMPT_FILE_TOKEN = "{prompt_file}";

export type PromptChannel = "argv" | "file";

export interface ExpandedCommand {
  file: string;
  args: string[];
  /** Set when a prompt file was written for this turn. */
  promptFilePath?: string;
  channel: PromptChannel;
}

function templateHas(template: string, token: string): boolean {
  return template.includes(token);
}

/**
 * Decide argv vs file channel (research §4 / §10).
 * Long tips with only `{prompt}` still use argv as one element (shell:false).
 */
export function resolvePromptChannel(
  template: string,
  tip: string,
  mode: RunnerPromptMode,
): PromptChannel {
  const hasFile = templateHas(template, PROMPT_FILE_TOKEN);
  const hasArgv = templateHas(template, PROMPT_TOKEN);
  if (mode === "file") {
    if (!hasFile) {
      throw new Error(
        "prompt_mode=file requires {prompt_file} in runner.command",
      );
    }
    return "file";
  }
  if (mode === "argv") {
    if (!hasArgv) {
      throw new Error("prompt_mode=argv requires {prompt} in runner.command");
    }
    return "argv";
  }
  // auto
  if (hasFile && tip.length > RUNNER_PROMPT_FILE_THRESHOLD) return "file";
  if (hasFile && !hasArgv) return "file";
  if (hasArgv) return "argv";
  if (hasFile) return "file";
  throw new Error(
    "runner.command must include {prompt} and/or {prompt_file}",
  );
}

/**
 * Fail closed before writing prompt files when the template mixes channels
 * that cannot both be satisfied for the chosen channel.
 */
export function assertTemplateMatchesChannel(
  template: string,
  channel: PromptChannel,
): void {
  const hasFile = templateHas(template, PROMPT_FILE_TOKEN);
  const hasArgv = templateHas(template, PROMPT_TOKEN);
  if (channel === "argv") {
    if (!hasArgv) {
      throw new Error("argv channel requires {prompt} in runner.command");
    }
    if (hasFile) {
      throw new Error(
        "runner.command has both {prompt} and {prompt_file}; use prompt_mode=file or remove {prompt_file}",
      );
    }
    return;
  }
  if (!hasFile) {
    throw new Error("file channel requires {prompt_file} in runner.command");
  }
  if (hasArgv) {
    throw new Error(
      "runner.command has both {prompt} and {prompt_file}; use prompt_mode=argv or remove {prompt}",
    );
  }
}

/**
 * Split template on whitespace; keep `{prompt}` / `{prompt_file}` atomic.
 * No shell expansion — caller must spawn with `shell: false`.
 */
export function tokenizeCommandTemplate(template: string): string[] {
  const trimmed = template.trim();
  if (!trimmed) return [];
  const tokens: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i]!)) i += 1;
    if (i >= trimmed.length) break;
    if (trimmed.startsWith(PROMPT_TOKEN, i)) {
      tokens.push(PROMPT_TOKEN);
      i += PROMPT_TOKEN.length;
      continue;
    }
    if (trimmed.startsWith(PROMPT_FILE_TOKEN, i)) {
      tokens.push(PROMPT_FILE_TOKEN);
      i += PROMPT_FILE_TOKEN.length;
      continue;
    }
    let j = i;
    while (j < trimmed.length && !/\s/.test(trimmed[j]!)) j += 1;
    tokens.push(trimmed.slice(i, j));
    i = j;
  }
  return tokens;
}

function writePromptFile(
  projectRoot: string,
  conversationId: string,
  iteration: number,
  tip: string,
): string {
  const root = normalizeProjectRoot(projectRoot);
  if (!root) throw new Error("Invalid project root for prompt file.");
  const dir = path.join(root, ".autopilot", "runner-prompts");
  fs.mkdirSync(dir, { recursive: true });
  const name = `${runnerConversationFileToken(conversationId)}-${iteration}.txt`;
  const filePath = path.join(dir, name);
  // Lexical check before create — realpath fails on missing leaves.
  if (!isLexicallyInsideProject(root, filePath)) {
    throw new Error("prompt file path escaped project root");
  }
  fs.writeFileSync(filePath, tip, "utf8");
  if (!isRealpathInsideProject(root, filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
    throw new Error("prompt file path escaped project root");
  }
  return filePath;
}

/** Best-effort cleanup after a turn. */
export function unlinkPromptFile(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* ignore */
  }
}

/**
 * Expand `runner.command` into spawn file + args for one tip.
 */
export function expandCommandTemplate(
  config: RunnerConfig,
  opts: {
    tip: string;
    projectRoot: string;
    conversationId: string;
    iteration: number;
  },
): ExpandedCommand {
  const template = config.command.trim();
  if (!template) {
    throw new Error("runner.command is empty");
  }
  const channel = resolvePromptChannel(
    template,
    opts.tip,
    config.promptMode,
  );
  // Validate before writing any prompt file (avoid leaks on mixed templates).
  assertTemplateMatchesChannel(template, channel);

  let promptFilePath: string | undefined;
  try {
    if (channel === "file") {
      promptFilePath = writePromptFile(
        opts.projectRoot,
        opts.conversationId,
        opts.iteration,
        opts.tip,
      );
    }

    const tokens = tokenizeCommandTemplate(template);
    if (tokens.length === 0) {
      throw new Error("runner.command produced no argv");
    }
    const replaced = tokens.map((t) => {
      if (t === PROMPT_TOKEN) return opts.tip;
      if (t === PROMPT_FILE_TOKEN) {
        if (!promptFilePath) {
          throw new Error("{prompt_file} expansion missing path");
        }
        return promptFilePath;
      }
      return t;
    });

    const [file, ...args] = replaced;
    if (!file) throw new Error("runner.command missing executable");
    return { file, args, promptFilePath, channel };
  } catch (err) {
    unlinkPromptFile(promptFilePath);
    throw err;
  }
}

/** Resolve cwd under project (or project root). */
export function resolveRunnerCwd(
  projectRoot: string,
  cwd: string,
): string {
  const root = normalizeProjectRoot(projectRoot);
  if (!root) throw new Error("Invalid project root for runner cwd.");
  const absRoot = fs.realpathSync(root);
  if (!cwd.trim()) return absRoot;
  const abs = path.resolve(absRoot, cwd.trim());
  // Lexical first so a missing path is not misreported as an escape.
  if (!isLexicallyInsideProject(absRoot, abs)) {
    throw new Error("runner.cwd must stay inside the project root");
  }
  if (!fs.existsSync(abs)) {
    throw new Error(`runner.cwd does not exist: ${cwd.trim()}`);
  }
  if (!isRealpathInsideProject(absRoot, abs)) {
    throw new Error("runner.cwd must stay inside the project root");
  }
  const real = fs.realpathSync(abs);
  if (!fs.statSync(real).isDirectory()) {
    throw new Error(`runner.cwd must be a directory: ${cwd.trim()}`);
  }
  return real;
}

/**
 * Resolve a session checklist path under the project root (fail closed).
 */
export function resolveChecklistPathInProject(
  projectRoot: string,
  checklistPath: string,
): string | null {
  const root = normalizeProjectRoot(projectRoot);
  if (!root || !checklistPath.trim()) return null;
  const abs = path.isAbsolute(checklistPath)
    ? checklistPath
    : path.join(root, checklistPath);
  try {
    if (!fs.existsSync(abs)) return null;
    if (!isRealpathInsideProject(root, abs)) return null;
    return fs.realpathSync(abs);
  } catch {
    return null;
  }
}
