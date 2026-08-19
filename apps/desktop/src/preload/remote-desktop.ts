import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vettaRemoteDesktop", {
	onInput(message: unknown): void {
		ipcRenderer.send("vetta:remote-desktop:input", message);
	},
});
