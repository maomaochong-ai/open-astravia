import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import type { DesktopThemeStorageChangedEvent } from "../api-types/themes.js";
import { onIpcEvent } from "./helper.js";

export function createThemesApi(ipc: IpcRenderer): Pick<DesktopApi, "themes"> {
	return {
		themes: {
			list: () => ipc.invoke("astravia:themes:list"),
			storage: {
				getAll: (themeId) => ipc.invoke("astravia:themes:storage:get-all", themeId),
				set: (themeId, key, value) => ipc.invoke("astravia:themes:storage:set", themeId, key, value),
				remove: (themeId, key) => ipc.invoke("astravia:themes:storage:remove", themeId, key),
				clear: (themeId) => ipc.invoke("astravia:themes:storage:clear", themeId),
				onChanged: (handler) =>
					onIpcEvent<DesktopThemeStorageChangedEvent>(ipc, "astravia:themes:storage:changed", handler),
			},
		},
	};
}
