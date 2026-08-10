import type { AgentPluginRuntimeConfig } from "../contracts.js";

export function summarizeAgentPlugins(agentPlugins: AgentPluginRuntimeConfig | undefined): Record<string, unknown> {
	return {
		systemPromptPlugins: agentPlugins?.systemPromptContributions?.map((item) => item.pluginId) ?? [],
		skillPlugins: agentPlugins?.skillPathContributions?.map((item) => item.pluginId) ?? [],
		toolPolicyPlugins: agentPlugins?.toolPolicyContributions?.map((item) => item.pluginId) ?? [],
		toolContributions: agentPlugins?.toolContributions?.map((tool) => `${tool.pluginId}:${tool.name}`) ?? [],
		hookContributions:
			agentPlugins?.hookContributions?.map((hook) => `${hook.pluginId}:${hook.id}:${hook.point}`) ?? [],
		continuationContributions:
			agentPlugins?.continuationContributions?.map((provider) => `${provider.pluginId}:${provider.id}`) ?? [],
		systemPromptProviders:
			agentPlugins?.systemPromptProviderContributions?.map((provider) => `${provider.pluginId}:${provider.id}`) ??
			[],
		mcpServers: agentPlugins?.mcpServerContributions?.map((item) => item.runtimeName) ?? [],
	};
}

export function debugPluginAgent(message: string, data?: Record<string, unknown>): void {
	console.info(`[plugin-agent] ${message}`, data ?? {});
}
