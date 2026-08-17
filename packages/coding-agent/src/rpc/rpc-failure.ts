import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const RPC_FAILURE_CODES = {
	COMMAND_FAILED: "command_failed",
	COMMAND_NOT_SUPPORTED: "command_not_supported",
	CLIENT_NOT_STARTED: "client_not_started",
	EXTENSION_INCOMPATIBLE: "extension_incompatible",
	INVALID_REQUEST: "invalid_request",
	MODEL_NOT_FOUND: "model_not_found",
	PROCESS_EXITED: "process_exited",
	PROCESS_SPAWN_FAILED: "process_spawn_failed",
	REQUEST_TIMEOUT: "request_timeout",
	SESSION_CORRUPT: "session_corrupt",
	SESSION_INCOMPATIBLE: "session_incompatible",
	SESSION_LOCKED: "session_locked",
	SESSION_VERSION_UNSUPPORTED: "session_version_unsupported",
	SHUTDOWN_FAILED: "shutdown_failed",
} as const;

export const RpcFailurePhaseSchema = Type.Union([
	Type.Literal("startup"),
	Type.Literal("command"),
	Type.Literal("turn"),
	Type.Literal("transition"),
	Type.Literal("shutdown"),
]);

export const RpcFailureRecoverabilitySchema = Type.Union([
	Type.Literal("retry_safe"),
	Type.Literal("continue_session"),
	Type.Literal("restart_session"),
	Type.Literal("user_action"),
	Type.Literal("fatal"),
]);

export const RpcFailureMetadataSchema = Type.Object(
	{
		errorCode: Type.String({ minLength: 1 }),
		phase: RpcFailurePhaseSchema,
		recoverability: RpcFailureRecoverabilitySchema,
	},
	{ additionalProperties: false },
);

export type RpcFailurePhase = Static<typeof RpcFailurePhaseSchema>;
export type RpcFailureRecoverability = Static<typeof RpcFailureRecoverabilitySchema>;
export type RpcFailureMetadata = Static<typeof RpcFailureMetadataSchema>;

export function isRpcFailureMetadata(value: unknown): value is RpcFailureMetadata {
	return Value.Check(RpcFailureMetadataSchema, value);
}
