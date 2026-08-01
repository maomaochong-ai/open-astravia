import { getAppLogger } from "../logger.js";
import { getOrCreateSharedModelRegistry } from "../runtime.js";
import { getDesktopModelCredentialStore } from "./model-credential-store.js";
import {
	ModelSettingsService,
	readModelsConfig,
	readModelsConfigSync,
	writeModelsConfig,
} from "./model-settings-service.js";

let desktopModelSettingsService: ModelSettingsService | undefined;
const modelSettingsLog = getAppLogger("model-settings");

export function getDesktopModelSettingsService(): ModelSettingsService {
	const credentials = getDesktopModelCredentialStore();
	if (!desktopModelSettingsService) {
		desktopModelSettingsService = new ModelSettingsService({
			readConfig: readModelsConfig,
			writeConfig: writeModelsConfig,
			credentials,
			refreshRegistry: async () => {
				const registry = getOrCreateSharedModelRegistry();
				credentials.syncToAuthStorage(registry.authStorage, readModelsConfigSync().providers);
				await registry.refresh();
			},
		});
		void desktopModelSettingsService.getConfig().catch((error) => {
			modelSettingsLog.warn("迁移模型凭据失败:", error);
		});
	}
	return desktopModelSettingsService;
}
