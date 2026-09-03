import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { MessagePort } from "node:worker_threads";
import { CompositeRuntimeSessionCatalog, CompositeRuntimeSessionFileHistoryReader } from "@vetta/runtime-core";
import { createDesktopHistoricalSessionFormat, DesktopRuntimeSessionCatalog } from "@vetta/runtime-desktop";
import type { RuntimeConversationSessionRoot } from "@vetta/runtime-node/conversation";
import { FileConversationRuntimeSessionFileHistoryReader } from "@vetta/runtime-node/conversation";
import { UNAVAILABLE_RUNTIME_SESSION_ACCESS } from "../../shared/session-access.js";
import type { DesktopSessionSearchEvent } from "../../shared/session-search.js";
import { agentTeamConversationOwnershipRecords } from "../agent-teams/team-ownership-backfill.js";
import { listLegacyTeamSessionDocuments } from "../agent-teams/team-session-legacy-source.js";
import { ConversationOwnershipCatalog, conversationOwnershipPathKey } from "./conversation-ownership-catalog.js";
import { SessionSearchService } from "./session-search-service.js";
import type { SessionSearchWorkerRequest } from "./session-search-worker-protocol.js";

export function startSessionSearchWorker(port: Pick<MessagePort, "on" | "postMessage">): void {
	let roots: RuntimeConversationSessionRoot[] = [];
	const historical = createDesktopHistoricalSessionFormat();
	const catalog = new CompositeRuntimeSessionCatalog(
		[historical.sessionCatalog, new DesktopRuntimeSessionCatalog({ resolveRoots: () => roots })],
		resolve,
	);
	const reader = new CompositeRuntimeSessionFileHistoryReader([
		historical.sessionFileHistoryReader,
		new FileConversationRuntimeSessionFileHistoryReader(),
	]);
	const ownership = new ConversationOwnershipCatalog();
	const legacyOwnedPaths = listLegacyTeamSessionDocuments().then(
		(sessions) =>
			new Set(
				sessions
					.flatMap(agentTeamConversationOwnershipRecords)
					.map((record) => conversationOwnershipPathKey(record.sessionPath)),
			),
	);
	const search = new SessionSearchService({
		listSessions: async (source) => {
			const legacyOwned = await legacyOwnedPaths;
			const sessions = (
				await ownership.filterUserSessions(await catalog.listSessions(source.cwd, source.sessionDir))
			).filter((session) => !legacyOwned.has(conversationOwnershipPathKey(session.path)));
			return sessions.map((session) => ({
				...session,
				firstMessage: session.firstMessage.slice(0, 200),
				lastMessagePreview: undefined,
				access: UNAVAILABLE_RUNTIME_SESSION_ACCESS,
			}));
		},
		readHistory: (path) => reader.read(path),
		readFingerprint: async (path) => {
			const info = await stat(path);
			return `${info.mtimeMs}:${info.size}`;
		},
	});
	const controllers = new Map<string, AbortController>();
	const emit = (event: DesktopSessionSearchEvent) => port.postMessage(event);
	port.on("message", (message: SessionSearchWorkerRequest) => {
		if (message.type === "invalidate") {
			search.invalidate();
			return;
		}
		if (message.type === "cancel") {
			controllers.get(message.requestId)?.abort();
			return;
		}
		roots = message.roots;
		const { requestId } = message;
		const controller = new AbortController();
		controllers.set(requestId, controller);
		void search
			.searchStream(
				message.request,
				message.sources,
				(result) => emit({ requestId, results: [result], done: false }),
				controller.signal,
			)
			.then((summary) => {
				if (!controller.signal.aborted) emit({ requestId, done: true, ...summary });
			})
			.catch(() => {
				if (!controller.signal.aborted) emit({ requestId, done: true, error: "search-failed" });
			})
			.finally(() => controllers.delete(requestId));
	});
}
