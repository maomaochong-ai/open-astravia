import type { IpcRenderer } from "electron";
import type { DesktopSessionSearchEvent, DesktopSessionSearchRequest } from "../../shared/session-search.js";
import { SESSION_SEARCH_CHANNELS } from "../../shared/session-search.js";
import { onIpcEvent } from "./helper.js";

export function subscribeSessionSearch(
	ipc: IpcRenderer,
	request: DesktopSessionSearchRequest,
	onEvent: (event: DesktopSessionSearchEvent) => void,
): () => void {
	// Allocate before invoke: results can arrive before its acknowledgement crosses the bridge.
	const requestId = crypto.randomUUID();
	let active = true;
	const unsubscribe = onIpcEvent(ipc, SESSION_SEARCH_CHANNELS.event, (event: DesktopSessionSearchEvent) => {
		if (!active || event.requestId !== requestId) return;
		if (event.done) {
			active = false;
			unsubscribe();
		}
		onEvent(event);
	});
	void ipc.invoke(SESSION_SEARCH_CHANNELS.start, requestId, request).catch(() => {
		if (!active) return;
		active = false;
		unsubscribe();
		onEvent({ requestId, done: true, error: "search-failed" });
	});
	return () => {
		if (!active) return;
		active = false;
		unsubscribe();
		void ipc.invoke(SESSION_SEARCH_CHANNELS.cancel, requestId).catch(() => {});
	};
}
