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

/** Skip the prompt when only one choice exists (still logs the selection). */
async function selectOrOnly<T>(
  p: InitPrompts,
  opts: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
  },
): Promise<T | symbol> {
  if (opts.options.length === 0) {
    throw new Error(`selectOrOnly: no options for "${opts.message}"`);
  }
  if (opts.options.length === 1) {
    const only = opts.options[0]!;
    p.log.info(`${opts.message}: ${only.label}`);
    return only.value;
  }
  return p.select(opts);
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

  p.intro(`${PREFERRED_NAME} Harness`);
  p.note(
    [
      "Two-phase agent harness:",
      "① Planning — discuss, design, break into a checklist",
      "② Executing — advance after self-review passes",
      "",
      `Docs say ${PREFERRED_NAME} · package ${CLI_NAME}`,
    ].join("\n"),
    "Welcome",
  );

  const gitLine = probe.hasGit
    ? `Git: yes · branch: ${probe.branch ?? "(detached)"}`
    : "Git: no (recommended to install at a git root)";
  if (!probe.hasGit) {
    p.log.warn("No git repository detected — continue only if intentional.");
  }

  const installHere = await p.confirm({
    message: `Install in this project?\n  Path: ${probe.projectRoot}\n  ${gitLine}`,
    initialValue: true,
  });
  if (p.isCancel(installHere) || !installHere) {
    return cancelOut(
      p,
      `Cancelled. cd to the project root, then re-run: ${CLI_NAME} init`,
    );
  }

  let force = Boolean(opts.force);
  if (probe.alreadyInitialized) {
    p.log.warn(".autopilot/config.yml already exists.");
    if (!force) {
      const useForce = await p.confirm({
        message:
          "Refresh hook/skills/pin + merge hooks? (keeps existing config.yml)",
        initialValue: false,
      });
      if (p.isCancel(useForce) || !useForce) {
        return cancelOut(
          p,
          `Cancelled. Use ${CLI_NAME} init --force to refresh without the prompt.`,
        );
      }
      force = true;
    }

    // Force refresh: config/plans/verify are not rewritten — skip those prompts.
    p.log.info(
      "Refresh keeps config.yml (plans dir, verify, triggers unchanged).",
    );
    const locale = readProjectLocale(probe.projectRoot);
    p.log.info(`Locale (from config.yml): ${locale}`);
    const shellDefault: ShellAliasTarget =
      (process.env.SHELL ?? "").includes("zsh")
        ? "zshrc"
        : (process.env.SHELL ?? "").includes("bash")
          ? "bashrc"
          : "skip";
    const cliCmd = resolveCliCommand();
    const shellAlias = await p.select<ShellAliasTarget>({
      message: "Shell shortcut",
      options: [
        {
          value: "zshrc",
          label: "Add autopilot() to ~/.zshrc",
          hint: cliCmd,
        },
        {
          value: "bashrc",
          label: "Add autopilot() to ~/.bashrc",
          hint: cliCmd,
        },
        {
          value: "skip",
          label: `Skip — run via: ${cliCmd}`,
        },
      ],
      initialValue: shellDefault,
    });
    if (p.isCancel(shellAlias)) {
      return cancelOut(p, "Cancelled.");
    }

    const summary = [
      `Project:   ${probe.projectRoot}`,
      `Mode:      force refresh (keep config.yml)`,
      `Locale:    ${locale} (from config.yml; skills refresh)`,
      `CLI:       ${cliCmd}${shellAlias === "skip" ? "" : ` (+ ~/.${shellAlias})`}`,
      "",
      "Will refresh: hook, skills, workflows, pin, hooks.json merge",
    ].join("\n");
    const ready = await p.confirm({
      message: `Ready to refresh?\n${summary}`,
      initialValue: true,
    });
    if (p.isCancel(ready) || !ready) {
      return cancelOut(p, "Cancelled.");
    }

    return {
      projectRoot: probe.projectRoot,
      locale,
      platform: "cursor",
      surface: "ide",
      plansDir: "plans",
      plansGit: "commit",
      verifyEnabled: false,
      shellAlias,
      force: true,
      packageVersion: opts.packageVersion ?? PACKAGE_VERSION,
    };
  }

  const locale = await p.select<InitLocale>({
    message: "Language / 语言",
    options: [
      { value: "en", label: "English" },
      { value: "zh-CN", label: "中文（简体）" },
    ],
    initialValue: opts.locale === "zh-CN" ? "zh-CN" : "en",
  });
  if (p.isCancel(locale)) {
    return cancelOut(p, "Cancelled.");
  }

  const platform = await selectOrOnly<"cursor">(p, {
    message: "AI platform",
    options: [{ value: "cursor", label: "Cursor" }],
    initialValue: "cursor",
  });
  if (p.isCancel(platform)) {
    return cancelOut(p, "Cancelled.");
  }

  const surface = await selectOrOnly<"ide">(p, {
    message: "Surface",
    options: [
      {
        value: "ide",
        label: "IDE — hook integration (recommended)",
      },
    ],
    initialValue: "ide",
  });
  if (p.isCancel(surface)) {
    return cancelOut(p, "Cancelled.");
  }

  const plansChoice = await p.select<"plans" | "custom">({
    message: "Plans directory",
    options: [
      { value: "plans", label: "plans/ at repo root (recommended)" },
      { value: "custom", label: "Custom path…" },
    ],
    initialValue: "plans",
  });
  if (p.isCancel(plansChoice)) {
    return cancelOut(p, "Cancelled.");
  }

  let plansDir = "plans";
  if (plansChoice === "custom") {
    const custom = await p.text({
      message: "Plans directory (relative to project root)",
      placeholder: "docs/plans",
      initialValue: "docs/plans",
      validate: (v) => {
        const n = normalizePlansDir(v);
        return n.ok ? undefined : n.error;
      },
    });
    if (p.isCancel(custom)) {
      return cancelOut(p, "Cancelled.");
    }
    const n = normalizePlansDir(custom);
    if (!n.ok) {
      return cancelOut(p, n.error);
    }
    plansDir = n.value;
  }

  const plansGit = await p.select<PlansGitPolicy>({
    message: "Track plans in git?",
    options: [
      {
        value: "commit",
        label: "Yes — commit plans/ (recommended)",
      },
      {
        value: "local-only",
        label: "Local only — add plans/ to .gitignore",
      },
      {
        value: "leave",
        label: "I'll configure .gitignore myself",
      },
    ],
    initialValue: "commit",
  });
  if (p.isCancel(plansGit)) {
    return cancelOut(p, "Cancelled.");
  }

  const verifyChoice = await p.select<"skip" | "enable">({
    message: "Machine verify commands (optional)",
    options: [
      { value: "skip", label: "Skip — no verify layer (default)" },
      {
        value: "enable",
        label: "Enable verify flag (edit commands in config later)",
      },
    ],
    initialValue: "skip",
  });
  if (p.isCancel(verifyChoice)) {
    return cancelOut(p, "Cancelled.");
  }

  p.note(
    [
      "Triggers are text fallbacks (line-start). Prefer /autopilot-on skills.",
      "Slash skill names are fixed; stock phrases follow the selected locale.",
      "Customize later via .autopilot/config.yml (or locale set).",
    ].join("\n"),
    "Triggers",
  );

  const cliCmd = resolveCliCommand();
  const shellDefault: ShellAliasTarget =
    (process.env.SHELL ?? "").includes("zsh")
      ? "zshrc"
      : (process.env.SHELL ?? "").includes("bash")
        ? "bashrc"
        : "skip";
  const shellAlias = await p.select<ShellAliasTarget>({
    message: "Shell shortcut",
    options: [
      {
        value: "zshrc",
        label: "Add autopilot() to ~/.zshrc",
        hint: cliCmd,
      },
      {
        value: "bashrc",
        label: "Add autopilot() to ~/.bashrc",
        hint: cliCmd,
      },
      {
        value: "skip",
        label: `Skip — run via: ${cliCmd}`,
      },
    ],
    initialValue: shellDefault,
  });
  if (p.isCancel(shellAlias)) {
    return cancelOut(p, "Cancelled.");
  }

  const summary = [
    `Project:   ${probe.projectRoot}`,
    `Platform:  ${platform} (${surface}, hook)`,
    `Locale:    ${locale}`,
    `Plans:     ${plansDir}/<slug>/checklist.md`,
    `Plans git: ${plansGit}`,
    `Verify:    ${verifyChoice === "skip" ? "skipped" : "enabled (flag)"}`,
    `CLI:       ${cliCmd}${shellAlias === "skip" ? "" : ` (+ ~/.${shellAlias})`}`,
    `Force:     ${force ? "yes (keep config.yml)" : "no"}`,
    "",
    "Will write: .autopilot/, .cursor/hooks.json, skills, workflows, quickstart",
  ].join("\n");

  const ready = await p.confirm({
    message: `Ready to install?\n${summary}`,
    initialValue: true,
  });
  if (p.isCancel(ready) || !ready) {
    return cancelOut(p, "Cancelled.");
  }

  return {
    projectRoot: probe.projectRoot,
    locale,
    platform,
    surface,
    plansDir,
    plansGit,
    verifyEnabled: verifyChoice === "enable",
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
      `Interactive init requires a TTY. Use: ${CLI_NAME} init --yes`,
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
    p.outro("Init failed.");
    return 1;
  }

  if (!result.ok) {
    spin.stop("Install failed");
    p.log.warn(result.error);
    p.outro("Init failed.");
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
        p.log.step(`shell shortcut → ${shortcut.path}`);
        p.log.info(`Run: source ${shortcut.path}   then: autopilot status`);
      } else {
        p.log.info(`Shell shortcut already present in ${shortcut.path}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.log.warn(`Could not write shell shortcut: ${msg}`);
    }
  }

  const cheat = formatCheatSheet(
    answers.locale,
    resolveCliCommand(),
    answers.plansDir,
  );
  p.note(cheat.join("\n"), `${PREFERRED_NAME} is ready`);
  p.outro("Done.");
  return 0;
}
