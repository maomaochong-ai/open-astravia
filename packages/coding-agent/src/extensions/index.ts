/** Stable contracts exposed to Coding Agent extensions and their hosts. */

export * from "./contracts.js";
export * from "./runtime/index.js";
export {
	bindExtensionRuntimeActions,
	type ExtensionExecutionHost,
} from "./runtime-bindings.js";
