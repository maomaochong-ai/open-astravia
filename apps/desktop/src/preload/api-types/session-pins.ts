import type { SessionPinsSnapshot } from "../../shared/session-pins.js";

export interface DesktopSessionPinsApi {
	list: () => Promise<SessionPinsSnapshot>;
	set: (input: { path: string; pinned: boolean }) => Promise<SessionPinsSnapshot>;
	forget: (paths: readonly string[]) => Promise<SessionPinsSnapshot>;
	/** Hands over pins an older version kept in the renderer's localStorage. */
	importLegacy: (snapshot: SessionPinsSnapshot) => Promise<SessionPinsSnapshot>;
	onChanged: (listener: (snapshot: SessionPinsSnapshot) => void) => () => void;
}
