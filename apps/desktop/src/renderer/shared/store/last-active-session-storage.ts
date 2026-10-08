export interface LastActiveSession {
	cwd: string;
	sessionPath: string;
}

export const LAST_ACTIVE_SESSION_STORAGE_KEY = "vetta-last-active-session";

export function readLastActiveSession(): LastActiveSession | null {
	try {
		const raw = localStorage.getItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<LastActiveSession>;
		if (typeof value.cwd !== "string" || !value.cwd || typeof value.sessionPath !== "string" || !value.sessionPath) {
			localStorage.removeItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
			return null;
		}
		return { cwd: value.cwd, sessionPath: value.sessionPath };
	} catch {
		localStorage.removeItem(LAST_ACTIVE_SESSION_STORAGE_KEY);
		return null;
	}
}
