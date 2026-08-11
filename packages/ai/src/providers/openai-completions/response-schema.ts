import { Type } from "@sinclair/typebox";

const finishReasonSchema = Type.Union([
	Type.Literal("stop"),
	Type.Literal("length"),
	Type.Literal("function_call"),
	Type.Literal("tool_calls"),
	Type.Literal("content_filter"),
	Type.Null(),
]);

export const openAIChatCompletionChunkSchema = Type.Object(
	{
		choices: Type.Array(
			Type.Object(
				{
					index: Type.Number(),
					delta: Type.Record(Type.String(), Type.Unknown()),
					finish_reason: finishReasonSchema,
				},
				{ additionalProperties: true },
			),
		),
		usage: Type.Optional(Type.Unknown()),
	},
	{ additionalProperties: true },
);
