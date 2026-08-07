/**
 * Run modes for the coding agent.
 */

export { type PrintModeOptions, runPrintMode } from "./print-mode.js";
export type {
	PrintExtensionError,
	PrintSessionCapabilities,
} from "./print-session-capabilities.js";
export {
	computeGreenfieldRpcSessionStats,
	exportGreenfieldRpcConversation,
	GreenfieldRpcBashCapability,
	GreenfieldRpcRetryController,
	type GreenfieldRpcRetryEvent,
	type GreenfieldRpcRetrySettings,
	readGreenfieldRpcAgentMessages,
	resolveNextGreenfieldRpcThinkingLevel,
} from "./rpc/greenfield-rpc-capabilities.js";
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
	GREENFIELD_FULL_RPC_PROFILE,
	GREENFIELD_IM_RPC_PROFILE,
	type ImHostBridge,
	type RpcSessionCapabilities,
	type RpcSessionInitialization,
	type RpcSessionProfile,
	type RpcSessionProfileId,
	supportsRpcCommand,
} from "./rpc/rpc-session-capabilities.js";
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
