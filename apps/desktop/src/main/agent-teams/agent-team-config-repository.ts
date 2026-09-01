import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import {
	type AgentTeamDocument,
	type AgentTeamExtensionRegistry,
	DEFAULT_AGENT_TEAM_EXTENSIONS,
	normalizeAgentTeamDocument,
} from "@vetta/agent-team";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import { createVersionedJsonConfigStore } from "@vetta/toolkit/config-store";
import { getAppLogger } from "../logger.js";

const CONFIG_PATH = join(getVettaHomePath(), "desktop-app", "agent-teams.json");
const log = getAppLogger("agent-team-config");

export interface AgentTeamConfigRepository {
	read(): Promise<AgentTeamDocument>;
	write(document: AgentTeamDocument): Promise<void>;
}

export function createAgentTeamConfigRepository(
	extensions: AgentTeamExtensionRegistry = DEFAULT_AGENT_TEAM_EXTENSIONS,
): AgentTeamConfigRepository {
	return createVersionedJsonConfigStore({
		path: CONFIG_PATH,
		name: "agent-teams",
		readErrorPolicy: "throw",
		normalize: (value) => normalizeAgentTeamDocument(value, extensions),
		writeJson: atomicWriteJSONAsync,
		logger: log,
	});
}
