import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { RPC_FAILURE_CODES } from "./rpc-failure.js";

const RpcStartupFailureBaseSchema = {
	id: Type.Optional(Type.String()),
	type: Type.Literal("response"),
	command: Type.Literal("startup"),
	success: Type.Literal(false),
	error: Type.String(),
};

const RpcConversationOwnershipFailureSchema = Type.Object(
	{
		...RpcStartupFailureBaseSchema,
		errorCode: Type.Literal(RPC_FAILURE_CODES.SESSION_LOCKED),
		phase: Type.Literal("startup"),
		recoverability: Type.Literal("user_action"),
		lockHolder: Type.Optional(
			Type.Object({
				pid: Type.Number(),
				hostname: Type.String(),
				openedAt: Type.String(),
			}),
		),
	},
	{ additionalProperties: false },
);

const RpcExtensionIncompatibilityFailureSchema = Type.Object(
	{
		...RpcStartupFailureBaseSchema,
		errorCode: Type.Literal(RPC_FAILURE_CODES.EXTENSION_INCOMPATIBLE),
		phase: Type.Literal("startup"),
		recoverability: Type.Literal("user_action"),
		unsupportedEvents: Type.Array(Type.String()),
		unmetRuntimeCapabilities: Type.Array(Type.String()),
	},
	{ additionalProperties: false },
);

const RpcSessionIncompatibilityFailureSchema = Type.Object(
	{
		...RpcStartupFailureBaseSchema,
		errorCode: Type.Union([
			Type.Literal(RPC_FAILURE_CODES.SESSION_CORRUPT),
			Type.Literal(RPC_FAILURE_CODES.SESSION_INCOMPATIBLE),
			Type.Literal(RPC_FAILURE_CODES.SESSION_VERSION_UNSUPPORTED),
		]),
		phase: Type.Literal("startup"),
		recoverability: Type.Literal("user_action"),
		sessionPath: Type.String(),
		sourceVersion: Type.Optional(Type.Integer({ minimum: 1 })),
		issueCode: Type.Optional(Type.String()),
		issueCount: Type.Optional(Type.Integer({ minimum: 1 })),
	},
	{ additionalProperties: false },
);

/** Startup failures emitted before an RPC session can accept commands. */
export const RpcStartupFailureSchema = Type.Union([
	RpcConversationOwnershipFailureSchema,
	RpcExtensionIncompatibilityFailureSchema,
	RpcSessionIncompatibilityFailureSchema,
]);

export type RpcStartupFailure = Static<typeof RpcStartupFailureSchema>;
export type RpcExtensionIncompatibilityFailure = Static<typeof RpcExtensionIncompatibilityFailureSchema>;
export type RpcSessionIncompatibilityFailure = Static<typeof RpcSessionIncompatibilityFailureSchema>;

export function isRpcStartupFailure(value: unknown): value is RpcStartupFailure {
	return Value.Check(RpcStartupFailureSchema, value);
}

export function stringifyRpcStartupFailure(frame: RpcStartupFailure): string {
	if (!isRpcStartupFailure(frame)) throw new Error("Invalid RPC startup failure frame");
	return `${JSON.stringify(frame)}\n`;
}
