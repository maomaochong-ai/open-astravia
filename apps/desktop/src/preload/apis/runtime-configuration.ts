import type { IpcRenderer } from "electron";
import { RUNTIME_CONFIGURATION_CHANNELS } from "../../shared/runtime-configuration-ipc.js";
import type { DesktopRuntimeConfigurationApi } from "../api-types/runtime-configuration.js";
import { onIpcEvent } from "./helper.js";

export function createRuntimeConfigurationApi(ipc: IpcRenderer): {
	runtimeConfiguration: DesktopRuntimeConfigurationApi;
} {
	return {
		runtimeConfiguration: {
			list: () => ipc.invoke(RUNTIME_CONFIGURATION_CHANNELS.LIST),
			set: (configurationId, patch) => ipc.invoke(RUNTIME_CONFIGURATION_CHANNELS.SET, configurationId, patch),
			onChanged: (handler) => onIpcEvent(ipc, RUNTIME_CONFIGURATION_CHANNELS.CHANGED, handler),
		},
	};
}
