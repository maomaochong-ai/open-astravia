import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";

const modelEmptyInputType = Type.Object({}, { additionalProperties: false });

const modelStringMapType = Type.Record(Type.String(), Type.String());

const modelSummaryType = Type.Object(
	{
		id: Type.String(),
		name: Type.Optional(Type.String()),
		api: Type.Optional(Type.String()),
		reasoning: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);

const modelProviderSummaryType = Type.Object(
	{
		id: Type.String(),
		displayName: Type.String(),
		baseUrl: Type.Optional(Type.String()),
		api: Type.Optional(Type.String()),
		hasApiKey: Type.Boolean(),
		modelCount: Type.Number(),
		models: Type.Array(modelSummaryType),
	},
	{ additionalProperties: false },
);

const modelListResultType = Type.Object(
	{
		defaultModel: Type.Union([Type.String(), Type.Null()]),
		providers: Type.Array(modelProviderSummaryType),
	},
	{ additionalProperties: false },
);

const modelCostType = Type.Object(
	{
		input: Type.Number(),
		output: Type.Number(),
		cacheRead: Type.Number(),
		cacheWrite: Type.Number(),
	},
	{ additionalProperties: false },
);

const modelDefinitionDetailType = Type.Object(
	{
		id: Type.String(),
		modelId: Type.Optional(Type.String()),
		name: Type.Optional(Type.String()),
		api: Type.Optional(Type.String()),
		reasoning: Type.Optional(Type.Boolean()),
		reasoningLevels: Type.Optional(Type.Array(Type.String())),
		defaultReasoningLevel: Type.Optional(Type.String()),
		input: Type.Optional(Type.Array(Type.String())),
		contextWindow: Type.Optional(Type.Number()),
		maxTokens: Type.Optional(Type.Number()),
		cost: Type.Optional(modelCostType),
	},
	{ additionalProperties: false },
);

const modelProviderConfigFields = {
	baseUrl: Type.Optional(Type.String()),
	apiKey: Type.Optional(Type.String()),
	api: Type.Optional(Type.String()),
	displayName: Type.Optional(Type.String()),
	authHeader: Type.Optional(Type.Boolean()),
	headers: Type.Optional(modelStringMapType),
	models: Type.Optional(Type.Array(modelDefinitionDetailType)),
};

const modelProviderConfigSnapshotType = Type.Object(modelProviderConfigFields, { additionalProperties: false });

const modelConfigSnapshotType = Type.Object(
	{
		defaultModel: Type.Optional(Type.String()),
		providers: Type.Record(Type.String(), modelProviderConfigSnapshotType),
	},
	{ additionalProperties: false },
);

const modelProviderInputType = Type.Object(
	{
		provider: Type.String({ pattern: "\\S" }),
	},
	{ additionalProperties: false },
);

const modelProviderDetailType = Type.Object(
	{
		provider: Type.String(),
		...modelProviderConfigFields,
	},
	{ additionalProperties: false },
);

const modelProbeInputType = Type.Object(
	{
		provider: Type.String({ pattern: "\\S" }),
		model: Type.String({ pattern: "\\S" }),
	},
	{ additionalProperties: false },
);

const modelProbeResultType = Type.Object(
	{
		ok: Type.Boolean(),
		message: Type.Optional(Type.String()),
		error: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const modelKeyValidationInputType = Type.Object(
	{
		modelKey: Type.String({ pattern: "\\S" }),
		operation: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

const modelDefaultInputType = Type.Object(
	{
		modelKey: Type.String({ pattern: "\\S" }),
	},
	{ additionalProperties: false },
);

const modelDefaultResultType = Type.Object(
	{
		defaultModel: Type.String(),
	},
	{ additionalProperties: false },
);

const modelProviderUpsertModelType = Type.Object(
	{
		id: Type.String({ pattern: "\\S" }),
		name: Type.Optional(Type.String()),
		api: Type.Optional(Type.String()),
		reasoning: Type.Optional(Type.Boolean()),
		contextWindow: Type.Optional(Type.Number()),
		maxTokens: Type.Optional(Type.Number()),
	},
	{ additionalProperties: false },
);

const modelProviderUpsertDataType = Type.Object(
	{
		baseUrl: Type.Optional(Type.String()),
		apiKey: Type.Optional(Type.String()),
		api: Type.Optional(Type.String()),
		displayName: Type.Optional(Type.String()),
		authHeader: Type.Optional(Type.Boolean()),
		headers: Type.Optional(modelStringMapType),
		models: Type.Optional(Type.Array(modelProviderUpsertModelType)),
	},
	{ additionalProperties: false },
);

const modelProviderUpsertInputType = Type.Object(
	{
		provider: Type.String({ pattern: "\\S" }),
		data: modelProviderUpsertDataType,
	},
	{ additionalProperties: false },
);

export type ModelSummary = Static<typeof modelSummaryType>;
export type ModelProviderSummary = Static<typeof modelProviderSummaryType>;
export type ModelListResult = Static<typeof modelListResultType>;
export type ModelCost = Static<typeof modelCostType>;
export type ModelDefinitionDetail = Static<typeof modelDefinitionDetailType>;
export type ModelProviderConfigSnapshot = Static<typeof modelProviderConfigSnapshotType>;
export type ModelConfigSnapshot = Static<typeof modelConfigSnapshotType>;
export type ModelProviderInput = Static<typeof modelProviderInputType>;
export type ModelProviderDetail = Static<typeof modelProviderDetailType>;
export type ModelProbeInput = Static<typeof modelProbeInputType>;
export type ModelProbeResult = Static<typeof modelProbeResultType>;
export type ModelKeyValidationInput = Static<typeof modelKeyValidationInputType>;
export type ModelDefaultInput = Static<typeof modelDefaultInputType>;
export type ModelDefaultResult = Static<typeof modelDefaultResultType>;
export type ModelProviderUpsertData = Static<typeof modelProviderUpsertDataType>;
export type ModelProviderUpsertInput = Static<typeof modelProviderUpsertInputType>;

const modelEmptyInputSchema = defineCapabilityInputSchema(modelEmptyInputType);
const modelListOutputSchema = defineCapabilityOutputSchema(modelListResultType, { clean: true });
const modelConfigOutputSchema = defineCapabilityOutputSchema(modelConfigSnapshotType, { clean: true });
const modelProviderInputSchema = defineCapabilityInputSchema(modelProviderInputType, { clean: true });
const modelProviderDetailOutputSchema = defineCapabilityOutputSchema(modelProviderDetailType, { clean: true });
const modelProbeInputSchema = defineCapabilityInputSchema(modelProbeInputType, { clean: true });
const modelProbeOutputSchema = defineCapabilityOutputSchema(modelProbeResultType, { clean: true });
const modelKeyValidationInputSchema = defineCapabilityInputSchema(modelKeyValidationInputType, { clean: true });
const modelNoOutputSchema = defineCapabilityNoOutputSchema();
const modelDefaultInputSchema = defineCapabilityInputSchema(modelDefaultInputType, { clean: true });
const modelDefaultOutputSchema = defineCapabilityOutputSchema(modelDefaultResultType, { clean: true });
const modelProviderUpsertInputSchema = defineCapabilityInputSchema(modelProviderUpsertInputType, { clean: true });
const modelProviderConfigOutputSchema = defineCapabilityOutputSchema(modelProviderConfigSnapshotType, { clean: true });

export const DOMAIN_MODEL_CAPABILITIES = {
	LIST: defineCapability<Record<string, never>, ModelListResult>({
		id: "cap.domain.vetta.model.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: modelEmptyInputSchema,
		output: modelListOutputSchema,
	}),
	GET_CONFIG: defineCapability<Record<string, never>, ModelConfigSnapshot>({
		id: "cap.domain.vetta.model.config.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: modelEmptyInputSchema,
		output: modelConfigOutputSchema,
	}),
	GET_PROVIDER: defineCapability<ModelProviderInput, ModelProviderDetail>({
		id: "cap.domain.vetta.model.provider.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: modelProviderInputSchema,
		output: modelProviderDetailOutputSchema,
	}),
	PROBE: defineCapability<ModelProbeInput, ModelProbeResult>({
		id: "cap.domain.vetta.model.probe",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: modelProbeInputSchema,
		output: modelProbeOutputSchema,
	}),
	VALIDATE_KEY: defineCapability<ModelKeyValidationInput, undefined>({
		id: "cap.domain.vetta.model.key.validate",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: modelKeyValidationInputSchema,
		output: modelNoOutputSchema,
	}),
	SET_DEFAULT: defineCapability<ModelDefaultInput, ModelDefaultResult>({
		id: "cap.domain.vetta.model.default.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: modelDefaultInputSchema,
		output: modelDefaultOutputSchema,
	}),
	UPSERT_PROVIDER: defineCapability<ModelProviderUpsertInput, ModelProviderConfigSnapshot>({
		id: "cap.domain.vetta.model.provider.upsert",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: modelProviderUpsertInputSchema,
		output: modelProviderConfigOutputSchema,
	}),
	REMOVE_PROVIDER: defineCapability<ModelProviderInput, undefined>({
		id: "cap.domain.vetta.model.provider.remove",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: modelProviderInputSchema,
		output: modelNoOutputSchema,
	}),
} as const;

export const DOMAIN_MODEL_CAPABILITY_CATALOG = createCapabilityCatalog(Object.values(DOMAIN_MODEL_CAPABILITIES));
