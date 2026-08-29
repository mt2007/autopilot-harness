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
  type InitWizardAnswers,
  type PlansGitPolicy,
  type ShellAliasTarget,
} from "./wizard-helpers.js";

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
    const locale: InitLocale = opts.locale === "zh-CN" ? "zh-CN" : "en";
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
          label: "Auto-add alias to ~/.zshrc",
          hint: "alias autopilot='npx autopilot-harness'",
        },
        { value: "bashrc", label: "Auto-add alias to ~/.bashrc" },
        {
          value: "skip",
          label: `Skip — use ${CLI_NAME} / npx`,
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
      `Locale:    ${locale} (cheat sheet only)`,
      `CLI:       npx ${CLI_NAME}${shellAlias === "skip" ? "" : ` (+ ~/.${shellAlias})`}`,
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

  const platform = await p.select<"cursor">({
    message: "AI platform",
    options: [
      {
        value: "cursor",
        label: "Cursor",
        hint: "v0.1 only — others Coming v0.2+",
      },
    ],
    initialValue: "cursor",
  });
  if (p.isCancel(platform)) {
    return cancelOut(p, "Cancelled.");
  }

  const surface = await p.select<"ide">({
    message: "Surface",
    options: [
      {
        value: "ide",
        label: "IDE — hook integration (recommended)",
        hint: "CLI/runner Coming v0.4",
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
      "Slash skill names are fixed; editing triggers only changes text phrases.",
    ].join("\n"),
    "Triggers",
  );
  const triggersChoice = await p.select<"defaults">({
    message: "Customize trigger phrases?",
    options: [{ value: "defaults", label: "Use defaults" }],
    initialValue: "defaults",
  });
  if (p.isCancel(triggersChoice)) {
    return cancelOut(p, "Cancelled.");
  }

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
        label: "Auto-add alias to ~/.zshrc",
        hint: "alias autopilot='npx autopilot-harness'",
      },
      {
        value: "bashrc",
        label: "Auto-add alias to ~/.bashrc",
      },
      {
        value: "skip",
        label: `Skip — use ${CLI_NAME} / npx`,
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
    `CLI:       npx ${CLI_NAME}${shellAlias === "skip" ? "" : ` (+ ~/.${shellAlias})`}`,
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
      const alias = appendShellAlias(answers.shellAlias);
      if (alias.added) {
        p.log.step(`alias → ${alias.path}`);
        p.log.info(`Run: source ${alias.path}   then: autopilot status`);
      } else {
        p.log.info(`Alias already present in ${alias.path}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      p.log.warn(`Could not write shell alias: ${msg}`);
    }
  }

  const cheat = formatCheatSheet(
    answers.locale,
    CLI_NAME,
    answers.plansDir,
  );
  p.note(cheat.join("\n"), `${PREFERRED_NAME} is ready`);
  p.outro("Done.");
  return 0;
}
