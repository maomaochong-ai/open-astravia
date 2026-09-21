import type { IpcRenderer, IpcRendererEvent } from "electron";
import { TERMINAL_CHANNELS, type TerminalEventEnvelope } from "../../shared/terminal-ipc.js";
import type { DesktopApi } from "../api.js";

export function createTerminalApi(ipc: IpcRenderer): Pick<DesktopApi, "terminal"> {
	return {
		terminal: {
			capabilities: () => ipc.invoke(TERMINAL_CHANNELS.CAPABILITIES),
			open: (request) => ipc.invoke(TERMINAL_CHANNELS.OPEN, request),
			write: (terminalId, data) => ipc.invoke(TERMINAL_CHANNELS.WRITE, terminalId, data),
			resize: (terminalId, cols, rows) => ipc.invoke(TERMINAL_CHANNELS.RESIZE, terminalId, cols, rows),
			foregroundProcess: (terminalId) => ipc.invoke(TERMINAL_CHANNELS.FOREGROUND, terminalId),
			close: (terminalId) => ipc.invoke(TERMINAL_CHANNELS.CLOSE, terminalId),
			saveSnapshot: (tabId, text) => ipc.invoke(TERMINAL_CHANNELS.SNAPSHOT_SAVE, tabId, text),
			loadSnapshot: (tabId) => ipc.invoke(TERMINAL_CHANNELS.SNAPSHOT_LOAD, tabId),
			onEvent: (listener) => {
				const handler = (_event: IpcRendererEvent, envelope: TerminalEventEnvelope): void => listener(envelope);
				ipc.on(TERMINAL_CHANNELS.EVENT, handler);
				return () => ipc.removeListener(TERMINAL_CHANNELS.EVENT, handler);
			},
		},
	};
}
