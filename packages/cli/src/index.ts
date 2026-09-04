export { CLI_NAME, NPM_PACKAGE_NAME, PREFERRED_NAME } from "./names.js";
export {
  installInitYes,
  preflightForceRefresh,
  mergeHooksJson,
  stripAutopilotHooks,
  countAutopilotDuplicates,
  validateHooksShape,
  hasCompleteAutopilotHooks,
  summarizeAutopilotHooks,
  autopilotStopHasUnlimitedLoop,
  autopilotHookCommand,
  mergeClaudeSettings,
  validateClaudeSettingsShape,
  hasClaudeBlockCapZero,
  hasCompleteClaudeAutopilotHooks,
  summarizeClaudeAutopilotHooks,
  stripAutopilotClaudeSettings,
  claudeSettingsContainAutopilot,
  CLAUDE_AUTOPILOT_EVENTS,
  CLAUDE_BLOCK_CAP_ENV,
} from "./init/install.js";
export type { InitYesOptions, InitResult, HooksFile } from "./init/types.js";
export type {
  ClaudeSettingsFile,
  ClaudeMatcherGroup,
  ClaudeHookHandler,
} from "./init/claude-settings-merge.js";
export type { PreflightResult } from "./init/install.js";
export { PACKAGE_VERSION } from "./init/types.js";
export { formatStatus, runDoctor, readPinVersion, readStaleAfterHours, hasGlobalSelfReviewHooks } from "./status-doctor.js";
export type { DoctorOptions, DoctorResult } from "./status-doctor.js";
export { upgradeProject } from "./upgrade.js";
export type { UpgradeOptions, UpgradeResult } from "./upgrade.js";
export { uninstallProject } from "./uninstall.js";
export type {
  UninstallOptions,
  UninstallResult,
} from "./uninstall.js";
export {
  mergeConfigYamlMissingKeys,
  mergeMissingKeys,
  readConfigInstallHints,
  readConfigPlatformsOrThrow,
} from "./init/config-merge.js";
export {
  collectWizardAnswers,
  runInteractiveInit,
} from "./init/tui.js";
export type { InitPrompts, InteractiveInitOptions } from "./init/tui.js";
export {
  probeProject,
  applyPlansGitignore,
  applyAutopilotRuntimeGitignore,
  answersToInstallOptions,
  formatCheatSheet,
  formatHostDisplayName,
  formatHostActivationTips,
  formatPostInstallOutro,
  formatPostInstallFooter,
  installableHostOptions,
  writeQuickstart,
  normalizePlansDir,
  resolveCliCommand,
  tryResolveRunningCliScript,
  autopilotShellAliasLine,
  assertNotSymlink,
  assertRealpathInside,
  assertPairInsideOrUnlinkAll,
  isRealRegularFile,
  isRealDirectory,
  resolveProjectRootOrThrow,
} from "./init/wizard-helpers.js";
export type {
  InitWizardAnswers,
  PlansGitPolicy,
  ShellAliasTarget,
} from "./init/wizard-helpers.js";
export {
  INSTALLABLE_BINDINGS,
  MAX_PLATFORM_BINDINGS,
  applyPlatformsToConfigYaml,
  assertInstallablePlatforms,
  configWantsInstallableHost,
  defaultSurfaceFor,
  formatBindingOptionLabel,
  formatPlatformsDisplay,
  mergePlatformBindings,
  mergedIncludesAllRequested,
  normalizeBinding,
  parsePlatformBindingsFromConfig,
  parsePlatformsCliList,
  primaryBinding,
  sanitizePlatformId,
} from "./init/platforms.js";
export type { PlatformBinding, PlatformSurface } from "./init/platforms.js";
export { setProjectLocale } from "./locale-set.js";
export type {
  LocaleSetOptions,
  LocaleSetResult,
} from "./locale-set.js";
export {
  formatSessionDisplayName,
  formatSessionList,
  purgeProjectSession,
  renameProjectSession,
  resetProjectSessionReview,
  shortSessionId,
} from "./session.js";
export type {
  SessionCmdResult,
  SessionListResult,
} from "./session.js";
