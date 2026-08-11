import { type TProperties, Type } from "@sinclair/typebox";

const objectWithType = (type: string, fields: TProperties = {}) =>
	Type.Object({ type: Type.Literal(type), ...fields }, { additionalProperties: true });

const protocolIndex = Type.Integer({ minimum: 0 });
const usage = Type.Object(
	{
		output_tokens: Type.Number(),
		input_tokens: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
		cache_read_input_tokens: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
		cache_creation_input_tokens: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	},
	{ additionalProperties: true },
);
const contentBlock = Type.Union([
	objectWithType("text", { text: Type.String() }),
	objectWithType("thinking", { thinking: Type.String(), signature: Type.String() }),
	objectWithType("redacted_thinking", { data: Type.String() }),
	objectWithType("tool_use", { id: Type.String(), name: Type.String(), input: Type.Unknown() }),
	objectWithType("server_tool_use"),
	objectWithType("web_search_tool_result"),
]);
const contentDelta = Type.Union([
	objectWithType("text_delta", { text: Type.String() }),
	objectWithType("thinking_delta", { thinking: Type.String() }),
	objectWithType("signature_delta", { signature: Type.String() }),
	objectWithType("input_json_delta", { partial_json: Type.String() }),
	objectWithType("citations_delta", { citation: Type.Unknown() }),
]);

export const anthropicStreamEventSchema = Type.Union([
	objectWithType("message_start", {
		message: Type.Object({ usage }, { additionalProperties: true }),
	}),
	objectWithType("content_block_start", {
		index: protocolIndex,
		content_block: contentBlock,
	}),
	objectWithType("content_block_delta", {
		index: protocolIndex,
		delta: contentDelta,
	}),
	objectWithType("content_block_stop", { index: protocolIndex }),
	objectWithType("message_delta", {
		delta: Type.Object(
			{
				stop_reason: Type.Union([
					Type.Literal("end_turn"),
					Type.Literal("max_tokens"),
					Type.Literal("stop_sequence"),
					Type.Literal("tool_use"),
					Type.Literal("pause_turn"),
					Type.Literal("refusal"),
					Type.Null(),
				]),
			},
			{ additionalProperties: true },
		),
		usage,
	}),
	objectWithType("message_stop"),
]);
