import { ipcMain, type WebContents } from "electron";
import {
	SESSION_PINS_CHANGED_CHANNEL,
	type SessionPinsSnapshot,
	sessionPinsFromSnapshot,
	toSessionPinsSnapshot,
} from "../../shared/session-pins.js";
import {
	forgetSessionPins,
	importSessionPins,
	listSessionPins,
	onSessionPinsChanged,
	pinSession,
} from "../conversations/session-pins-store.js";

const CHANNELS = {
	LIST: "vetta:session-pins:list",
	SET: "vetta:session-pins:set",
	FORGET: "vetta:session-pins:forget",
	IMPORT: "vetta:session-pins:import",
} as const;

function asPaths(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((path): path is string => typeof path === "string" && path.length > 0)
		: [];
}

export function registerSessionPinsIpc(webContents: WebContents): () => void {
	ipcMain.handle(CHANNELS.LIST, () => toSessionPinsSnapshot(listSessionPins()));

	ipcMain.handle(CHANNELS.SET, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		const path = typeof raw.path === "string" ? raw.path : "";
		if (!path) throw new Error("Invalid session pin path");
		return toSessionPinsSnapshot(pinSession({ path, pinned: raw.pinned === true }));
	});

	ipcMain.handle(CHANNELS.FORGET, (_event, paths: unknown) =>
		toSessionPinsSnapshot(forgetSessionPins(asPaths(paths))),
	);

	ipcMain.handle(CHANNELS.IMPORT, (_event, snapshot: unknown) =>
		toSessionPinsSnapshot(importSessionPins(sessionPinsFromSnapshot(snapshot as SessionPinsSnapshot))),
	);

	const unsubscribe = onSessionPinsChanged((pins) => {
		if (webContents.isDestroyed()) return;
		webContents.send(SESSION_PINS_CHANGED_CHANNEL, toSessionPinsSnapshot(pins));
	});

	return () => {
		unsubscribe();
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
