import { type AiCompleteResult, type AiModelListResult, DOMAIN_AI_CAPABILITIES } from "../../../domain.js";
import { PLUGIN_CAPABILITY_PERMISSIONS, type PluginCapabilitySessionAccess } from "../types.js";

export const pluginAiMethods = {
	listAiModels(this: PluginCapabilitySessionAccess, sessionId: string): Promise<AiModelListResult> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.AI_MODELS_LIST }).invoke(
			DOMAIN_AI_CAPABILITIES.LIST_MODELS,
			{},
		);
	},

	completeAi(this: PluginCapabilitySessionAccess, sessionId: string, input: unknown): Promise<AiCompleteResult> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.AI_COMPLETE }).invoke(
			DOMAIN_AI_CAPABILITIES.COMPLETE,
			DOMAIN_AI_CAPABILITIES.COMPLETE.parseInput(input),
		);
	},
};

export type PluginAiMethods = typeof pluginAiMethods;
