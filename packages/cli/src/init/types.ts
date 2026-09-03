/** Shared types for Autopilot init. */

import type { PlatformBinding } from "./platforms.js";

export type InitPlatform = "cursor";
export type InitSurface = "ide";
export type InitLocale = "en" | "zh-CN";

export type PlansGitPolicy = "commit" | "local-only" | "leave";

export interface InitYesOptions {
  projectRoot: string;
  /** Legacy single host; ignored when `platforms` is non-empty. */
  platform: string;
  /** Legacy single surface; ignored when `platforms` is non-empty. */
  surface: string;
  /**
   * Enabled hosts for this install. When set, wins over platform/surface.
   * Fresh init writes the full list; with `mergePlatforms` merges into config.
   */
  platforms?: PlatformBinding[];
  /**
   * When true with an existing config.yml: merge `platforms` into config
   * (add hosts) instead of leaving config untouched. Implies force semantics
   * for the refresh path.
   */
  mergePlatforms?: boolean;
  locale: string;
  force: boolean;
  packageVersion?: string;
  /** Artifact root under project (default `plans`). */
  plansDir?: string;
  /** How to treat plans/ in git (default commit = do not gitignore). */
  plansGit?: PlansGitPolicy;
  /** Write review.verify.enabled (default false). */
  verifyEnabled?: boolean;
  /**
   * Consecutive turn errors before pause.
   * `0` = unlimited (default). Written to review.errors.max_before_pause.
   */
  maxErrorsBeforePause?: number;
  /** executing_only (default) | project */
  reviewScope?: "executing_only" | "project";
  /** Also write docs/autopilot/quickstart.md (default true for fresh init). */
  writeQuickstart?: boolean;
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
  /**
   * Cursor stop-hook auto-followup cap. Default is 5 when omitted.
   * Autopilot stop must use `null` (unlimited) so fix+confirm chains
   * longer than 5 loops are not silently skipped.
   */
  loop_limit?: number | null;
  timeout?: number;
  description?: string;
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
