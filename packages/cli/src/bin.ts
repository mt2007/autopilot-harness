#!/usr/bin/env node
import { Command } from "commander";
import {
  CLI_NAME,
  formatPostInstallFooter,
  formatHostActivationTips,
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
  uninstallProject,
} from "./index.js";
import {
  defaultSurfaceFor,
  normalizeBinding,
  parsePlatformsCliList,
  primaryBinding,
} from "./init/platforms.js";
import { loadLocale } from "@autopilot-harness/i18n";

const program = new Command();

program
  .name(CLI_NAME)
  .description(loadLocale("en").cli.help)
  .version(PACKAGE_VERSION);

program
  .command("init")
  .description("Install Autopilot into the current project")
  .option("-p, --platform <platform>", "AI platform (single)", "cursor")
  .option("--harness <platform>", "Alias for --platform")
  .option(
    "--platforms <list>",
    "Comma-separated platforms (e.g. cursor). Wins over --platform",
  )
  .option(
    "--add-platform <platform>",
    "Merge a platform into an existing install (updates config.yml)",
  )
  .option(
    "--surface <surface>",
    "Surface for a single --platform (omit for host default: cursor→ide, claude-code→cli)",
  )
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
      platforms?: string;
      addPlatform?: string;
      surface?: string;
      locale: string;
      yes?: boolean;
      force?: boolean;
    }) => {
      const addPlatformRaw =
        typeof opts.addPlatform === "string" ? opts.addPlatform.trim() : "";
      const mergePlatforms = addPlatformRaw !== "";
      const surfaceOpt =
        typeof opts.surface === "string" && opts.surface.trim() !== ""
          ? opts.surface.trim()
          : undefined;

      const platformsFlag =
        typeof opts.platforms === "string" ? opts.platforms.trim() : "";
      let platforms: ReturnType<typeof parsePlatformsCliList> | null = null;
      if (platformsFlag !== "") {
        try {
          platforms = parsePlatformsCliList(platformsFlag, surfaceOpt);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`init failed: ${msg}`);
          process.exitCode = 1;
          return;
        }
        if (!platforms || platforms.length === 0) {
          console.error(
            `init failed: invalid --platforms "${platformsFlag}" (no usable platform ids)`,
          );
          process.exitCode = 1;
          return;
        }
      }

      if (mergePlatforms) {
        const added = normalizeBinding(
          addPlatformRaw,
          defaultSurfaceFor(addPlatformRaw),
        );
        if (!added) {
          console.error(`init failed: invalid --add-platform "${addPlatformRaw}"`);
          process.exitCode = 1;
          return;
        }
        platforms = platforms ? [...platforms, added] : [added];
      }

      if (!platforms || platforms.length === 0) {
        const single = opts.harness ?? opts.platform;
        const b = normalizeBinding(single, surfaceOpt);
        platforms = b ? [b] : [{ id: "cursor", surface: "ide" }];
      }

      const primary = primaryBinding(platforms);

      if (!opts.yes) {
        if (mergePlatforms) {
          console.error(
            `Interactive --add-platform is not supported. Use: ${CLI_NAME} init --yes --add-platform <id>`,
          );
          process.exitCode = 1;
          return;
        }
        const code = await runInteractiveInit({
          projectRoot: process.cwd(),
          force: Boolean(opts.force),
          packageVersion: PACKAGE_VERSION,
          locale: opts.locale,
          platform: primary.id,
          surface: primary.surface,
        });
        process.exitCode = code;
        return;
      }

      const result = installInitYes({
        projectRoot: process.cwd(),
        platform: primary.id,
        surface: primary.surface,
        platforms,
        mergePlatforms,
        locale: opts.locale,
        force: Boolean(opts.force) || mergePlatforms,
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
      console.log("");
      for (const line of formatPostInstallFooter(platforms.map((p) => p.id))) {
        console.log(line);
      }
    },
  );

program
  .command("uninstall")
  .description(
    "Remove Autopilot wiring from this project (keeps plans/; config/state by default)",
  )
  .option("--dry-run", "Preview actions without deleting")
  .option(
    "--purge-all",
    "Also remove .autopilot/ (config.yml + state.db). Never deletes plans/",
  )
  .action((opts: { dryRun?: boolean; purgeAll?: boolean }) => {
    const result = uninstallProject({
      projectRoot: process.cwd(),
      dryRun: Boolean(opts.dryRun),
      purgeAll: Boolean(opts.purgeAll),
    });
    if (!result.ok) {
      console.error(`uninstall failed: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      result.dryRun
        ? `${PREFERRED_NAME} uninstall dry-run:`
        : `${PREFERRED_NAME} uninstall:`,
    );
    for (const a of result.actions) {
      console.log(`  · ${a}`);
    }
    if (!result.dryRun) {
      for (const f of result.removed) {
        console.log(`  − ${f}`);
      }
    }
    if (result.kept.length > 0) {
      console.log("");
      console.log("── kept ────────────────────────────────");
      for (const k of result.kept) {
        console.log(`  · ${k}`);
      }
    }
  });

program
  .command("upgrade")
  .description(
    "Upgrade Autopilot files in this project to the current CLI version",
  )
  .option("--dry-run", "Preview actions without writing")
  .option(
    "--target <version>",
    "Reserved; currently pins to the running CLI version",
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
      console.log("");
      for (const tip of formatHostActivationTips(result.platform)) {
        console.log(tip);
      }
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
