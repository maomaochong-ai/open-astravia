import type { DesktopTeamSessionSnapshot } from "@preload/api-types/team-conversation-display";
import type {
	AgentTeamDocument,
	TeamSessionListItem,
	TeamSessionReference,
	TeamSessionWorkspaceSelection,
} from "@vetta/agent-team";
import type { SessionExecutionMode } from "@vetta/runtime-core";

const SESSION_STORAGE_PREFIX = "vetta.agent-team.session.";
const pendingSessionCreations = new Map<string, Promise<LoadedTeamChatSession>>();

export interface LoadedTeamChatSession {
	readonly document?: AgentTeamDocument;
	readonly snapshot: DesktopTeamSessionSnapshot;
	readonly sessions: readonly TeamSessionListItem[];
}

export interface TeamChatBootstrap {
	readonly document: AgentTeamDocument;
	readonly sessions: readonly TeamSessionListItem[];
}

export interface CreateReservedTeamChatSessionOptions {
	readonly teamId: string;
	readonly sessionId: string;
	readonly executionMode: SessionExecutionMode;
	readonly document?: AgentTeamDocument;
	readonly workspace?: TeamSessionWorkspaceSelection;
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

export async function createReservedTeamChatSession({
	teamId,
	sessionId,
	executionMode,
	document,
	workspace,
}: CreateReservedTeamChatSessionOptions): Promise<LoadedTeamChatSession> {
	const snapshot = await window.vetta.agentTeams.createSessionRecord(teamId, {
		sessionId,
		executionMode,
		...(workspace ? { workspace } : {}),
	});
	if (snapshot.session.id !== sessionId) throw new Error("Reserved Team session identity changed");
	const storageKey = `${SESSION_STORAGE_PREFIX}${teamId}`;
	window.localStorage.setItem(storageKey, JSON.stringify(toReference(snapshot)));
	return {
		...(document ? { document } : {}),
		snapshot,
		sessions: withTeamChatSnapshot([], snapshot),
	};
}

async function createTeamChatSessionInternal(
	teamId: string,
	document?: AgentTeamDocument,
	knownSessions: readonly TeamSessionListItem[] = [],
): Promise<LoadedTeamChatSession> {
	if (document && !document.teams.some((team) => team.id === teamId)) {
		throw new Error(`Agent team not found: ${teamId}`);
	}
	const createSessionRecord = window.vetta.agentTeams.createSessionRecord ?? window.vetta.agentTeams.createSession;
	const snapshot = await createSessionRecord(teamId);
	const storageKey = `${SESSION_STORAGE_PREFIX}${teamId}`;
	window.localStorage.setItem(storageKey, JSON.stringify(toReference(snapshot)));
	return { ...(document ? { document } : {}), snapshot, sessions: withTeamChatSnapshot(knownSessions, snapshot) };
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
	return { document, snapshot, sessions: withTeamChatSnapshot(sessions, snapshot) };
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

export function withTeamChatSnapshot(
	sessions: readonly TeamSessionListItem[],
	snapshot: DesktopTeamSessionSnapshot,
): readonly TeamSessionListItem[] {
	const existing = sessions.find((session) => session.id === snapshot.session.id);
	const coordinationSessionPath =
		snapshot.session.coordinationRuntime?.sessionPath ?? existing?.coordinationSessionPath;
	if (!coordinationSessionPath) return sessions;
	const snapshotItem: TeamSessionListItem = {
		id: snapshot.session.id,
		coordinationSessionPath,
		title: snapshot.session.title ?? "",
		createdAt: snapshot.session.createdAt,
		updatedAt: snapshot.session.updatedAt,
	};
	const item =
		existing &&
		(existing.updatedAt > snapshotItem.updatedAt ||
			(existing.updatedAt === snapshotItem.updatedAt && existing.title && !snapshotItem.title))
			? existing
			: snapshotItem;
	return [item, ...sessions.filter((session) => session.id !== item.id)].sort(
		(left, right) => right.updatedAt - left.updatedAt,
	);
}

export function mergeTeamChatBootstrapSessions(
	bootstrap: readonly TeamSessionListItem[],
	current: readonly TeamSessionListItem[],
	activeSessionId: string | undefined,
): readonly TeamSessionListItem[] {
	if (!activeSessionId) return bootstrap;
	const currentActive = current.find((session) => session.id === activeSessionId);
	if (!currentActive) return bootstrap;
	const bootstrapActive = bootstrap.find((session) => session.id === activeSessionId);
	if (
		bootstrapActive &&
		(bootstrapActive.updatedAt > currentActive.updatedAt ||
			(bootstrapActive.updatedAt === currentActive.updatedAt && (bootstrapActive.title || !currentActive.title)))
	) {
		return bootstrap;
	}
	return [currentActive, ...bootstrap.filter((session) => session.id !== activeSessionId)].sort(
		(left, right) => right.updatedAt - left.updatedAt,
	);
}
