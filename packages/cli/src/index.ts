export { CLI_NAME, PREFERRED_NAME } from "./names.js";
export {
  installInitYes,
  mergeHooksJson,
  countAutopilotDuplicates,
  validateHooksShape,
  hasCompleteAutopilotHooks,
  summarizeAutopilotHooks,
} from "./init/install.js";
export type { InitYesOptions, InitResult, HooksFile } from "./init/types.js";
export { PACKAGE_VERSION } from "./init/types.js";
export { formatStatus, runDoctor, readPinVersion } from "./status-doctor.js";
