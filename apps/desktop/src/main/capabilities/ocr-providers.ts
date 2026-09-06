import { BrowserWindow } from "electron";
import { PLUGIN_OCR_CHANNELS } from "../../shared/plugin-ipc.js";
import { readAgentSettingsDocument } from "../agent-settings/settings-document-store.js";
import { OcrProviderRegistry } from "../ocr/ocr-provider-registry.js";
import { OcrService } from "../ocr/ocr-service.js";
import { createPpOcrV5Provider } from "../ocr/ppocrv5-provider.js";

let desktopOcrRegistry: OcrProviderRegistry | undefined;
let desktopOcrService: OcrService | undefined;

export function registerDesktopOcrProviders(): { dispose(): void } {
	if (desktopOcrRegistry) throw new Error("Desktop OCR providers are already registered");
	const registry = new OcrProviderRegistry();
	desktopOcrRegistry = registry;
	desktopOcrService = new OcrService({
		registry,
		readConfiguration: () => readAgentSettingsDocument().ocr,
	});
	const providerRegistration = registry.registerProvider(createPpOcrV5Provider());
	const changeRegistration = registry.onProvidersChanged(() => {
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send(PLUGIN_OCR_CHANNELS.CHANGED);
		}
	});
	return {
		dispose: () => {
			changeRegistration.dispose();
			providerRegistration.dispose();
			registry.dispose();
			if (desktopOcrRegistry === registry) desktopOcrRegistry = undefined;
			desktopOcrService = undefined;
		},
	};
}

export function getDesktopOcrService(): OcrService {
	if (!desktopOcrService) throw new Error("Desktop OCR service is not initialized");
	return desktopOcrService;
}

export function getDesktopOcrProviderRegistry(): OcrProviderRegistry {
	if (!desktopOcrRegistry) throw new Error("Desktop OCR providers are not initialized");
	return desktopOcrRegistry;
}
