import { ipcMain } from "electron";
import { PLUGIN_MEDIA_CHANNELS } from "../../shared/plugin-ipc.js";
import { createPluginMediaProviderHost } from "../plugins/plugin-media-provider-production.js";

export function registerPluginMediaProvidersIpc(): () => void {
	const host = createPluginMediaProviderHost();
	ipcMain.handle(PLUGIN_MEDIA_CHANNELS.REGISTER, (event, pluginId: unknown, registration: unknown) =>
		host.register(event.sender, pluginId, registration),
	);
	ipcMain.handle(
		PLUGIN_MEDIA_CHANNELS.UNREGISTER,
		(event, pluginId: unknown, providerId: unknown, activationId: unknown) =>
			host.unregister(event.sender, pluginId, providerId, activationId),
	);
	ipcMain.handle(PLUGIN_MEDIA_CHANNELS.RESPONSE, (event, requestId: unknown, result: unknown) =>
		host.respond(event.sender, requestId, result),
	);
	ipcMain.handle(PLUGIN_MEDIA_CHANNELS.UPLOAD_INPUT, (event, requestId: unknown, inputId: unknown, request: unknown) =>
		host.uploadInput(event.sender, requestId, inputId, request),
	);

	return () => {
		for (const channel of Object.values(PLUGIN_MEDIA_CHANNELS)) {
			if (channel !== PLUGIN_MEDIA_CHANNELS.REQUEST && channel !== PLUGIN_MEDIA_CHANNELS.CHANGED) {
				ipcMain.removeHandler(channel);
			}
		}
		host.dispose();
	};
}
