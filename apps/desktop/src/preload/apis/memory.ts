import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";

const MEMORY_CHANNELS = {
	READ: "astravia:memory:read",
	WRITE: "astravia:memory:write",
} as const;

export function createMemoryApi(ipc: IpcRenderer): Pick<DesktopApi, "memory"> {
	return {
		memory: {
			read: (params) => ipc.invoke(MEMORY_CHANNELS.READ, params),
			write: (params) => ipc.invoke(MEMORY_CHANNELS.WRITE, params),
		},
	};
}
