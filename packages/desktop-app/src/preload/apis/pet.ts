import type { IpcRenderer, IpcRendererEvent } from "electron";
import type { PetConfig } from "../../shared/pet-config.js";
import { PET_CONFIG_CHANGED_CHANNEL } from "../../shared/pet-ipc.js";
import type { DesktopApi } from "../api.js";

const CHANNELS = {
	GET_CONFIG: "vetta:pet:get-config",
	SET_CONFIG: "vetta:pet:set-config",
	SHOW: "vetta:pet:show",
	HIDE: "vetta:pet:hide",
	SET_ACTION: "vetta:pet:set-action",
	GET_DECORATIONS: "vetta:pet:get-decorations",
	GET_BUBBLE_STYLE_ASSETS: "vetta:pet:get-bubble-style-assets",
} as const;

export function createPetApi(ipc: IpcRenderer): Pick<DesktopApi, "pet"> {
	return {
		pet: {
			getConfig: () => ipc.invoke(CHANNELS.GET_CONFIG),
			setConfig: (patch) => ipc.invoke(CHANNELS.SET_CONFIG, patch),
			onConfigChanged: (listener) => {
				const handler = (_event: IpcRendererEvent, config: PetConfig): void => listener(config);
				ipc.on(PET_CONFIG_CHANGED_CHANNEL, handler);
				return () => ipc.removeListener(PET_CONFIG_CHANGED_CHANNEL, handler);
			},
			show: () => ipc.invoke(CHANNELS.SHOW),
			hide: () => ipc.invoke(CHANNELS.HIDE),
			setAction: (actionId) => ipc.invoke(CHANNELS.SET_ACTION, actionId),
			getDecorations: () => ipc.invoke(CHANNELS.GET_DECORATIONS),
			getBubbleStyleAssets: () => ipc.invoke(CHANNELS.GET_BUBBLE_STYLE_ASSETS),
		},
	};
}
