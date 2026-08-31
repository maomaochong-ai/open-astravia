import { ipcMain } from "electron";
import { AGENT_CONFIGURATION_CHANNELS as CHANNELS } from "../../shared/agent-configuration.js";
import { getAgentConfigurationController } from "../agent-configuration/composition.js";

export function registerAgentConfigurationIpc(): () => void {
	const controller = getAgentConfigurationController();
	ipcMain.handle(CHANNELS.LIST, () => controller.listTemplates());
	ipcMain.handle(CHANNELS.SAVE, (_event, request: unknown) => controller.saveTemplate(request));
	ipcMain.handle(CHANNELS.DELETE, (_event, id: unknown, revision: unknown) => controller.deleteTemplate(id, revision));
	ipcMain.handle(CHANNELS.READ_SESSION, (_event, id: unknown) => controller.readSession(id));
	ipcMain.handle(CHANNELS.UPDATE_SESSION, (_event, id: unknown, request: unknown) =>
		controller.updateSession(id, request),
	);
	ipcMain.handle(CHANNELS.CATALOG, (_event, id: unknown) => controller.readCatalog(id));
	return () => {
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
