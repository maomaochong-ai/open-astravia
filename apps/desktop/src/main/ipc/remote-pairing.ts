import { BrowserWindow, ipcMain } from "electron";
import type { DesktopRemoteAccessManager } from "../remote-control/desktop-remote-access-manager.js";

const CHANNELS = {
	GET_STATE: "vetta:remote-pairing:get-state",
	CREATE_INVITE: "vetta:remote-pairing:create-invite",
	CANCEL_INVITE: "vetta:remote-pairing:cancel-invite",
	SET_CLOUD_ENABLED: "vetta:remote-pairing:set-cloud-enabled",
	APPROVE: "vetta:remote-pairing:approve",
	REVOKE_DEVICE: "vetta:remote-pairing:revoke-device",
	RENAME_DEVICE: "vetta:remote-pairing:rename-device",
} as const;

/** Pushed to every window whenever the pairing state changes. */
const STATE_CHANGED = "vetta:remote-pairing:state-changed";

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function registerRemotePairingIpc(manager: DesktopRemoteAccessManager): () => void {
	ipcMain.handle(CHANNELS.GET_STATE, () => manager.getState());
	ipcMain.handle(CHANNELS.CREATE_INVITE, () => manager.createInvite());
	ipcMain.handle(CHANNELS.CANCEL_INVITE, () => manager.cancelInvite());
	ipcMain.handle(CHANNELS.SET_CLOUD_ENABLED, (_event, enabled: unknown) => manager.setCloudEnabled(enabled === true));
	ipcMain.handle(CHANNELS.APPROVE, (_event, id: unknown, allow: unknown) =>
		manager.approvePairing(asString(id), allow === true),
	);
	ipcMain.handle(CHANNELS.REVOKE_DEVICE, (_event, id: unknown) => manager.revokeDevice(asString(id)));
	ipcMain.handle(CHANNELS.RENAME_DEVICE, (_event, id: unknown, name: unknown) =>
		manager.renameDevice(asString(id), asString(name)),
	);
	const stopPushing = manager.onStateChanged((state) => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(STATE_CHANGED, state);
		}
	});
	return () => {
		stopPushing();
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
