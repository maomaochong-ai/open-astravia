import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";

const aiEmptyInputType = Type.Object({}, { additionalProperties: false });

const aiModelType = Type.Object(
	{
		modelKey: Type.String(),
		provider: Type.String(),
		id: Type.String(),
		name: Type.String(),
		api: Type.String(),
		reasoning: Type.Boolean(),
		input: Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")])),
		contextWindow: Type.Number(),
		maxTokens: Type.Number(),
	},
	{ additionalProperties: false },
);

const aiModelListResultType = Type.Object(
	{
		defaultModel: Type.Union([Type.String(), Type.Null()]),
		models: Type.Array(aiModelType),
	},
	{ additionalProperties: false },
);

const aiCompleteInputType = Type.Object(
	{
		modelKey: Type.Optional(Type.String({ pattern: "\\S" })),
		systemPrompt: Type.Optional(Type.String({ maxLength: 200_000 })),
		prompt: Type.String({ minLength: 1, maxLength: 200_000 }),
		temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
		maxTokens: Type.Optional(Type.Integer({ minimum: 1, maximum: 65_536 })),
		reasoning: Type.Optional(Type.String({ pattern: "\\S", maxLength: 64 })),
	},
	{ additionalProperties: false },
);

const aiUsageType = Type.Object(
	{
		inputTokens: Type.Number(),
		outputTokens: Type.Number(),
		totalTokens: Type.Number(),
	},
	{ additionalProperties: false },
);

const aiCompleteResultType = Type.Object(
	{
		modelKey: Type.String(),
		text: Type.String(),
		stopReason: Type.Union([Type.Literal("stop"), Type.Literal("length")]),
		usage: aiUsageType,
	},
	{ additionalProperties: false },
);

export type AiModel = Static<typeof aiModelType>;
export type AiModelListResult = Static<typeof aiModelListResultType>;
export type AiCompleteInput = Static<typeof aiCompleteInputType>;
export type AiUsage = Static<typeof aiUsageType>;
export type AiCompleteResult = Static<typeof aiCompleteResultType>;

const aiEmptyInputSchema = defineCapabilityInputSchema(aiEmptyInputType);
const aiModelListOutputSchema = defineCapabilityOutputSchema(aiModelListResultType, { clean: true });
const aiCompleteInputSchema = defineCapabilityInputSchema(aiCompleteInputType, { clean: true });
const aiCompleteOutputSchema = defineCapabilityOutputSchema(aiCompleteResultType, { clean: true });

export const DOMAIN_AI_CAPABILITIES = {
	LIST_MODELS: defineCapability<Record<string, never>, AiModelListResult>({
		id: "cap.domain.vetta.ai.models.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: aiEmptyInputSchema,
		output: aiModelListOutputSchema,
	}),
	COMPLETE: defineCapability<AiCompleteInput, AiCompleteResult>({
		id: "cap.domain.vetta.ai.complete",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: aiCompleteInputSchema,
		output: aiCompleteOutputSchema,
	}),
} as const;

export const DOMAIN_AI_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_AI_CAPABILITIES));
