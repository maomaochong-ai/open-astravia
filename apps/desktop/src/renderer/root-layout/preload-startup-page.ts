import { loadChatPage, loadNewSessionPage } from "../route-page-loaders";
import { readLastActiveSession } from "../shared/store/last-active-session-storage";

/** Prefetch code only; the existing route guard still restores or creates sessions. */
export async function preloadStartupPage(hash: string): Promise<void> {
	try {
		const path = hash.replace(/^#/, "").split("?")[0] || "/";
		if (path === "/") {
			await (readLastActiveSession() ? loadChatPage() : loadNewSessionPage());
		} else if (path === "/new-session" || path.startsWith("/new-session/")) {
			await loadNewSessionPage();
		}
	} catch {
		// Prefetch must not prevent boot. Retryable page loaders handle later navigation.
	}
}
