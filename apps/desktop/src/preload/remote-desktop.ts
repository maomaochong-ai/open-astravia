import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("astraviaRemoteDesktop", {
	onInput(message: unknown): void {
		ipcRenderer.send("astravia:remote-desktop:input", message);
	},
	onControlOpen(): void {
		ipcRenderer.send("astravia:remote-desktop:control-open");
	},
	onControlMessage(message: string): void {
		ipcRenderer.send("astravia:remote-desktop:control-message", message);
	},
	onControlClose(reason?: string): void {
		ipcRenderer.send("astravia:remote-desktop:control-close", reason);
	},
	onScreen(callback: (request: { id: number; active: boolean }) => void): () => void {
		const listener = (_event: Electron.IpcRendererEvent, request: { id: number; active: boolean }) =>
			callback(request);
		ipcRenderer.on("astravia:remote-desktop:screen", listener);
		return () => ipcRenderer.removeListener("astravia:remote-desktop:screen", listener);
	},
	screenReady(): void {
		ipcRenderer.send("astravia:remote-desktop:screen-ready");
	},
	screenResult(id: number, streaming: boolean): void {
		ipcRenderer.send("astravia:remote-desktop:screen-result", id, streaming);
	},
	onControlSend(callback: (message: string) => void): () => void {
		const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
		ipcRenderer.on("astravia:remote-desktop:control-send", listener);
		return () => ipcRenderer.removeListener("astravia:remote-desktop:control-send", listener);
	},
});
