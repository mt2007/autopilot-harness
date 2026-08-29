/** Shared types for Autopilot init. */

export type InitPlatform = "cursor";
export type InitSurface = "ide";
export type InitLocale = "en" | "zh-CN";

export interface InitYesOptions {
  projectRoot: string;
  platform: string;
  surface: string;
  locale: string;
  force: boolean;
  packageVersion?: string;
}

export interface InitOk {
  ok: true;
  written: string[];
}

export interface InitFail {
  ok: false;
  error: string;
}

export type InitResult = InitOk | InitFail;

export interface HookCommand {
  command: string;
}

export interface HooksFile {
  version?: number;
  hooks: {
    beforeSubmitPrompt?: HookCommand[];
    afterFileEdit?: HookCommand[];
    stop?: HookCommand[];
    [event: string]: HookCommand[] | undefined;
  };
}

export const PACKAGE_VERSION = "0.1.0";
export const HOOK_MARKER = "autopilot-harness";
export const AUTOPILOT_EVENTS = [
  "beforeSubmitPrompt",
  "afterFileEdit",
  "stop",
] as const;
