import type { AgentTeamDocument, TeamSessionDocument } from "@vetta/agent-team";

const SESSION_STORAGE_PREFIX = "vetta.agent-team.session.";

export interface LoadedTeamChatSession {
	readonly document: AgentTeamDocument;
	readonly session: TeamSessionDocument;
}

export async function loadTeamChatSession(teamId: string): Promise<LoadedTeamChatSession> {
	const document = await window.vetta.agentTeams.list();
	if (!document.teams.some((team) => team.id === teamId)) {
		throw new Error(`Agent team not found: ${teamId}`);
	}

	const storageKey = `${SESSION_STORAGE_PREFIX}${teamId}`;
	const storedId = window.localStorage.getItem(storageKey);
	if (storedId) {
		try {
			return { document, session: await window.vetta.agentTeams.getSession(storedId) };
		} catch {
			window.localStorage.removeItem(storageKey);
		}
	}

	const config = await window.vetta.config.get();
	const cwd = config.defaultConversationCwd ?? config.workspacePath;
	const session = await window.vetta.agentTeams.createSession(teamId, cwd);
	window.localStorage.setItem(storageKey, session.id);
	return { document, session };
}
