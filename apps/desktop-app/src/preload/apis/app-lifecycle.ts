import type { IpcRenderer } from "electron";
import {
	APP_LIFECYCLE_RENDERER_BOOT_PAINTED_CHANNEL,
	APP_LIFECYCLE_RENDERER_CONTENT_PAINTED_CHANNEL,
	APP_LIFECYCLE_WHEN_READY_CHANNEL,
} from "../../shared/app-lifecycle-ipc.js";
import type { DesktopApi } from "../api.js";

export function createAppLifecycleApi(ipcRenderer: IpcRenderer): Pick<DesktopApi, "appLifecycle"> {
	return {
		appLifecycle: {
			reportRendererBootPainted: () => {
				ipcRenderer.send(APP_LIFECYCLE_RENDERER_BOOT_PAINTED_CHANNEL);
			},
			reportRendererContentPainted: () => {
				ipcRenderer.send(APP_LIFECYCLE_RENDERER_CONTENT_PAINTED_CHANNEL);
			},
			whenReady: () => ipcRenderer.invoke(APP_LIFECYCLE_WHEN_READY_CHANNEL),
		},
	};
}
