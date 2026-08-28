/**
 * Stable Node host surface for Runtime Tools composition roots.
 * Internal file layout under host/tool-environment may change; import from
 * `@vetta/coding-agent/host` instead of deep file paths.
 */

export { getCodingAgentOcrExecutionGate } from "../../../tool-policy/ocr-execution-gate.js";
export {
	type CodingAgentEditPathPolicy as RuntimeEditPathPolicy,
	createCodingAgentEditPathPolicy,
} from "../../../tool-policy/path/edit-path-policy.js";
export {
	type CodingAgentWritePathPolicy as RuntimeWritePathPolicy,
	createCodingAgentWritePathPolicy,
} from "../../../tool-policy/path/write-path-policy.js";
export {
	CODING_AGENT_READ_TOOL_OPTIONS,
	type CodingAgentReadToolOptions,
	codingAgentBinaryContentHint,
	isCodingAgentInstructionMarkdown,
} from "../../../tool-policy/read-tool-policy.js";
export { createCodingAgentNodeSessionExecutionEnvironment } from "./node-session-execution-environment.js";
export {
	type CodingAgentNodeToolEnvironmentOptions,
	createCodingAgentNodeToolEnvironment,
} from "./node-tool-environment.js";
