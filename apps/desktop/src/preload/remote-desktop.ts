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
	onControlSend(callback: (message: string) => void): () => void {
		const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
		ipcRenderer.on("vetta:remote-desktop:control-send", listener);
		return () => ipcRenderer.removeListener("vetta:remote-desktop:control-send", listener);
	},
});
