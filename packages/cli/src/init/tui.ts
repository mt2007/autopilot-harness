import * as clack from "@clack/prompts";
import { CLI_NAME, PREFERRED_NAME } from "../names.js";
import { PACKAGE_VERSION } from "./types.js";
import type { InitLocale, InitResult } from "./types.js";
import { installInitYes } from "./install.js";
import {
  answersToInstallOptions,
  appendShellAlias,
  formatCheatSheet,
  normalizePlansDir,
  probeProject,
  resolveCliCommand,
  type InitWizardAnswers,
  type PlansGitPolicy,
  type ShellAliasTarget,
} from "./wizard-helpers.js";
import { readConfigInstallHints } from "./config-merge.js";
import {
  MAX_UNTRUSTED_TEXT_BYTES,
  readUntrustedUtf8File,
} from "../read-untrusted-file.js";
import path from "node:path";

export type SelectOption<T> = { value: T; label: string; hint?: string };

/** Injectable prompts so tests can drive the wizard without a TTY. */
export interface InitPrompts {
  intro: (message: string) => void;
  outro: (message: string) => void;
  note: (message: string, title?: string) => void;
  log: {
    info: (message: string) => void;
    warn: (message: string) => void;
    step: (message: string) => void;
  };
  confirm: (opts: {
    message: string;
    initialValue?: boolean;
  }) => Promise<boolean | symbol>;
  select: <T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
  }) => Promise<T | symbol>;
  text: (opts: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: (value: string) => string | undefined;
  }) => Promise<string | symbol>;
  isCancel: (value: unknown) => value is symbol;
  spinner: () => {
    start: (msg?: string) => void;
    stop: (msg?: string) => void;
  };
}

function defaultPrompts(): InitPrompts {
  const select: InitPrompts["select"] = async <T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
  }): Promise<T | symbol> => {
    const result = await clack.select({
      message: opts.message,
      options: opts.options as never,
      initialValue: opts.initialValue,
    });
    return result as T | symbol;
  };
  return {
    intro: clack.intro,
    outro: clack.outro,
    note: clack.note,
    log: {
      info: clack.log.info,
      warn: clack.log.warn,
      step: clack.log.step,
    },
    confirm: clack.confirm,
    select,
    text: clack.text,
    isCancel: clack.isCancel,
    spinner: clack.spinner,
  };
}

export interface InteractiveInitOptions {
  projectRoot: string;
  force?: boolean;
  packageVersion?: string;
  /** CLI flags as soft defaults before prompts. */
  locale?: string;
  platform?: string;
  surface?: string;
  prompts?: InitPrompts;
  /** Override install (tests). */
  install?: (opts: ReturnType<typeof answersToInstallOptions>) => InitResult;
}

function cancelOut(p: InitPrompts, message: string): null {
  p.outro(message);
  return null;
}

function readProjectLocale(projectRoot: string): InitLocale {
  const configPath = path.join(projectRoot, ".autopilot", "config.yml");
  try {
    const yaml = readUntrustedUtf8File(
      configPath,
      MAX_UNTRUSTED_TEXT_BYTES,
      ".autopilot/config.yml",
    );
    const hints = readConfigInstallHints(yaml);
    return hints.locale === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}

/**
 * Collect wizard answers via prompts. Returns null if the user cancels.
 */
export async function collectWizardAnswers(
  opts: InteractiveInitOptions,
): Promise<InitWizardAnswers | null> {
  const p = opts.prompts ?? defaultPrompts();
  const projectRoot = opts.projectRoot;
  const probe = probeProject(projectRoot);

  p.intro(`Welcome to ${PREFERRED_NAME}`);
  p.note(
    [
      "A small harness that keeps agents honest across two phases:",
      "",
      "  1. Plan  — shape the work into a checklist",
      "  2. Run   — implement item by item, with self-review between steps",
      "",
      `You'll get Cursor hooks, slash skills, and a project config under .autopilot/.`,
      `CLI package: ${CLI_NAME}`,
    ].join("\n"),
    "What this installs",
  );

  const gitLine = probe.hasGit
    ? `git · ${probe.branch ?? "detached HEAD"}`
    : "no git repo (works, but a git root is nicer)";
  if (!probe.hasGit) {
    p.log.warn(
      "This folder isn't a git repository. That's fine if you meant it — otherwise cd to your project root first.",
    );
  }

  const installHere = await p.confirm({
    message: [
      "Install Autopilot here?",
      "",
      `  ${probe.projectRoot}`,
      `  ${gitLine}`,
    ].join("\n"),
    initialValue: true,
  });
  if (p.isCancel(installHere) || !installHere) {
    return cancelOut(
      p,
      `No problem. cd to the project you want, then run: ${resolveCliCommand()} init`,
    );
  }

  let force = Boolean(opts.force);
  if (probe.alreadyInitialized) {
    p.log.warn("Looks like Autopilot is already set up (.autopilot/config.yml found).");
    if (!force) {
      p.note(
        [
          "A refresh updates hooks, skills, workflows, and the pin —",
          "your existing config.yml is left alone (plans, verify, triggers stay as-is).",
        ].join("\n"),
        "Already installed",
      );
      const useForce = await p.confirm({
        message: "Refresh the install files without touching config.yml?",
        initialValue: false,
      });
      if (p.isCancel(useForce) || !useForce) {
        return cancelOut(
          p,
          `Left as-is. Tip: ${resolveCliCommand()} init --force skips this question next time.`,
        );
      }
      force = true;
    }

    // Force refresh: config/plans/verify are not rewritten — skip those prompts.
    p.log.info("Keeping your config.yml; only wiring/skills will be refreshed.");
    const locale = readProjectLocale(probe.projectRoot);
    p.log.info(`Locale from config: ${locale}`);
    const shellDefault: ShellAliasTarget =
      (process.env.SHELL ?? "").includes("zsh")
        ? "zshrc"
        : (process.env.SHELL ?? "").includes("bash")
          ? "bashrc"
          : "skip";
    const cliCmd = resolveCliCommand();
    const shellAlias = await p.select<ShellAliasTarget>({
      message: "Want a shell helper so you can type `autopilot` anywhere?",
      options: [
        {
          value: "zshrc",
          label: "Yes — add autopilot() to ~/.zshrc",
          hint: cliCmd,
        },
        {
          value: "bashrc",
          label: "Yes — add autopilot() to ~/.bashrc",
          hint: cliCmd,
        },
        {
          value: "skip",
          label: "No thanks — I'll call the CLI directly",
          hint: cliCmd,
        },
      ],
      initialValue: shellDefault,
    });
    if (p.isCancel(shellAlias)) {
      return cancelOut(p, "Cancelled — nothing was changed.");
    }

    const summary = [
      `Project:  ${probe.projectRoot}`,
      `Mode:     refresh (keep config.yml)`,
      `Locale:   ${locale}`,
      `CLI:      ${cliCmd}${shellAlias === "skip" ? "" : ` · alias → ~/.${shellAlias}`}`,
      "",
      "Will refresh: hook, skills, workflows, pin, hooks.json merge",
    ].join("\n");
    const ready = await p.confirm({
      message: `Sound good?\n\n${summary}`,
      initialValue: true,
    });
    if (p.isCancel(ready) || !ready) {
      return cancelOut(p, "Cancelled — nothing was changed.");
    }

    return {
      projectRoot: probe.projectRoot,
      locale,
      platform: "cursor",
      surface: "ide",
      plansDir: "plans",
      plansGit: "commit",
      verifyEnabled: false,
      maxErrorsBeforePause: 0,
      shellAlias,
      force: true,
      packageVersion: opts.packageVersion ?? PACKAGE_VERSION,
    };
  }

  p.note(
    [
      "Agent replies and stock trigger phrases will follow this locale.",
      `You can switch later with: ${resolveCliCommand()} locale set en`,
      "(use zh-CN for Simplified Chinese)",
    ].join("\n"),
    "Language",
  );
  const locale = await p.select<InitLocale>({
    message: "Which language should Autopilot speak in this project?",
    options: [
      { value: "en", label: "English", hint: "default for most OSS repos" },
      {
        value: "zh-CN",
        label: "Chinese (Simplified)",
        hint: "followups & skill blurbs in Simplified Chinese",
      },
    ],
    initialValue: opts.locale === "zh-CN" ? "zh-CN" : "en",
  });
  if (p.isCancel(locale)) {
    return cancelOut(p, "Cancelled — nothing was changed.");
  }

  p.note(
    "v0.1 ships Cursor IDE hooks. More platforms may land later.",
    "Platform",
  );
  const platform = await p.select<"cursor">({
    message: "Which agent host are you using?",
    options: [
      {
        value: "cursor",
        label: "Cursor",
        hint: "hooks + /autopilot-* skills",
      },
    ],
    initialValue: "cursor",
  });
  if (p.isCancel(platform)) {
    return cancelOut(p, "Cancelled — nothing was changed.");
  }

  const surface = await p.select<"ide">({
    message: "How should Autopilot plug in?",
    options: [
      {
        value: "ide",
        label: "IDE hooks (recommended)",
        hint: "stop / edit / submit hooks drive the loop",
      },
    ],
    initialValue: "ide",
  });
  if (p.isCancel(surface)) {
    return cancelOut(p, "Cancelled — nothing was changed.");
  }

  p.note(
    [
      "Plans live as ordinary markdown in your repo:",
      "  <dir>/<slug>/{brief,plan,checklist}.md",
      "Most people keep them at plans/ next to the code.",
    ].join("\n"),
    "Plans",
  );
  const plansChoice = await p.select<"plans" | "custom">({
    message: "Where should plan files live?",
    options: [
      {
        value: "plans",
        label: "plans/ at the repo root",
        hint: "simple & visible — recommended",
      },
      {
        value: "custom",
        label: "Somewhere else…",
        hint: "e.g. docs/plans",
      },
    ],
    initialValue: "plans",
  });
  if (p.isCancel(plansChoice)) {
    return cancelOut(p, "Cancelled — nothing was changed.");
  }

  let plansDir = "plans";
  if (plansChoice === "custom") {
    const custom = await p.text({
      message: "Relative path from the project root:",
      placeholder: "docs/plans",
      initialValue: "docs/plans",
      validate: (v) => {
        const n = normalizePlansDir(v);
        return n.ok ? undefined : n.error;
      },
    });
    if (p.isCancel(custom)) {
      return cancelOut(p, "Cancelled — nothing was changed.");
    }
    const n = normalizePlansDir(custom);
    if (!n.ok) {
      return cancelOut(p, n.error);
    }
    plansDir = n.value;
  }

  const plansGit = await p.select<PlansGitPolicy>({
    message: "Should those plan files be committed with the project?",
    options: [
      {
        value: "commit",
        label: "Yes — keep them in git",
        hint: "best for teams & reviewable history",
      },
      {
        value: "local-only",
        label: "No — gitignore the plans dir",
        hint: "handy for personal scratchpads",
      },
      {
        value: "leave",
        label: "Don't touch .gitignore",
        hint: "I'll decide later",
      },
    ],
    initialValue: "commit",
  });
  if (p.isCancel(plansGit)) {
    return cancelOut(p, "Cancelled — nothing was changed.");
  }

  p.note(
    [
      "Optional: after self-review, Autopilot can require machine checks",
      "(tests, lint, …) before advancing. You can wire commands in config.yml",
      "anytime — this only flips the enabled flag.",
    ].join("\n"),
    "Verify (optional)",
  );
  const verifyChoice = await p.select<"skip" | "enable">({
    message: "Enable the verify layer now?",
    options: [
      {
        value: "skip",
        label: "Skip for now",
        hint: "you can turn it on later — default",
      },
      {
        value: "enable",
        label: "Enable the flag",
        hint: "add commands under review.verify in config.yml",
      },
    ],
    initialValue: "skip",
  });
  if (p.isCancel(verifyChoice)) {
    return cancelOut(p, "Cancelled — nothing was changed.");
  }

  p.note(
    [
      "When a turn fails (usage limit, HTTP 500, abort, …), Autopilot can",
      "keep recovering — or pause after N failures so you can take a look.",
      "Paused sessions resume with: Autopilot RESUME  /  /autopilot-resume",
      "",
      "Written to config as review.errors.max_before_pause (0 = never pause).",
    ].join("\n"),
    "Turn errors",
  );
  const errorPauseChoice = await p.select<"unlimited" | "5" | "custom">({
    message: "How should consecutive turn errors be handled?",
    options: [
      {
        value: "unlimited",
        label: "Keep going — never auto-pause",
        hint: "best default for overnight / long runs",
      },
      {
        value: "5",
        label: "Pause after 5 errors",
        hint: "a sensible safety net",
      },
      {
        value: "custom",
        label: "Pick my own number…",
        hint: "1–1000",
      },
    ],
    initialValue: "unlimited",
  });
  if (p.isCancel(errorPauseChoice)) {
    return cancelOut(p, "Cancelled — nothing was changed.");
  }

  let maxErrorsBeforePause = 0;
  if (errorPauseChoice === "5") {
    maxErrorsBeforePause = 5;
  } else if (errorPauseChoice === "custom") {
    const custom = await p.text({
      message: "Pause after how many consecutive turn errors?",
      placeholder: "5",
      initialValue: "5",
      validate: (v) => {
        const n = Number((v ?? "").trim());
        if (!Number.isInteger(n) || n < 1 || n > 1000) {
          return "Please enter a whole number between 1 and 1000";
        }
        return undefined;
      },
    });
    if (p.isCancel(custom)) {
      return cancelOut(p, "Cancelled — nothing was changed.");
    }
    maxErrorsBeforePause = Number(String(custom).trim());
  }

  p.note(
    [
      "Day to day, prefer the slash skills: /autopilot-on, /autopilot-run, …",
      "Plain-text triggers (\"Autopilot ON\", …) still work as a fallback.",
      "Phrases follow your locale; tweak anytime in .autopilot/config.yml.",
    ].join("\n"),
    "How you'll start it",
  );

  const cliCmd = resolveCliCommand();
  const shellDefault: ShellAliasTarget =
    (process.env.SHELL ?? "").includes("zsh")
      ? "zshrc"
      : (process.env.SHELL ?? "").includes("bash")
        ? "bashrc"
        : "skip";
  const shellAlias = await p.select<ShellAliasTarget>({
    message: "Want a shell helper so you can type `autopilot` anywhere?",
    options: [
      {
        value: "zshrc",
        label: "Yes — add autopilot() to ~/.zshrc",
        hint: cliCmd,
      },
      {
        value: "bashrc",
        label: "Yes — add autopilot() to ~/.bashrc",
        hint: cliCmd,
      },
      {
        value: "skip",
        label: "No thanks — I'll call the CLI directly",
        hint: cliCmd,
      },
    ],
    initialValue: shellDefault,
  });
  if (p.isCancel(shellAlias)) {
    return cancelOut(p, "Cancelled — nothing was changed.");
  }

  const summary = [
    `Project:  ${probe.projectRoot}`,
    `Host:     ${platform} (${surface})`,
    `Locale:   ${locale}`,
    `Plans:    ${plansDir}/<slug>/checklist.md`,
    `In git:   ${
      plansGit === "commit"
        ? "yes"
        : plansGit === "local-only"
          ? "no (gitignore)"
          : "unchanged"
    }`,
    `Verify:   ${verifyChoice === "skip" ? "off" : "flag on — add commands later"}`,
    `Errors:   ${
      maxErrorsBeforePause === 0
        ? "never auto-pause"
        : `pause after ${maxErrorsBeforePause}`
    }`,
    `CLI:      ${cliCmd}${shellAlias === "skip" ? "" : ` · alias → ~/.${shellAlias}`}`,
    "",
    "Will write: .autopilot/, .cursor/hooks.json, skills, workflows, quickstart",
  ].join("\n");

  const ready = await p.confirm({
    message: `Ready to install?\n\n${summary}`,
    initialValue: true,
  });
  if (p.isCancel(ready) || !ready) {
    return cancelOut(p, "Cancelled — nothing was changed.");
  }

  return {
    projectRoot: probe.projectRoot,
    locale,
    platform,
    surface,
    plansDir,
    plansGit,
    verifyEnabled: verifyChoice === "enable",
    maxErrorsBeforePause,
    shellAlias,
    force,
    packageVersion: opts.packageVersion ?? PACKAGE_VERSION,
  };
}

/**
 * Run interactive init end-to-end. Returns process exit code.
 */
export async function runInteractiveInit(
  opts: InteractiveInitOptions,
): Promise<number> {
  // Injected prompts (tests) skip the TTY gate; real CLI needs a terminal.
  if (!opts.prompts && !process.stdin.isTTY) {
    console.error(
      `Interactive init requires a TTY. Use: ${resolveCliCommand()} init --yes`,
    );
    return 1;
  }

  const p = opts.prompts ?? defaultPrompts();
  const answers = await collectWizardAnswers({ ...opts, prompts: p });
  if (!answers) return 1;

  const installOpts = answersToInstallOptions(answers);
  const installFn = opts.install ?? installInitYes;

  const spin = p.spinner();
  spin.start("Installing Autopilot…");
  let result: InitResult;
  try {
    result = installFn(installOpts);
  } catch (err) {
    spin.stop("Install failed");
    const msg = err instanceof Error ? err.message : String(err);
    p.log.warn(msg);
    p.outro("Something went wrong — see the message above.");
    return 1;
  }

  if (!result.ok) {
    spin.stop("Install failed");
    p.log.warn(result.error);
    p.outro("Something went wrong — see the message above.");
    return 1;
  }

  spin.stop("Installed");
  for (const f of result.written) {
    p.log.step(`+ ${f}`);
  }

  if (answers.shellAlias !== "skip") {
    try {
      const shortcut = appendShellAlias(answers.shellAlias);
      if (shortcut.added) {
        p.log.step(`shell helper → ${shortcut.path}`);
        p.log.info(`Open a new shell, or: source ${shortcut.path}`);
      } else {
        p.log.info(`Shell helper already present in ${shortcut.path}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.log.warn(`Could not write shell helper: ${msg}`);
    }
  }

  const cheat = formatCheatSheet(
    answers.locale,
    resolveCliCommand(),
    answers.plansDir,
  );
  p.note(cheat.join("\n"), `${PREFERRED_NAME} is ready`);
  p.outro("You're all set — try /autopilot-on in Cursor.");
  return 0;
}
