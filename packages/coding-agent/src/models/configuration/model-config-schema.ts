import { type Static, Type } from "@sinclair/typebox";

const RoutingSchema = Type.Object({
	only: Type.Optional(Type.Array(Type.String())),
	order: Type.Optional(Type.Array(Type.String())),
});

const OpenAICompletionsCompatSchema = Type.Object({
	supportsStore: Type.Optional(Type.Boolean()),
	supportsDeveloperRole: Type.Optional(Type.Boolean()),
	supportsReasoningEffort: Type.Optional(Type.Boolean()),
	supportsUsageInStreaming: Type.Optional(Type.Boolean()),
	maxTokensField: Type.Optional(Type.Union([Type.Literal("max_completion_tokens"), Type.Literal("max_tokens")])),
	requiresToolResultName: Type.Optional(Type.Boolean()),
	requiresAssistantAfterToolResult: Type.Optional(Type.Boolean()),
	requiresThinkingAsText: Type.Optional(Type.Boolean()),
	requiresMistralToolIds: Type.Optional(Type.Boolean()),
	thinkingFormat: Type.Optional(
		Type.Union([Type.Literal("openai"), Type.Literal("zai"), Type.Literal("qwen"), Type.Literal("nvidia")]),
	),
	openRouterRouting: Type.Optional(RoutingSchema),
	vercelGatewayRouting: Type.Optional(RoutingSchema),
});

const OpenAICompatSchema = Type.Union([OpenAICompletionsCompatSchema, Type.Object({})]);

export const ModelDefinitionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
	cost: Type.Optional(
		Type.Object({
			input: Type.Number(),
			output: Type.Number(),
			cacheRead: Type.Number(),
			cacheWrite: Type.Number(),
		}),
	),
	contextWindow: Type.Optional(Type.Number()),
	maxTokens: Type.Optional(Type.Number()),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(OpenAICompatSchema),
});

export const ModelOverrideSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
	cost: Type.Optional(
		Type.Object({
			input: Type.Optional(Type.Number()),
			output: Type.Optional(Type.Number()),
			cacheRead: Type.Optional(Type.Number()),
			cacheWrite: Type.Optional(Type.Number()),
		}),
	),
	contextWindow: Type.Optional(Type.Number()),
	maxTokens: Type.Optional(Type.Number()),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(OpenAICompatSchema),
});

export const ProviderModelConfigSchema = Type.Object({
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	apiKey: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(Type.String({ minLength: 1 })),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	authHeader: Type.Optional(Type.Boolean()),
	compat: Type.Optional(OpenAICompatSchema),
	source: Type.Optional(Type.String()),
	templateId: Type.Optional(Type.String()),
	icon: Type.Optional(Type.String()),
	displayName: Type.Optional(Type.String()),
	models: Type.Optional(Type.Array(ModelDefinitionSchema)),
	modelOverrides: Type.Optional(Type.Record(Type.String(), ModelOverrideSchema)),
});

export const ModelsConfigSchema = Type.Object({
	providers: Type.Record(Type.String(), ProviderModelConfigSchema),
});

const RemoteModelDefinitionSchema = Type.Object({
	id: Type.String(),
	modelId: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	upstreamBaseUrl: Type.Optional(Type.String()),
	api: Type.Optional(Type.String()),
	reasoning: Type.Optional(Type.Boolean()),
	input: Type.Optional(Type.Array(Type.String())),
	cost: Type.Optional(
		Type.Object({
			input: Type.Number(),
			output: Type.Number(),
			cacheRead: Type.Number(),
			cacheWrite: Type.Number(),
		}),
	),
	contextWindow: Type.Optional(Type.Number()),
	maxTokens: Type.Optional(Type.Number()),
});

const RemoteProviderConfigSchema = Type.Object({
	api: Type.Optional(Type.String()),
	baseUrl: Type.Optional(Type.String()),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	models: Type.Array(RemoteModelDefinitionSchema),
});

export const RemoteModelsResponseSchema = Type.Object({
	code: Type.Number(),
	data: Type.Object({
		providers: Type.Record(Type.String(), RemoteProviderConfigSchema),
	}),
});

export type ModelOverride = Static<typeof ModelOverrideSchema>;
export type ModelsConfig = Static<typeof ModelsConfigSchema>;
export type RemoteModelsResponse = Static<typeof RemoteModelsResponseSchema>;
