import { type TProperties, Type } from "@sinclair/typebox";

const event = (field: string, value: ReturnType<typeof Type.Object>) =>
	Type.Object({ [field]: value }, { additionalProperties: true });
const object = (properties: TProperties = {}) => Type.Object(properties, { additionalProperties: true });
const protocolIndex = Type.Integer({ minimum: 0 });
const exception = object({ message: Type.Optional(Type.String()) });

const contentBlockStart = object({
	contentBlockIndex: protocolIndex,
	start: Type.Union([
		object({ toolUse: object({ toolUseId: Type.String(), name: Type.String() }) }),
		object({ toolResult: Type.Unknown() }),
		object({ image: Type.Unknown() }),
	]),
});
const contentBlockDelta = object({
	contentBlockIndex: protocolIndex,
	delta: Type.Union([
		object({ text: Type.String() }),
		object({ toolUse: object({ input: Type.Optional(Type.String()) }) }),
		object({
			reasoningContent: object({
				text: Type.Optional(Type.String()),
				signature: Type.Optional(Type.String()),
			}),
		}),
		object({ citation: Type.Unknown() }),
		object({ toolResult: Type.Unknown() }),
		object({ image: Type.Unknown() }),
	]),
});

export const bedrockConverseStreamEventSchema = Type.Union([
	event("messageStart", object({ role: Type.String() })),
	event("contentBlockStart", contentBlockStart),
	event("contentBlockDelta", contentBlockDelta),
	event("contentBlockStop", object({ contentBlockIndex: protocolIndex })),
	event("messageStop", object({ stopReason: Type.String() })),
	event(
		"metadata",
		object({
			usage: Type.Optional(
				object({
					inputTokens: Type.Optional(Type.Number()),
					outputTokens: Type.Optional(Type.Number()),
					totalTokens: Type.Optional(Type.Number()),
					cacheReadInputTokens: Type.Optional(Type.Number()),
					cacheWriteInputTokens: Type.Optional(Type.Number()),
				}),
			),
		}),
	),
	event("internalServerException", exception),
	event("modelStreamErrorException", exception),
	event("validationException", exception),
	event("throttlingException", exception),
	event("serviceUnavailableException", exception),
]);
