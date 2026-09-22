import type { RemoteSessionSummary } from "@vetta/remote-control";
import type { TranscriptItem } from "./transcript";

export const SESSION_CACHE_LIMIT = 50;

/**
 * Offline copy of what the desktop last told us, keyed by desktop. Sessions are
 * capped at the most recent `SESSION_CACHE_LIMIT`; transcripts of evicted
 * sessions go with them.
 */
export interface SessionCache {
	loadSessions(desktopKey: string): Promise<RemoteSessionSummary[]>;
	saveSessions(desktopKey: string, sessions: readonly RemoteSessionSummary[]): Promise<void>;
	loadTranscript(desktopKey: string, sessionId: string): Promise<readonly TranscriptItem[] | undefined>;
	saveTranscript(desktopKey: string, sessionId: string, items: readonly TranscriptItem[]): Promise<void>;
	clearDesktop(desktopKey: string): Promise<void>;
}

export function keepMostRecent(sessions: readonly RemoteSessionSummary[]): RemoteSessionSummary[] {
	return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SESSION_CACHE_LIMIT);
}

export class MemorySessionCache implements SessionCache {
	private readonly sessions = new Map<string, RemoteSessionSummary[]>();
	private readonly transcripts = new Map<string, Map<string, readonly TranscriptItem[]>>();

	async loadSessions(desktopKey: string): Promise<RemoteSessionSummary[]> {
		return [...(this.sessions.get(desktopKey) ?? [])];
	}

	async saveSessions(desktopKey: string, sessions: readonly RemoteSessionSummary[]): Promise<void> {
		const kept = keepMostRecent(sessions);
		this.sessions.set(desktopKey, kept);
		const keep = new Set(kept.map((session) => session.id));
		const transcripts = this.transcripts.get(desktopKey);
		if (transcripts) for (const id of [...transcripts.keys()]) if (!keep.has(id)) transcripts.delete(id);
	}

	async loadTranscript(desktopKey: string, sessionId: string): Promise<readonly TranscriptItem[] | undefined> {
		return this.transcripts.get(desktopKey)?.get(sessionId);
	}

	async saveTranscript(desktopKey: string, sessionId: string, items: readonly TranscriptItem[]): Promise<void> {
		const known = this.sessions.get(desktopKey)?.some((session) => session.id === sessionId) ?? false;
		if (!known) return;
		const transcripts = this.transcripts.get(desktopKey) ?? new Map<string, readonly TranscriptItem[]>();
		transcripts.set(sessionId, items);
		this.transcripts.set(desktopKey, transcripts);
	}

	async clearDesktop(desktopKey: string): Promise<void> {
		this.sessions.delete(desktopKey);
		this.transcripts.delete(desktopKey);
	}
}
