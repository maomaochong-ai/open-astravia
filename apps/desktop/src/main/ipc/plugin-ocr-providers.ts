import { ipcMain } from "electron";
import { PLUGIN_OCR_CHANNELS } from "../../shared/plugin-ipc.js";
import { createPluginOcrProviderHost } from "../plugins/plugin-ocr-provider-production.js";

export function registerPluginOcrProvidersIpc(): () => void {
	const host = createPluginOcrProviderHost();
	ipcMain.handle(PLUGIN_OCR_CHANNELS.REGISTER, (event, pluginId, registration) =>
		host.register(event.sender, pluginId, registration),
	);
	ipcMain.handle(PLUGIN_OCR_CHANNELS.UNREGISTER, (_event, pluginId, providerId, activationId) =>
		host.unregister(pluginId, providerId, activationId),
	);
	ipcMain.handle(PLUGIN_OCR_CHANNELS.RESPONSE, (event, requestId, result) =>
		host.respond(event.sender, requestId, result),
	);
	ipcMain.handle(PLUGIN_OCR_CHANNELS.PROGRESS, (event, requestId, progress) =>
		host.progress(event.sender, requestId, progress),
	);
	ipcMain.handle(PLUGIN_OCR_CHANNELS.CANCEL, (event, requestId) => host.cancel(event.sender, requestId));
	ipcMain.handle(PLUGIN_OCR_CHANNELS.GET_INPUT_URL, (event, requestId, inputId) =>
		host.getInputUrl(event.sender, requestId, inputId),
	);
	ipcMain.handle(PLUGIN_OCR_CHANNELS.UPLOAD_INPUT, (event, requestId, inputId, request) =>
		host.uploadInput(event.sender, requestId, inputId, request),
	);
	return () => {
		for (const channel of [
			PLUGIN_OCR_CHANNELS.REGISTER,
			PLUGIN_OCR_CHANNELS.UNREGISTER,
			PLUGIN_OCR_CHANNELS.RESPONSE,
			PLUGIN_OCR_CHANNELS.CANCEL,
			PLUGIN_OCR_CHANNELS.PROGRESS,
			PLUGIN_OCR_CHANNELS.GET_INPUT_URL,
			PLUGIN_OCR_CHANNELS.UPLOAD_INPUT,
		])
			ipcMain.removeHandler(channel);
		host.dispose();
	};
}
