import type { AgentBlueprint, AgentTeamDocument } from "@vetta/agent-team";
import { type AgentCapabilityOption, buildAgentCapabilityOptions } from "../lib/capability-options";

export interface AgentTeamConfigurationResources {
	readonly document: AgentTeamDocument;
	readonly blueprints: readonly AgentBlueprint[];
	readonly capabilities: readonly AgentCapabilityOption[];
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
		capabilities: buildAgentCapabilityOptions({ skills, skillManifest, mcpConfig, plugins }),
	};
}
