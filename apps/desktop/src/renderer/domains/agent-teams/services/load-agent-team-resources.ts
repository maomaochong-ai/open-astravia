import { i18n } from "@shared/i18n";
import type { AgentBlueprint, AgentTeamDocument } from "@vetta/agent-team";
import type { BlueprintDisplayPlugin } from "../lib/blueprint-display";
import { type AgentCapabilityOption, buildAgentCapabilityOptions } from "../lib/capability-options";

export interface AgentTeamConfigurationResources {
	readonly document: AgentTeamDocument;
	readonly blueprints: readonly AgentBlueprint[];
	readonly capabilities: readonly AgentCapabilityOption[];
	/** 解析插件贡献的角色名，以及说明档案为什么暂时不可用。 */
	readonly plugins: readonly BlueprintDisplayPlugin[];
}

export async function loadAgentTeamConfigurationResources(): Promise<AgentTeamConfigurationResources> {
	const [document, blueprints, skills, skillManifest, mcpConfig, plugins] = await Promise.all([
		window.vetta.agentTeams.list(),
		window.vetta.agentTeams.listBlueprints(),
		window.vetta.skills.list(),
		window.vetta.skills.getMarketManifest(),
		window.vetta.mcp.get(),
		window.vetta.plugins.listAll(),
	]);
	return {
		document,
		blueprints,
		plugins: plugins as readonly BlueprintDisplayPlugin[],
		capabilities: buildAgentCapabilityOptions({
			skills,
			skillManifest,
			mcpConfig,
			plugins,
			locale: i18n.language,
		}),
	};
}
