/**
 * Stable host-adapter surface for Runtime Tools composition roots.
 * Internal file layout under adapters/runtime-tools may change; import from
 * `@vetta/coding-agent/host` instead of deep file paths.
 */

export {
	type CodingAgentBackgroundCommandHost,
	createCodingAgentBackgroundCommandHost,
	type RuntimeBackgroundCommandOutput,
	type RuntimeBackgroundCommandOutputStore,
	type RuntimeBackgroundCommandProcess,
	type RuntimeBackgroundCommandProcessOperations,
	type RuntimeSpawnBackgroundCommandProcessOptions,
} from "./background-command-host.js";
export {
	type CodingAgentDocToPdfOperationsOptions,
	createCodingAgentDocToPdfOperations,
} from "./doc-to-pdf-operations.js";
export {
	createCodingAgentEditPathPolicy,
	type RuntimeEditPathPolicy,
} from "./edit-path-policy.js";
export {
	type CodingAgentForegroundCommandHost,
	createCodingAgentForegroundCommandHost,
	type RuntimeForegroundCommandOperations,
} from "./foreground-command-operations.js";
export {
	type CodingAgentNodeToolEnvironmentOptions,
	createCodingAgentNodeToolEnvironment,
} from "./node-tool-environment.js";
export { getCodingAgentOcrExecutionGate } from "./ocr-execution-gate.js";
export {
	createCodingAgentWritePathPolicy,
	type RuntimeWritePathPolicy,
} from "./write-path-policy.js";
