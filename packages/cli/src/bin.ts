#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("autopilot-harness")
  .description("Autopilot Harness — Planning → Executing agent harness")
  .version("0.1.0");

program
  .command("init")
  .description("Install Autopilot into the current project")
  .option("-p, --platform <platform>", "AI platform", "cursor")
  .option("--harness <platform>", "Alias for --platform")
  .option("--surface <surface>", "Surface", "ide")
  .option("--locale <locale>", "Locale", "en")
  .option("-y, --yes", "Non-interactive defaults")
  .option("--force", "Overwrite existing .autopilot")
  .action(() => {
    console.log(
      "init: coming in this package build — use scaffolding from source for now.",
    );
    process.exitCode = 0;
  });

program
  .command("status")
  .description("Show Autopilot status for this project")
  .action(() => {
    console.log("Autopilot status: not initialized (no .autopilot/config.yml)");
  });

program
  .command("doctor")
  .description("Diagnose Autopilot installation")
  .action(() => {
    console.log("doctor: run after init");
  });

program
  .command("help-alias", { hidden: true })
  .action(() => {});

program.parse();
