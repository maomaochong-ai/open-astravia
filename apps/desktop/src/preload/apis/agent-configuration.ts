import type { IpcRenderer } from "electron";
import type { DesktopAgentConfigurationApi } from "../../shared/agent-configuration.js";
import { AGENT_CONFIGURATION_CHANNELS as CHANNELS } from "../../shared/agent-configuration.js";

export function createAgentConfigurationApi(ipc: IpcRenderer): { agentConfiguration: DesktopAgentConfigurationApi } {
	return {
		agentConfiguration: {
			listTemplates: () => ipc.invoke(CHANNELS.LIST),
			saveTemplate: (request) => ipc.invoke(CHANNELS.SAVE, request),
			deleteTemplate: (id, revision) => ipc.invoke(CHANNELS.DELETE, id, revision),
			readSession: (id) => ipc.invoke(CHANNELS.READ_SESSION, id),
			updateSession: (id, request) => ipc.invoke(CHANNELS.UPDATE_SESSION, id, request),
			readCatalog: (id) => ipc.invoke(CHANNELS.CATALOG, id),
		},
	};
}
