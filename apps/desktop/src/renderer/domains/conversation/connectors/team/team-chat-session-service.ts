import type { DesktopTeamSessionSnapshot } from "@preload/api-types/team-conversation-display";
import type { AgentTeamDocument, TeamSessionListItem, TeamSessionReference } from "@vetta/agent-team";

const SESSION_STORAGE_PREFIX = "vetta.agent-team.session.";
const pendingSessionCreations = new Map<string, Promise<LoadedTeamChatSession>>();

export interface LoadedTeamChatSession {
	readonly document: AgentTeamDocument;
	readonly snapshot: DesktopTeamSessionSnapshot;
	readonly sessions: readonly TeamSessionListItem[];
}

export interface TeamChatBootstrap {
	readonly document: AgentTeamDocument;
	readonly sessions: readonly TeamSessionListItem[];
}

export async function loadTeamChatBootstrap(teamId: string): Promise<TeamChatBootstrap> {
	const [document, sessions] = await Promise.all([
		window.vetta.agentTeams.list(),
		window.vetta.agentTeams.listSessions(teamId),
	]);
	if (!document.teams.some((team) => team.id === teamId)) {
		throw new Error(`Agent team not found: ${teamId}`);
	}
	return { document, sessions };
}

export async function loadTeamChatSession(teamId: string, preferredSessionId?: string): Promise<LoadedTeamChatSession> {
	const { document, sessions } = await loadTeamChatBootstrap(teamId);
	const storageKey = `${SESSION_STORAGE_PREFIX}${teamId}`;
	const preferred = preferredSessionId ? sessions.find((session) => session.id === preferredSessionId) : undefined;
	if (preferredSessionId && !preferred) throw new Error(`Agent Team session not found: ${preferredSessionId}`);
	const stored = window.localStorage.getItem(storageKey);
	if (preferred) return openTeamChatSession(document, sessions, storageKey, preferred);
	if (stored) {
		try {
			return await openTeamChatSession(document, sessions, storageKey, parseStoredReference(stored));
		} catch {
			window.localStorage.removeItem(storageKey);
		}
	}
	if (sessions[0]) return openTeamChatSession(document, sessions, storageKey, sessions[0]);

	return createTeamChatSession(teamId, document, sessions);
}

export async function createTeamChatSession(
	teamId: string,
	document?: AgentTeamDocument,
	knownSessions: readonly TeamSessionListItem[] = [],
): Promise<LoadedTeamChatSession> {
	const pending = pendingSessionCreations.get(teamId);
	if (pending) return pending;
	const creation = createTeamChatSessionInternal(teamId, document, knownSessions);
	pendingSessionCreations.set(teamId, creation);
	void creation.then(
		() => {
			if (pendingSessionCreations.get(teamId) === creation) pendingSessionCreations.delete(teamId);
		},
		() => {
			if (pendingSessionCreations.get(teamId) === creation) pendingSessionCreations.delete(teamId);
		},
	);
	return creation;
}

async function createTeamChatSessionInternal(
	teamId: string,
	document?: AgentTeamDocument,
	knownSessions: readonly TeamSessionListItem[] = [],
): Promise<LoadedTeamChatSession> {
	const resolvedDocument = document ?? (await window.vetta.agentTeams.list());
	if (!resolvedDocument.teams.some((team) => team.id === teamId)) {
		throw new Error(`Agent team not found: ${teamId}`);
	}
	const snapshot = await window.vetta.agentTeams.createSession(teamId);
	const storageKey = `${SESSION_STORAGE_PREFIX}${teamId}`;
	window.localStorage.setItem(storageKey, JSON.stringify(toReference(snapshot)));
	return { document: resolvedDocument, snapshot, sessions: withSnapshot(knownSessions, snapshot) };
}

function toReference(snapshot: DesktopTeamSessionSnapshot): TeamSessionReference {
	const coordinationSessionPath = snapshot.session.coordinationRuntime?.sessionPath;
	if (!coordinationSessionPath) throw new Error("Team coordination Conversation is unavailable");
	return { id: snapshot.session.id, coordinationSessionPath };
}

async function openTeamChatSession(
	document: AgentTeamDocument,
	sessions: readonly TeamSessionListItem[],
	storageKey: string,
	reference: TeamSessionReference | TeamSessionListItem | string,
): Promise<LoadedTeamChatSession> {
	const ipcReference =
		typeof reference === "string"
			? reference
			: { id: reference.id, coordinationSessionPath: reference.coordinationSessionPath };
	const snapshot = await window.vetta.agentTeams.getSession(ipcReference);
	window.localStorage.setItem(storageKey, JSON.stringify(toReference(snapshot)));
	return { document, snapshot, sessions: withSnapshot(sessions, snapshot) };
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

function withSnapshot(
	sessions: readonly TeamSessionListItem[],
	snapshot: DesktopTeamSessionSnapshot,
): readonly TeamSessionListItem[] {
	const reference = toReference(snapshot);
	const item: TeamSessionListItem = {
		...reference,
		title: snapshot.session.name,
		createdAt: snapshot.session.createdAt,
		updatedAt: snapshot.session.updatedAt,
	};
	return [item, ...sessions.filter((session) => session.id !== item.id)].sort(
		(left, right) => right.updatedAt - left.updatedAt,
	);
}
