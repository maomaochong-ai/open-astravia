import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { McpRuntimeToolDescriptor } from "@vetta/runtime-mcp";
import type { AgentPluginRuntimeConfig } from "../model-context/plugin-runtime.js";
import type {
	CodingAgentPromptResourceResolver,
	CodingAgentPromptResourceSource,
} from "../runtime-contracts/prompt-runtime.js";
import { type AgentConfiguration, AgentConfigurationError } from "./configuration-schema.js";
import type { AgentConfigurationResourceCatalog } from "./session-configuration-contract.js";

export function allowsAgentResource(selection: readonly string[] | null, id: string): boolean {
	return selection === null || selection.includes(id);
}

export function selectAgentPlugins(
	config: AgentPluginRuntimeConfig | undefined,
	selection: readonly string[] | null,
): AgentPluginRuntimeConfig | undefined {
	if (!config || selection === null) return config;
	const select = <T extends { readonly pluginId: string }>(items: T[] | undefined) =>
		items?.filter(({ pluginId }) => allowsAgentResource(selection, pluginId));
	return {
		systemPromptContributions: select(config.systemPromptContributions),
		skillPathContributions: select(config.skillPathContributions),
		toolPolicyContributions: select(config.toolPolicyContributions),
		toolContributions: select(config.toolContributions),
		stateContributions: select(config.stateContributions),
		continuationContributions: select(config.continuationContributions),
		systemPromptProviderContributions: select(config.systemPromptProviderContributions),
		mcpServerContributions: select(config.mcpServerContributions),
	};
}

export function readAgentPluginIds(config: AgentPluginRuntimeConfig | undefined): string[] {
	return [
		...new Set(
			Object.values(config ?? {}).flatMap(
				(items) => items?.map((item: { pluginId: string }) => item.pluginId) ?? [],
			),
		),
	].sort();
}

export function selectAgentSkillSource(
	source: CodingAgentPromptResourceSource,
	read: () => AgentConfiguration,
): CodingAgentPromptResourceSource {
	return {
		getAgentsFiles: () => source.getAgentsFiles(),
		getAppendSystemPrompt: () => source.getAppendSystemPrompt(),
		getSystemPrompt: () => source.getSystemPrompt(),
		getSkills: () => {
			const result = source.getSkills();
			const selection = read().skills;
			if (selection === null) return result;
			const skills = result.skills.filter((skill) => allowsAgentResource(selection, skill.name));
			if (selection.some((id) => skills.filter((skill) => skill.name === id).length !== 1))
				throw new AgentConfigurationError("AGENT_CONFIGURATION_RESOURCE_UNAVAILABLE");
			return { ...result, skills };
		},
		refreshContextResourcesIfChanged: (signal) => source.refreshContextResourcesIfChanged(signal),
		refreshSkillsIfChanged: (signal) => source.refreshSkillsIfChanged(signal),
		setRuntimeSkillPaths: (paths, signal) => source.setRuntimeSkillPaths(paths, signal),
	};
}

/** A final intersection, never an activation override that can expand the host surface. */
export function createAgentToolSelection(
	configuration: AgentConfiguration,
	mcpTools: readonly McpRuntimeToolDescriptor[],
): (name: string) => boolean {
	const mcp = new Map(mcpTools.map((tool) => [tool.name, tool.serverName]));
	const selectedTools = configuration.tools === null ? null : new Set(configuration.tools);
	const selectedServers = configuration.mcpServers === null ? null : new Set(configuration.mcpServers);
	return (name) => {
		if (selectedTools !== null && !selectedTools.has(name)) return false;
		if (selectedServers === null || !mcp.has(name)) return true;
		const server = mcp.get(name);
		return server !== undefined && selectedServers.has(server);
	};
}

export function selectAgentPromptResourceResolver(
	delegate: CodingAgentPromptResourceResolver | undefined,
	read: () => AgentConfiguration,
): CodingAgentPromptResourceResolver {
	const resolver: CodingAgentPromptResourceResolver = (text, reference, context) => {
		if (!allowsAgentResource(read().skills, reference.name.trim()))
			throw new AgentConfigurationError("AGENT_CONFIGURATION_RESOURCE_UNAVAILABLE");
		return delegate?.(text, reference, context) ?? { text, promptRef: reference };
	};
	resolver.bindForTurn = async (context) => {
		const configuration = read();
		const bound = (await delegate?.bindForTurn?.(context)) ?? delegate;
		return selectAgentPromptResourceResolver(bound, () => configuration);
	};
	return resolver;
}

export function filterAgentTools(
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
	allows: ((name: string) => boolean) | undefined,
): ReadonlyMap<string, RuntimeToolDefinition> {
	return allows ? new Map([...tools].filter(([name]) => allows(name))) : tools;
}

export function validateAgentResourceSelection(
	configuration: AgentConfiguration,
	catalog: AgentConfigurationResourceCatalog,
): void {
	for (const kind of ["skills", "tools", "mcpServers", "plugins"] as const) {
		const selected = configuration[kind];
		if (selected?.some((id) => !catalog[kind].includes(id)))
			throw new AgentConfigurationError("AGENT_CONFIGURATION_RESOURCE_UNAVAILABLE");
	}
	if (configuration.modelKey !== null && !catalog.models.some(({ key }) => key === configuration.modelKey))
		throw new AgentConfigurationError("AGENT_CONFIGURATION_RESOURCE_UNAVAILABLE");
}
