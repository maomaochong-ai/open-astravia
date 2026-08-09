import { type Static, Type } from "@sinclair/typebox";

const object = <T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: true });
const nullable = <
	T extends ReturnType<typeof Type.Object> | ReturnType<typeof Type.Array> | ReturnType<typeof Type.String>,
>(
	schema: T,
) => Type.Union([schema, Type.Null()]);

const functionCallSchema = object({
	id: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	args: Type.Optional(Type.Unknown()),
	partialArgs: Type.Optional(Type.Array(Type.Unknown())),
	willContinue: Type.Optional(Type.Boolean()),
});

const partSchema = object({
	text: Type.Optional(Type.String()),
	thought: Type.Optional(Type.Boolean()),
	thoughtSignature: Type.Optional(Type.String()),
	functionCall: Type.Optional(nullable(functionCallSchema)),
});

export type GeminiPart = Static<typeof partSchema>;

const candidateSchema = object({
	content: Type.Optional(
		nullable(
			object({
				role: Type.Optional(Type.String()),
				parts: Type.Optional(nullable(Type.Array(partSchema))),
			}),
		),
	),
	finishReason: Type.Optional(nullable(Type.String())),
});

const usageSchema = object({
	promptTokenCount: Type.Optional(Type.Number()),
	candidatesTokenCount: Type.Optional(Type.Number()),
	thoughtsTokenCount: Type.Optional(Type.Number()),
	totalTokenCount: Type.Optional(Type.Number()),
	cachedContentTokenCount: Type.Optional(Type.Number()),
});

export const geminiResponseChunkSchema = object({
	candidates: Type.Optional(nullable(Type.Array(candidateSchema))),
	usageMetadata: Type.Optional(nullable(usageSchema)),
	promptFeedback: Type.Optional(Type.Unknown()),
	modelVersion: Type.Optional(Type.String()),
	responseId: Type.Optional(Type.String()),
});

export type GeminiResponseChunk = Static<typeof geminiResponseChunkSchema>;
