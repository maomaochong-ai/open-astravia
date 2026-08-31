import { resolve } from "node:path";
import type { HistoryEntry, SessionExecutionMode } from "@vetta/runtime-core";
import type { DesktopSessionHistoryInfo } from "../../shared/session-access.js";
import type {
	DesktopSessionSearchRequest,
	DesktopSessionSearchResult,
	DesktopSessionSearchSource,
} from "../../shared/session-search.js";
import {
	compareSearchSessions,
	MAX_SESSION_SEARCH_RESULTS,
	mergeSessionSearchResults,
} from "../../shared/session-search-results.js";
import { createSearchSnippet } from "../../shared/session-search-text.js";
import type { SessionSearchMessage } from "./session-search-text.js";
import { extractSearchMessages, matchSearchMessage, normalizeSearchText } from "./session-search-text.js";

export interface SessionSearchSource extends DesktopSessionSearchSource {
	readonly sessionDir?: string;
	readonly sessions?: readonly DesktopSessionHistoryInfo[];
	readonly executionModeByPath?: ReadonlyMap<string, SessionExecutionMode>;
}

export interface SessionSearchServiceDependencies {
	readonly listSessions: (source: SessionSearchSource) => Promise<readonly DesktopSessionHistoryInfo[]>;
	readonly readHistory: (path: string) => { history: HistoryEntry[] };
	readonly readFingerprint: (path: string) => Promise<string>;
	readonly now?: () => number;
	readonly maxCacheCharacters?: number;
	readonly yieldToEventLoop?: () => Promise<void>;
}

interface CachedMessages {
	fingerprint: string;
	messages: SessionSearchMessage[];
	characters: number;
}

/** Runs in the search worker. Only searchable message text is retained, never full history or tool payloads. */
export class SessionSearchService {
	private readonly messages = new Map<string, CachedMessages>();
	private readonly catalogs = new Map<string, { at: number; sessions: readonly DesktopSessionHistoryInfo[] }>();
	private cachedCharacters = 0;
	private catalogRevision = 0;
	private readonly now: () => number;
	private readonly yieldToEventLoop: () => Promise<void>;

	constructor(private readonly dependencies: SessionSearchServiceDependencies) {
		this.now = dependencies.now ?? Date.now;
		this.yieldToEventLoop = dependencies.yieldToEventLoop ?? (() => new Promise((done) => setImmediate(done)));
	}

	invalidate(): void {
		this.catalogRevision += 1;
		this.catalogs.clear();
	}

	async searchStream(
		request: DesktopSessionSearchRequest,
		sources: readonly SessionSearchSource[],
		onResult: (result: DesktopSessionSearchResult) => void,
		signal: AbortSignal,
	): Promise<{ limited: boolean; skipped: number }> {
		const query = normalizeSearchText(request.query);
		const limit = Math.min(
			MAX_SESSION_SEARCH_RESULTS,
			Math.max(1, Math.floor(request.limit ?? MAX_SESSION_SEARCH_RESULTS)),
		);
		let newest: DesktopSessionSearchResult[] = [];
		let skipped = 0;
		if (!query) return { limited: false, skipped };
		const seen = new Set<string>();
		const candidates: { session: DesktopSessionHistoryInfo; source: SessionSearchSource }[] = [];
		const canEnterResults = (session: DesktopSessionHistoryInfo) =>
			newest.length < limit || compareSearchSessions(session, newest[newest.length - 1].session) < 0;
		const emit = (
			session: DesktopSessionHistoryInfo,
			source: SessionSearchSource,
			match: DesktopSessionSearchResult["match"],
		) => {
			signal.throwIfAborted();
			if (!canEnterResults(session)) return;
			const result: DesktopSessionSearchResult = {
				session,
				sourceCwd: source.cwd,
				sourceKind: source.kind,
				sourceName: source.name,
				executionMode: source.executionModeByPath?.get(resolve(session.path)),
				match,
			};
			newest = mergeSessionSearchResults(newest, [result], limit);
			onResult(result);
		};
		// Send title hits before parsing message bodies. Later sources need not finish before a hit is visible.
		for (const source of sources) {
			signal.throwIfAborted();
			if (request.sourceKind && source.kind !== request.sourceKind) continue;
			if (request.projectCwd && resolve(source.cwd) !== resolve(request.projectCwd)) continue;
			let sessions: readonly DesktopSessionHistoryInfo[];
			try {
				const revision = this.catalogRevision;
				const key = `${source.cwd}\0${source.sessionDir ?? ""}`;
				const cached = this.catalogs.get(key);
				sessions =
					source.sessions ??
					(cached && this.now() - cached.at < 1_000
						? cached.sessions
						: await this.dependencies.listSessions(source));
				signal.throwIfAborted();
				if (!source.sessions && revision === this.catalogRevision && sessions.length <= 10_000) {
					this.catalogs.delete(key);
					this.catalogs.set(key, { at: this.now(), sessions });
					let count = [...this.catalogs.values()].reduce((sum, entry) => sum + entry.sessions.length, 0);
					while (count > 10_000 || this.catalogs.size > 64) {
						const oldest = this.catalogs.entries().next().value;
						if (!oldest) break;
						count -= oldest[1].sessions.length;
						this.catalogs.delete(oldest[0]);
					}
				}
			} catch (error) {
				if (signal.aborted) throw error;
				skipped += 1;
				continue;
			}
			for (const session of [...sessions].sort(compareSearchSessions)) {
				const path = resolve(session.path);
				if (seen.has(path)) continue;
				seen.add(path);
				if (seen.size % 32 === 0) {
					await this.yieldToEventLoop();
					signal.throwIfAborted();
				}
				if (
					(request.modifiedFrom !== undefined && !(session.modifiedAt >= request.modifiedFrom)) ||
					(request.modifiedBefore !== undefined && !(session.modifiedAt < request.modifiedBefore))
				)
					continue;
				const title = session.name?.trim() ?? "";
				if (normalizeSearchText(title).includes(query)) {
					emit(session, source, { field: "title", snippet: createSearchSnippet(title, query) });
				} else candidates.push({ session, source });
			}
			await this.yieldToEventLoop();
		}
		candidates.sort((a, b) => compareSearchSessions(a.session, b.session));
		for (const { session, source } of candidates) {
			signal.throwIfAborted();
			// Title hits are provisional: a newer body hit must still be able to displace them.
			if (!canEnterResults(session)) break;
			try {
				const messages = await this.readMessages(session.path, signal);
				const match = matchSearchMessage(messages, query);
				if (match) emit(session, source, match);
			} catch (error) {
				if (signal.aborted) throw error;
				skipped += 1;
			}
			await this.yieldToEventLoop();
		}
		signal.throwIfAborted();
		return { limited: newest.length >= limit, skipped };
	}

	private async readMessages(path: string, signal: AbortSignal): Promise<SessionSearchMessage[]> {
		const key = resolve(path);
		const fingerprint = await this.dependencies.readFingerprint(path);
		signal.throwIfAborted();
		const cached = this.messages.get(key);
		if (cached?.fingerprint === fingerprint) {
			this.messages.delete(key);
			this.messages.set(key, cached);
			return cached.messages;
		}
		if (cached) {
			this.cachedCharacters -= cached.characters;
			this.messages.delete(key);
		}
		const messages = extractSearchMessages(this.dependencies.readHistory(path).history);
		const characters = messages.reduce(
			(sum, message) => sum + message.text.length + message.normalizedText.length,
			0,
		);
		const maxCharacters = this.dependencies.maxCacheCharacters ?? 16 * 1024 * 1024;
		if (characters <= maxCharacters) {
			while (this.cachedCharacters + characters > maxCharacters || this.messages.size >= 2_000) {
				const oldest = this.messages.entries().next().value;
				if (!oldest) break;
				this.cachedCharacters -= oldest[1].characters;
				this.messages.delete(oldest[0]);
			}
			this.messages.set(key, { fingerprint, messages, characters });
			this.cachedCharacters += characters;
		}
		return messages;
	}
}
