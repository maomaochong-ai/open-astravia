import type { AgentTeamDocument, TeamSessionReference, TeamSessionSnapshot } from "@vetta/agent-team";

const SESSION_STORAGE_PREFIX = "vetta.agent-team.session.";

export interface LoadedTeamChatSession {
	readonly document: AgentTeamDocument;
	readonly snapshot: TeamSessionSnapshot;
}

export async function loadTeamChatSession(teamId: string): Promise<LoadedTeamChatSession> {
	const document = await window.vetta.agentTeams.list();
	if (!document.teams.some((team) => team.id === teamId)) {
		throw new Error(`Agent team not found: ${teamId}`);
	}

	const storageKey = `${SESSION_STORAGE_PREFIX}${teamId}`;
	const stored = window.localStorage.getItem(storageKey);
	if (stored) {
		try {
			const snapshot = await window.vetta.agentTeams.getSession(parseStoredReference(stored));
			window.localStorage.setItem(storageKey, JSON.stringify(toReference(snapshot)));
			return { document, snapshot };
		} catch {
			window.localStorage.removeItem(storageKey);
		}
	}

	const config = await window.vetta.config.get();
	const cwd = config.defaultConversationCwd ?? config.workspacePath;
	const snapshot = await window.vetta.agentTeams.createSession(teamId, cwd);
	window.localStorage.setItem(storageKey, JSON.stringify(toReference(snapshot)));
	return { document, snapshot };
}

function toReference(snapshot: TeamSessionSnapshot): TeamSessionReference {
	const coordinationSessionPath = snapshot.session.coordinationRuntime?.sessionPath;
	if (!coordinationSessionPath) throw new Error("Team coordination Conversation is unavailable");
	return { id: snapshot.session.id, coordinationSessionPath };
}

function parseStoredReference(value: string): TeamSessionReference | string {
	try {
		const parsed: unknown = JSON.parse(value);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"id" in parsed &&
			typeof parsed.id === "string" &&
			"coordinationSessionPath" in parsed &&
			typeof parsed.coordinationSessionPath === "string"
		) {
			return { id: parsed.id, coordinationSessionPath: parsed.coordinationSessionPath };
		}
	} catch {
		// Previous releases stored only the legacy Team sidecar id.
	}
	return value;
}
