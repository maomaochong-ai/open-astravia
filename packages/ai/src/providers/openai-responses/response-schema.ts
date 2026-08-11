import { type TSchema, Type } from "@sinclair/typebox";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { AI_ERROR_CODES, AIError, type Provider } from "../../protocol/index.js";
import { validateWirePayload } from "../../provider-kit/index.js";

const typedObject = Type.Object({ type: Type.String() }, { additionalProperties: true });
const indexedEvent = (type: string, properties: Record<string, TSchema>) =>
	Type.Object(
		{
			type: Type.Literal(type),
			output_index: Type.Optional(Type.Number()),
			...properties,
		},
		{ additionalProperties: true },
	);

const outputItemEventSchema = (type: "response.output_item.added" | "response.output_item.done") =>
	indexedEvent(type, { item: typedObject });

const deltaEventSchema = (type: string) => indexedEvent(type, { delta: Type.String() });

const contentPartEventSchema = Type.Object(
	{
		type: Type.Literal("response.content_part.added"),
		output_index: Type.Optional(Type.Number()),
		part: typedObject,
	},
	{ additionalProperties: true },
);

const functionArgumentsDoneSchema = indexedEvent("response.function_call_arguments.done", {
	arguments: Type.String(),
});

const terminalResponseSchema = (type: "response.completed" | "response.incomplete") =>
	Type.Object(
		{
			type: Type.Literal(type),
			response: Type.Object(
				{
					status: Type.Optional(
						Type.Union([
							Type.Literal("completed"),
							Type.Literal("failed"),
							Type.Literal("in_progress"),
							Type.Literal("cancelled"),
							Type.Literal("queued"),
							Type.Literal("incomplete"),
						]),
					),
					service_tier: Type.Optional(Type.String()),
					usage: Type.Optional(
						Type.Object(
							{
								input_tokens: Type.Optional(Type.Number()),
								output_tokens: Type.Optional(Type.Number()),
								total_tokens: Type.Optional(Type.Number()),
								input_tokens_details: Type.Optional(
									Type.Object({ cached_tokens: Type.Optional(Type.Number()) }, { additionalProperties: true }),
								),
							},
							{ additionalProperties: true },
						),
					),
				},
				{ additionalProperties: true },
			),
		},
		{ additionalProperties: true },
	);

const errorEventSchema = Type.Object(
	{
		type: Type.Literal("error"),
		code: Type.Union([Type.String(), Type.Null()]),
		message: Type.String(),
	},
	{ additionalProperties: true },
);

const failedEventSchema = Type.Object(
	{
		type: Type.Literal("response.failed"),
		response: Type.Object({}, { additionalProperties: true }),
	},
	{ additionalProperties: true },
);

const reasoningItemSchema = Type.Object(
	{
		type: Type.Literal("reasoning"),
		summary: Type.Optional(Type.Array(Type.Object({ text: Type.String() }, { additionalProperties: true }))),
	},
	{ additionalProperties: true },
);

const messageItemSchema = Type.Object(
	{
		type: Type.Literal("message"),
		id: Type.String(),
		content: Type.Array(typedObject),
	},
	{ additionalProperties: true },
);

const functionCallItemSchema = Type.Object(
	{
		type: Type.Literal("function_call"),
		id: Type.String(),
		call_id: Type.String(),
		name: Type.String(),
		arguments: Type.String(),
	},
	{ additionalProperties: true },
);

const outputTextPartSchema = Type.Object(
	{ type: Type.Literal("output_text"), text: Type.String() },
	{ additionalProperties: true },
);
const refusalPartSchema = Type.Object(
	{ type: Type.Literal("refusal"), refusal: Type.String() },
	{ additionalProperties: true },
);

export function validateResponsesStreamEvent(value: unknown, provider: Provider): ResponseStreamEvent {
	const event = validateWirePayload(typedObject, value, {
		provider,
		payloadType: "OpenAI Responses stream event",
	});

	switch (event.type) {
		case "response.output_item.added":
		case "response.output_item.done": {
			const validated = validateWirePayload(outputItemEventSchema(event.type), value, {
				provider,
				payloadType: event.type,
			});
			validateOutputItem((validated as typeof validated & { readonly item: unknown }).item, provider, event.type);
			break;
		}
		case "response.reasoning_summary_part.added":
		case "response.reasoning_summary_part.done":
			validateWirePayload(indexedEvent(event.type, { part: typedObject }), value, {
				provider,
				payloadType: event.type,
			});
			break;
		case "response.reasoning_summary_text.delta":
		case "response.output_text.delta":
		case "response.refusal.delta":
		case "response.function_call_arguments.delta":
			validateWirePayload(deltaEventSchema(event.type), value, { provider, payloadType: event.type });
			break;
		case "response.content_part.added": {
			const validated = validateWirePayload(contentPartEventSchema, value, {
				provider,
				payloadType: event.type,
			});
			validateContentPart(validated.part, provider, event.type);
			break;
		}
		case "response.function_call_arguments.done":
			validateWirePayload(functionArgumentsDoneSchema, value, { provider, payloadType: event.type });
			break;
		case "response.completed":
		case "response.incomplete":
			validateWirePayload(terminalResponseSchema(event.type), value, { provider, payloadType: event.type });
			break;
		case "error":
			validateWirePayload(errorEventSchema, value, { provider, payloadType: event.type });
			break;
		case "response.failed":
			validateWirePayload(failedEventSchema, value, { provider, payloadType: event.type });
			break;
	}

	return value as ResponseStreamEvent;
}

export function createResponsesJsonParseError(provider: Provider, cause: unknown): AIError {
	return new AIError(AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED, "OpenAI Responses stream JSON is malformed", {
		provider,
		cause,
		metadata: { payloadType: "OpenAI Responses stream event" },
	});
}

function validateOutputItem(value: unknown, provider: Provider, payloadType: string): void {
	const item = validateWirePayload(typedObject, value, { provider, payloadType });
	switch (item.type) {
		case "reasoning":
			validateWirePayload(reasoningItemSchema, value, { provider, payloadType });
			break;
		case "message": {
			const message = validateWirePayload(messageItemSchema, value, { provider, payloadType });
			for (const part of message.content) validateContentPart(part, provider, payloadType);
			break;
		}
		case "function_call":
			validateWirePayload(functionCallItemSchema, value, { provider, payloadType });
			break;
	}
}

function validateContentPart(value: unknown, provider: Provider, payloadType: string): void {
	const part = validateWirePayload(typedObject, value, { provider, payloadType });
	if (part.type === "output_text") {
		validateWirePayload(outputTextPartSchema, value, { provider, payloadType });
	} else if (part.type === "refusal") {
		validateWirePayload(refusalPartSchema, value, { provider, payloadType });
	}
}
