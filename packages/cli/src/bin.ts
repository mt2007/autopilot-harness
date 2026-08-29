#!/usr/bin/env node
import { Command } from "commander";
import {
  CLI_NAME,
  formatSessionList,
  formatStatus,
  installInitYes,
  PACKAGE_VERSION,
  PREFERRED_NAME,
  purgeProjectSession,
  renameProjectSession,
  resetProjectSessionReview,
  runDoctor,
  runInteractiveInit,
  setProjectLocale,
  readStaleAfterHours,
  upgradeProject,
} from "./index.js";
import { loadLocale } from "@autopilot-harness/i18n";

const program = new Command();

program
  .name(CLI_NAME)
  .description(loadLocale("en").cli.help)
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
    async (opts: {
      platform: string;
      harness?: string;
      surface: string;
      locale: string;
      yes?: boolean;
      force?: boolean;
    }) => {
      const platform = opts.harness ?? opts.platform;

      if (!opts.yes) {
        const code = await runInteractiveInit({
          projectRoot: process.cwd(),
          force: Boolean(opts.force),
          packageVersion: PACKAGE_VERSION,
          locale: opts.locale,
          platform,
          surface: opts.surface,
        });
        process.exitCode = code;
        return;
      }

      const result = installInitYes({
        projectRoot: process.cwd(),
        platform,
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
  .command("upgrade")
  .description(
    "Upgrade Autopilot files in this project to the current CLI version",
  )
  .option("--dry-run", "Preview actions without writing")
  .option(
    "--target <version>",
    "Reserved; v0.1 pins to the running CLI version",
  )
  .action((opts: { dryRun?: boolean; target?: string }) => {
    const result = upgradeProject({
      projectRoot: process.cwd(),
      dryRun: Boolean(opts.dryRun),
      packageVersion: PACKAGE_VERSION,
      target: opts.target,
    });
    if (!result.ok) {
      console.error(`upgrade failed: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      result.dryRun
        ? `${PREFERRED_NAME} upgrade dry-run:`
        : `${PREFERRED_NAME} upgraded to ${PACKAGE_VERSION}:`,
    );
    for (const a of result.actions) {
      console.log(`  · ${a}`);
    }
    if (!result.dryRun) {
      for (const f of result.written) {
        console.log(`  + ${f}`);
      }
      console.log("");
      console.log("── doctor ──────────────────────────────");
      for (const line of result.doctorLines) console.log(line);
      if (!result.doctorOk) {
        console.error(
          "upgrade wrote files but doctor reported failures (exit 1)",
        );
        process.exitCode = 1;
      }
    }
  });

program
  .command("status")
  .description("Show Autopilot status for this project")
  .action(() => {
    console.log(formatStatus(process.cwd()));
  });

program
  .command("doctor")
  .description("Diagnose Autopilot installation")
  .option("--prune-stale", "Purge sessions older than session.stale_after_hours")
  .action((opts: { pruneStale?: boolean }) => {
    const { ok, lines } = runDoctor(process.cwd(), {
      pruneStale: Boolean(opts.pruneStale),
    });
    for (const line of lines) console.log(line);
    process.exitCode = ok ? 0 : 1;
  });

program
  .command("locale")
  .description("Manage project locale (skill descriptions + config)")
  .command("set")
  .description("Set locale to en or zh-CN (keeps custom triggers)")
  .argument("<locale>", "en | zh-CN")
  .action((locale: string) => {
    const result = setProjectLocale({
      projectRoot: process.cwd(),
      locale,
    });
    if (!result.ok) {
      console.error(`locale set failed: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `${PREFERRED_NAME} locale: ${result.previousLocale} → ${result.locale}`,
    );
    for (const f of result.written) {
      console.log(`  + ${f}`);
    }
    if (result.triggersUpdated.length > 0) {
      console.log(`  triggers updated: ${result.triggersUpdated.join(", ")}`);
    }
    if (result.triggersPreserved.length > 0) {
      console.log(
        `  triggers kept (custom): ${result.triggersPreserved.join(", ")}`,
      );
    }
  });

const sessionCmd = program
  .command("session")
  .description("List and manage Autopilot sessions");

sessionCmd
  .command("list")
  .description("List sessions (human-readable titles)")
  .action(() => {
    const result = formatSessionList({
      projectRoot: process.cwd(),
      staleAfterHours: readStaleAfterHours(process.cwd()),
    });
    if (!result.ok) {
      console.error(`session list failed: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    for (const line of result.lines) console.log(line);
  });

sessionCmd
  .command("rename")
  .description("Rename a session (source=user; wins over platform titles)")
  .argument("<id>", "Conversation id or unique prefix")
  .argument("<title>", "New display title")
  .action((id: string, title: string) => {
    const result = renameProjectSession({
      projectRoot: process.cwd(),
      id,
      title,
    });
    if (!result.ok) {
      console.error(`session rename failed: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${PREFERRED_NAME} session renamed`);
  });

sessionCmd
  .command("purge")
  .description("Delete a session and its review chain")
  .argument("<id>", "Conversation id or unique prefix")
  .action((id: string) => {
    const result = purgeProjectSession({
      projectRoot: process.cwd(),
      id,
    });
    if (!result.ok) {
      console.error(`session purge failed: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${PREFERRED_NAME} session purged`);
  });

sessionCmd
  .command("reset-review")
  .description("Reset review chain for a session (keep session row)")
  .argument("<id>", "Conversation id or unique prefix")
  .action((id: string) => {
    const result = resetProjectSessionReview({
      projectRoot: process.cwd(),
      id,
    });
    if (!result.ok) {
      console.error(`session reset-review failed: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(`${PREFERRED_NAME} review chain reset`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exitCode = 1;
});
