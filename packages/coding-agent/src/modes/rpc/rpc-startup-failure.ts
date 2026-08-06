import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

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
		errorCode: Type.Literal("extension_incompatible"),
		unsupportedEvents: Type.Array(Type.String()),
		unmetRuntimeCapabilities: Type.Array(Type.String()),
	},
	{ additionalProperties: false },
);

const RpcSessionIncompatibilityFailureSchema = Type.Object(
	{
		...RpcStartupFailureBaseSchema,
		errorCode: Type.Union([
			Type.Literal("session_corrupt"),
			Type.Literal("session_incompatible"),
			Type.Literal("session_version_unsupported"),
		]),
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
