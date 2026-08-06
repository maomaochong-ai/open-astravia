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

export type AgentExperimentalSettings = Readonly<Static<typeof agentExperimentalSettingsType>>;
export type AgentExperimentalSettingsUpdate = Readonly<Static<typeof agentExperimentalSettingsUpdateType>>;

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
} as const;

export const DOMAIN_AGENT_SETTINGS_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(DOMAIN_AGENT_SETTINGS_CAPABILITIES),
);
