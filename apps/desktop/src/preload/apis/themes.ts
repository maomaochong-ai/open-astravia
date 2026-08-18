import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import type { DesktopThemeStorageChangedEvent } from "../api-types/themes.js";
import { onIpcEvent } from "./helper.js";

export function createThemesApi(ipc: IpcRenderer): Pick<DesktopApi, "themes"> {
	return {
		themes: {
			list: () => ipc.invoke("vetta:themes:list"),
			storage: {
				getAll: (themeId) => ipc.invoke("vetta:themes:storage:get-all", themeId),
				set: (themeId, key, value) => ipc.invoke("vetta:themes:storage:set", themeId, key, value),
				remove: (themeId, key) => ipc.invoke("vetta:themes:storage:remove", themeId, key),
				clear: (themeId) => ipc.invoke("vetta:themes:storage:clear", themeId),
				onChanged: (handler) =>
					onIpcEvent<DesktopThemeStorageChangedEvent>(ipc, "vetta:themes:storage:changed", handler),
			},
		},
	};
}
