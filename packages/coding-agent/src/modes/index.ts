/**
 * Run modes for the coding agent.
 */

export type {
	CodingAgentTurnRetryEvent,
	CodingAgentTurnRetrySettings,
} from "../host/session-execution/contracts.js";
export { CodingAgentSessionTurnRetryController } from "../host/session-execution/turn-retry-controller.js";
export { type PrintModeOptions, runPrintMode } from "./print-mode.js";
export type {
	PrintExtensionError,
	PrintSessionCapabilities,
} from "./print-session-capabilities.js";
export { CodingAgentRpcBashCapability } from "./rpc/rpc-bash-capability.js";
export {
	type ModelInfo,
	RpcClient,
	RpcClientError,
	type RpcClientOptions,
	type RpcEventListener,
	rpcClientErrorFromResponse,
} from "./rpc/rpc-client.js";
export {
	isRpcFailureMetadata,
	RPC_FAILURE_CODES,
	type RpcFailureMetadata,
	RpcFailureMetadataSchema,
	type RpcFailurePhase,
	RpcFailurePhaseSchema,
	type RpcFailureRecoverability,
	RpcFailureRecoverabilitySchema,
} from "./rpc/rpc-failure.js";
export { type RunRpcModeOptions, runRpcModeWithCapabilities } from "./rpc/rpc-mode.js";
export {
	assertRpcSessionCapabilities,
	type ImHostBridge,
	RPC_FULL_SESSION_PROFILE,
	RPC_IM_SESSION_PROFILE,
	type RpcSessionCapabilities,
	type RpcSessionInitialization,
	type RpcSessionProfile,
	type RpcSessionProfileId,
	supportsRpcCommand,
} from "./rpc/rpc-session-capabilities.js";
export {
	computeCodingAgentRpcSessionStats,
	exportCodingAgentRpcConversation,
	readCodingAgentRpcAgentMessages,
	resolveNextCodingAgentRpcThinkingLevel,
} from "./rpc/rpc-session-operations.js";
export {
	isRpcStartupFailure,
	type RpcExtensionIncompatibilityFailure,
	type RpcSessionIncompatibilityFailure,
	type RpcStartupFailure,
	RpcStartupFailureSchema,
	stringifyRpcStartupFailure,
} from "./rpc/rpc-startup-failure.js";
export type {
	RpcBashResult,
	RpcCommand,
	RpcErrorResponse,
	RpcResponse,
	RpcSessionState,
} from "./rpc/rpc-types.js";
