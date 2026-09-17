import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";

const agentSettingsEmptyInputType = Type.Object({}, { additionalProperties: false });

const agentExperimentalSettingsType = Type.Object(
	{
		vettaCli: Type.Boolean(),
		promptPrediction: Type.Boolean(),
		agentSkills: Type.Boolean(),
	},
	{ additionalProperties: false },
);

const agentExperimentalSettingsUpdateType = Type.Object(
	{
		vettaCli: Type.Optional(Type.Boolean()),
		promptPrediction: Type.Optional(Type.Boolean()),
		agentSkills: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false, minProperties: 1 },
);

const imageGenerationSettingsType = Type.Object(
	{
		textToImageProviderId: Type.Optional(Type.String({ minLength: 1, maxLength: 129 })),
		textToImageModelId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
		imageToImageProviderId: Type.Optional(Type.String({ minLength: 1, maxLength: 129 })),
		imageToImageModelId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
	},
	{ additionalProperties: false },
);

const imageGenerationSettingsUpdateType = Type.Object(
	{
		textToImageProviderId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 129 }), Type.Null()])),
		textToImageModelId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()])),
		imageToImageProviderId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 129 }), Type.Null()])),
		imageToImageModelId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()])),
	},
	{ additionalProperties: false, minProperties: 1 },
);

export type AgentExperimentalSettings = Readonly<Static<typeof agentExperimentalSettingsType>>;
export type AgentExperimentalSettingsUpdate = Readonly<Static<typeof agentExperimentalSettingsUpdateType>>;
export type ImageGenerationSettings = Readonly<Static<typeof imageGenerationSettingsType>>;
export type ImageGenerationSettingsUpdate = Readonly<Static<typeof imageGenerationSettingsUpdateType>>;

const agentSettingsEmptyInputSchema = defineCapabilityInputSchema(agentSettingsEmptyInputType);
const agentExperimentalSettingsSchema = defineCapabilityOutputSchema(agentExperimentalSettingsType, { clean: true });
const agentExperimentalSettingsUpdateSchema = defineCapabilityInputSchema(agentExperimentalSettingsUpdateType);

export const DOMAIN_AGENT_SETTINGS_CAPABILITIES = {
	GET_EXPERIMENTAL: defineCapability<Record<string, never>, AgentExperimentalSettings>({
		id: "cap.domain.vetta.agent-settings.experimental.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: agentSettingsEmptyInputSchema,
		output: agentExperimentalSettingsSchema,
	}),
	SET_EXPERIMENTAL: defineCapability<AgentExperimentalSettingsUpdate, AgentExperimentalSettings>({
		id: "cap.domain.vetta.agent-settings.experimental.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: agentExperimentalSettingsUpdateSchema,
		output: agentExperimentalSettingsSchema,
	}),
	GET_IMAGE_GENERATION: defineCapability<Record<string, never>, ImageGenerationSettings>({
		id: "cap.domain.vetta.agent-settings.image-generation.get",
		kind: "query",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: agentSettingsEmptyInputSchema,
		output: defineCapabilityOutputSchema(imageGenerationSettingsType, { clean: true }),
	}),
	SET_IMAGE_GENERATION: defineCapability<ImageGenerationSettingsUpdate, ImageGenerationSettings>({
		id: "cap.domain.vetta.agent-settings.image-generation.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: defineCapabilityInputSchema(imageGenerationSettingsUpdateType),
		output: defineCapabilityOutputSchema(imageGenerationSettingsType, { clean: true }),
	}),
} as const;

export const DOMAIN_AGENT_SETTINGS_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(DOMAIN_AGENT_SETTINGS_CAPABILITIES),
);
