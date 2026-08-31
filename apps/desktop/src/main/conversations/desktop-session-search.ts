import type { WebContents } from "electron";
import { SESSION_SEARCH_CHANNELS } from "../../shared/session-search.js";
import { getSharedRuntime } from "../runtime.js";
import { onConversationListChanged } from "./conversation-list-events.js";
import { resolveDesktopRuntimeSessionRoots } from "./session-catalog-roots.js";
import { SessionSearchController } from "./session-search-controller.js";
import { listDesktopSessionSearchSources } from "./session-search-sources.js";
import { SessionSearchWorkerClient } from "./session-search-worker-client.js";

const worker = new SessionSearchWorkerClient();
onConversationListChanged(() => worker.invalidate());

export const desktopSessionSearch = new SessionSearchController({
	send: (owner, event) => (owner as WebContents).send(SESSION_SEARCH_CHANNELS.event, event),
	run: async (requestId, request, emit, signal) => {
		const sources = await listDesktopSessionSearchSources();
		signal.throwIfAborted();
		emit({ requestId, sources: sources.map(({ cwd, kind, name }) => ({ cwd, kind, name })), done: !request.query });
		if (!request.query) return;
		await new Promise<void>((done, reject) => {
			let chain = Promise.resolve();
			const cancel = worker.start(
				{ type: "start", requestId, request, sources, roots: resolveDesktopRuntimeSessionRoots() },
				(event) => {
					// Access checks are owned by the live Runtime, and must finish before the terminal event.
					chain = chain
						.then(async () => {
							if (signal.aborted) return;
							const results = [];
							for (const result of event.results ?? []) {
								const access = await getSharedRuntime().resolveSessionAccess(result.session.path);
								if (access?.readHistory) results.push({ ...result, session: { ...result.session, access } });
							}
							if (!signal.aborted) emit({ ...event, results });
							if (event.done) {
								signal.removeEventListener("abort", abort);
								done();
							}
						})
						.catch((error: unknown) => {
							cancel();
							signal.removeEventListener("abort", abort);
							reject(error);
						});
				},
			);
			const abort = () => {
				cancel();
				done();
			};
			signal.addEventListener("abort", abort, { once: true });
		});
	},
});
