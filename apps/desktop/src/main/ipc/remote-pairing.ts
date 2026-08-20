import { ipcMain } from "electron";
import type { DesktopRemotePairingService } from "../remote-control/desktop-remote-pairing-service.js";

export function registerRemotePairingIpc(service: DesktopRemotePairingService): () => void {
	ipcMain.handle("vetta:remote-pairing:get-state", () => service.getState());
	ipcMain.handle("vetta:remote-pairing:create", async (_event, relayBaseUrl: unknown) =>
		service.create(typeof relayBaseUrl === "string" ? relayBaseUrl : undefined),
	);
	ipcMain.handle("vetta:remote-pairing:set-input-enabled", async (_event, enabled: unknown) =>
		service.setInputEnabled(enabled === true),
	);
	ipcMain.handle("vetta:remote-pairing:revoke", async () => {
		await service.revoke();
		return service.getState();
	});
	return () => {
		ipcMain.removeHandler("vetta:remote-pairing:get-state");
		ipcMain.removeHandler("vetta:remote-pairing:create");
		ipcMain.removeHandler("vetta:remote-pairing:set-input-enabled");
		ipcMain.removeHandler("vetta:remote-pairing:revoke");
	};
}
