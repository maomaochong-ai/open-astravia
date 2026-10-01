import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";

const CHANNELS = {
	EXPORT: "astravia:project:export",
	IMPORT: "astravia:project:import",
	READ_META: "astravia:project:read-meta",
	LIST: "astravia:projects:list",
	CREATE: "astravia:projects:create",
	OPEN: "astravia:projects:open",
	RENAME: "astravia:projects:rename",
	ARCHIVE: "astravia:projects:archive",
	UNARCHIVE: "astravia:projects:unarchive",
	REMOVE: "astravia:projects:remove",
} as const;

export function createProjectApi(ipc: IpcRenderer): Pick<DesktopApi, "project"> {
	return {
		project: {
			export: (projectDir) => ipc.invoke(CHANNELS.EXPORT, projectDir),
			import: () => ipc.invoke(CHANNELS.IMPORT),
			readMeta: (projectDir) => ipc.invoke(CHANNELS.READ_META, projectDir),
			list: () => ipc.invoke(CHANNELS.LIST),
			create: (input) => ipc.invoke(CHANNELS.CREATE, input),
			open: (input) => ipc.invoke(CHANNELS.OPEN, input),
			rename: (input) => ipc.invoke(CHANNELS.RENAME, input),
			archive: (path) => ipc.invoke(CHANNELS.ARCHIVE, path),
			unarchive: (path) => ipc.invoke(CHANNELS.UNARCHIVE, path),
			remove: (path) => ipc.invoke(CHANNELS.REMOVE, path),
		},
	};
}
