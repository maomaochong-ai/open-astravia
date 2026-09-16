import {
	type AgentExperimentalSettings,
	type AgentExperimentalSettingsUpdate,
	DOMAIN_AGENT_SETTINGS_CAPABILITIES,
	type ImageGenerationSettings,
	type ImageGenerationSettingsUpdate,
} from "@vetta-org/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginAgentSettingsMethods = {
	getAgentExperimental(this: PluginCapabilitySessionAccess, sessionId: string): Promise<AgentExperimentalSettings> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_AGENT_SETTINGS_CAPABILITIES.GET_EXPERIMENTAL, {});
	},

	setAgentExperimental(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		input: unknown,
	): Promise<AgentExperimentalSettings> {
		const parsedInput: AgentExperimentalSettingsUpdate =
			DOMAIN_AGENT_SETTINGS_CAPABILITIES.SET_EXPERIMENTAL.parseInput(input);
		return this.client(sessionId, { official: true }).invoke(
			DOMAIN_AGENT_SETTINGS_CAPABILITIES.SET_EXPERIMENTAL,
			parsedInput,
		);
	},

	getAgentImageGeneration(this: PluginCapabilitySessionAccess, sessionId: string): Promise<ImageGenerationSettings> {
		return this.client(sessionId, { official: true }).invoke(
			DOMAIN_AGENT_SETTINGS_CAPABILITIES.GET_IMAGE_GENERATION,
			{},
		);
	},

	setAgentImageGeneration(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		input: unknown,
	): Promise<ImageGenerationSettings> {
		const parsedInput: ImageGenerationSettingsUpdate =
			DOMAIN_AGENT_SETTINGS_CAPABILITIES.SET_IMAGE_GENERATION.parseInput(input);
		return this.client(sessionId, { official: true }).invoke(
			DOMAIN_AGENT_SETTINGS_CAPABILITIES.SET_IMAGE_GENERATION,
			parsedInput,
		);
	},
};

export type PluginAgentSettingsMethods = typeof pluginAgentSettingsMethods;
