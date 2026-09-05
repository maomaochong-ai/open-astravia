import {
	type AgentTeamDocument,
	type AgentTeamExtensionRegistry,
	DEFAULT_AGENT_TEAM_EXTENSIONS,
} from "@vetta/agent-team";
import { createAgentTeamFileRepository } from "./agent-team-file-repository.js";

export interface AgentTeamConfigRepository {
	read(): Promise<AgentTeamDocument>;
	write(document: AgentTeamDocument): Promise<void>;
}

export function createAgentTeamConfigRepository(
	extensions: AgentTeamExtensionRegistry = DEFAULT_AGENT_TEAM_EXTENSIONS,
): AgentTeamConfigRepository {
	return createAgentTeamFileRepository({ extensions });
}
