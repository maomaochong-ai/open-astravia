import { type TSchema, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { RpcCommand, RpcExtensionUIResponse, RpcHostResponse } from "./rpc-types.js";

const IdProperty = Type.Optional(Type.String());
const ImagesProperty = Type.Optional(Type.Array(Type.Unknown()));
const QueueModeSchema = Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")]);

function commandSchema<T extends string>(type: T, properties: Record<string, TSchema> = {}) {
	return Type.Object({
		id: IdProperty,
		type: Type.Literal(type),
		...properties,
	});
}

const rpcCommandSchemas = {
	prompt: commandSchema("prompt", {
		message: Type.String(),
		images: ImagesProperty,
		streamingBehavior: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("followUp")])),
	}),
	steer: commandSchema("steer", { message: Type.String(), images: ImagesProperty }),
	follow_up: commandSchema("follow_up", { message: Type.String(), images: ImagesProperty }),
	abort: commandSchema("abort"),
	new_session: commandSchema("new_session", { parentSession: Type.Optional(Type.String()) }),
	get_state: commandSchema("get_state"),
	set_model: commandSchema("set_model", { provider: Type.String(), modelId: Type.String() }),
	cycle_model: commandSchema("cycle_model"),
	get_available_models: commandSchema("get_available_models"),
	set_thinking_level: commandSchema("set_thinking_level", { level: Type.String() }),
	cycle_thinking_level: commandSchema("cycle_thinking_level"),
	set_steering_mode: commandSchema("set_steering_mode", { mode: QueueModeSchema }),
	set_follow_up_mode: commandSchema("set_follow_up_mode", { mode: QueueModeSchema }),
	compact: commandSchema("compact", { customInstructions: Type.Optional(Type.String()) }),
	set_auto_compaction: commandSchema("set_auto_compaction", { enabled: Type.Boolean() }),
	set_auto_retry: commandSchema("set_auto_retry", { enabled: Type.Boolean() }),
	abort_retry: commandSchema("abort_retry"),
	bash: commandSchema("bash", { command: Type.String() }),
	abort_bash: commandSchema("abort_bash"),
	get_session_stats: commandSchema("get_session_stats"),
	export_html: commandSchema("export_html", { outputPath: Type.Optional(Type.String()) }),
	switch_session: commandSchema("switch_session", { sessionPath: Type.String() }),
	fork: commandSchema("fork", { entryId: Type.String() }),
	get_fork_messages: commandSchema("get_fork_messages"),
	get_last_assistant_text: commandSchema("get_last_assistant_text"),
	set_session_name: commandSchema("set_session_name", { name: Type.String() }),
	get_messages: commandSchema("get_messages"),
	get_commands: commandSchema("get_commands"),
	flush_memory: commandSchema("flush_memory"),
} satisfies Record<RpcCommand["type"], TSchema>;

const RpcCommandSchema = Type.Union(Object.values(rpcCommandSchemas));

const RpcExtensionUIResponseSchema = Type.Union([
	Type.Object({ type: Type.Literal("extension_ui_response"), id: Type.String(), value: Type.String() }),
	Type.Object({ type: Type.Literal("extension_ui_response"), id: Type.String(), confirmed: Type.Boolean() }),
	Type.Object({ type: Type.Literal("extension_ui_response"), id: Type.String(), cancelled: Type.Literal(true) }),
]);

const RpcHostResponseSchema = Type.Union([
	Type.Object({
		type: Type.Literal("host_response"),
		id: Type.String(),
		success: Type.Literal(true),
		data: Type.Optional(Type.Object({ messageId: Type.Optional(Type.String()) })),
	}),
	Type.Object({
		type: Type.Literal("host_response"),
		id: Type.String(),
		success: Type.Literal(false),
		error: Type.String(),
		errorCode: Type.Optional(Type.String()),
	}),
]);

const knownCommandTypes = new Set<string>(Object.keys(rpcCommandSchemas));

export type RpcInboundFrame =
	| { readonly kind: "command"; readonly value: RpcCommand }
	| { readonly kind: "extension_ui_response"; readonly value: RpcExtensionUIResponse }
	| { readonly kind: "host_response"; readonly value: RpcHostResponse }
	| { readonly kind: "unknown"; readonly type: string }
	| { readonly kind: "invalid"; readonly message: string };

export function validateRpcInboundFrame(value: unknown): RpcInboundFrame {
	if (Value.Check(RpcCommandSchema, value)) {
		return { kind: "command", value: value as RpcCommand };
	}
	if (Value.Check(RpcExtensionUIResponseSchema, value)) {
		return { kind: "extension_ui_response", value: value as RpcExtensionUIResponse };
	}
	if (Value.Check(RpcHostResponseSchema, value)) {
		return { kind: "host_response", value: value as RpcHostResponse };
	}
	if (isRecord(value) && typeof value.type === "string") {
		if (
			!knownCommandTypes.has(value.type) &&
			value.type !== "extension_ui_response" &&
			value.type !== "host_response"
		) {
			return { kind: "unknown", type: value.type };
		}
	}
	return { kind: "invalid", message: "Invalid RPC frame" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
