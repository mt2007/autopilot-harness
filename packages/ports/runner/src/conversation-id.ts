import { createHash } from "node:crypto";
import fs from "node:fs";
import { normalizeProjectRoot } from "@autopilot-harness/core";

/**
 * Stable conversation id for the project-scoped runner executor.
 * `runner:` + first 16 hex of sha256(realpath(projectRoot)).
 */
export function stableRunnerConversationId(projectRoot: string): string {
  const root = normalizeProjectRoot(projectRoot);
  if (!root) {
    throw new Error("Invalid project root for runner conversation id.");
  }
  let real: string;
  try {
    real = fs.realpathSync(root);
  } catch {
    real = root;
  }
  const hex = createHash("sha256").update(real, "utf8").digest("hex").slice(0, 16);
  return `runner:${hex}`;
}

/** Hash fragment for prompt filenames (not the full conversation id). */
export function runnerConversationFileToken(conversationId: string): string {
  return createHash("sha256")
    .update(conversationId, "utf8")
    .digest("hex")
    .slice(0, 16);
}
