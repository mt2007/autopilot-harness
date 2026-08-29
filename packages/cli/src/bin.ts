#!/usr/bin/env node
import { Command } from "commander";
import {
  CLI_NAME,
  formatStatus,
  installInitYes,
  PACKAGE_VERSION,
  PREFERRED_NAME,
  runDoctor,
} from "./index.js";

const program = new Command();

program
  .name(CLI_NAME)
  .description(`${PREFERRED_NAME} Harness — Planning → Executing agent harness`)
  .version(PACKAGE_VERSION);

program
  .command("init")
  .description("Install Autopilot into the current project")
  .option("-p, --platform <platform>", "AI platform", "cursor")
  .option("--harness <platform>", "Alias for --platform")
  .option("--surface <surface>", "Surface", "ide")
  .option("--locale <locale>", "Locale", "en")
  .option("-y, --yes", "Non-interactive defaults")
  .option(
    "--force",
    "Refresh hook/skills/pin + merge hooks (keeps existing config.yml)",
  )
  .action(
    (opts: {
      platform: string;
      harness?: string;
      surface: string;
      locale: string;
      yes?: boolean;
      force?: boolean;
    }) => {
      if (!opts.yes) {
        console.log(
          `${PREFERRED_NAME} interactive TUI init is not in this build yet.`,
        );
        console.log(`Use:  ${CLI_NAME} init --yes --platform cursor`);
        process.exitCode = 1;
        return;
      }

      const result = installInitYes({
        projectRoot: process.cwd(),
        platform: opts.harness ?? opts.platform,
        surface: opts.surface,
        locale: opts.locale,
        force: Boolean(opts.force),
        packageVersion: PACKAGE_VERSION,
      });

      if (!result.ok) {
        console.error(`init failed: ${result.error}`);
        process.exitCode = 1;
        return;
      }

      console.log(`${PREFERRED_NAME} installed.`);
      for (const f of result.written) {
        console.log(`  + ${f}`);
      }
      console.log("");
      console.log("── Quick start ─────────────────────────");
      console.log("  /autopilot-on          # planning");
      console.log("  /autopilot-run         # executing");
      console.log(`  ${CLI_NAME} status`);
      console.log(`  ${CLI_NAME} doctor`);
    },
  );

program
  .command("status")
  .description("Show Autopilot status for this project")
  .action(() => {
    console.log(formatStatus(process.cwd()));
  });

program
  .command("doctor")
  .description("Diagnose Autopilot installation")
  .action(() => {
    const { ok, lines } = runDoctor(process.cwd());
    for (const line of lines) console.log(line);
    process.exitCode = ok ? 0 : 1;
  });

program.parse();
