import { spawn } from "node:child_process";
import type { RunnerConfig } from "./config.js";
import { assertRunnerCommand } from "./config.js";
import {
  expandCommandTemplate,
  resolveRunnerCwd,
  unlinkPromptFile,
} from "./command-template.js";
import type { AgentDriver, DriverResult, DriverRunInput } from "./driver.js";

/**
 * Spawn `runner.command` with `{prompt}` / `{prompt_file}` (shell: false).
 */
export class CliDriver implements AgentDriver {
  constructor(private readonly config: RunnerConfig) {
    assertRunnerCommand(config);
  }

  async run(input: DriverRunInput): Promise<DriverResult> {
    let promptFilePath: string | undefined;
    try {
      // Fail cwd before writing prompt files (avoid orphan files on bad config).
      const cwd = resolveRunnerCwd(input.projectRoot, this.config.cwd);
      const expanded = expandCommandTemplate(this.config, {
        tip: input.prompt,
        projectRoot: input.projectRoot,
        conversationId: input.conversationId,
        iteration: input.iteration,
      });
      promptFilePath = expanded.promptFilePath;
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...this.config.env,
      };

      return await new Promise<DriverResult>((resolve, reject) => {
        let settled = false;
        const child = spawn(expanded.file, expanded.args, {
          cwd,
          env,
          shell: false,
          stdio: "inherit",
        });
        child.on("error", (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
        child.on("close", (code, signal) => {
          if (settled) return;
          settled = true;
          resolve({
            exitCode: code,
            signal: signal ?? null,
          });
        });
      });
    } finally {
      unlinkPromptFile(promptFilePath);
    }
  }
}
