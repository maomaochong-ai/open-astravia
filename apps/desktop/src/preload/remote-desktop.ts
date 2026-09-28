import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vettaRemoteDesktop", {
	onInput(message: unknown): void {
		ipcRenderer.send("vetta:remote-desktop:input", message);
	},
	onControlOpen(): void {
		ipcRenderer.send("vetta:remote-desktop:control-open");
	},
	onControlMessage(message: string): void {
		ipcRenderer.send("vetta:remote-desktop:control-message", message);
	},
	onControlClose(reason?: string): void {
		ipcRenderer.send("vetta:remote-desktop:control-close", reason);
	},
	onScreen(callback: (request: { id: number; active: boolean }) => void): () => void {
		const listener = (_event: Electron.IpcRendererEvent, request: { id: number; active: boolean }) =>
			callback(request);
		ipcRenderer.on("vetta:remote-desktop:screen", listener);
		return () => ipcRenderer.removeListener("vetta:remote-desktop:screen", listener);
	},
	screenReady(): void {
		ipcRenderer.send("vetta:remote-desktop:screen-ready");
	},
	screenResult(id: number, streaming: boolean): void {
		ipcRenderer.send("vetta:remote-desktop:screen-result", id, streaming);
	},
	onControlSend(callback: (message: string) => void): () => void {
		const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
		ipcRenderer.on("vetta:remote-desktop:control-send", listener);
		return () => ipcRenderer.removeListener("vetta:remote-desktop:control-send", listener);
	},
});
