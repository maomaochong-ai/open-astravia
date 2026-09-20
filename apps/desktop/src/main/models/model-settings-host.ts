import { getOrCreateSharedModelRuntime, syncSharedModelRuntimeCredentials } from "../agent-runtime/host-services.js";
import { agentTeamExternalConditionChanges } from "../agent-teams/team-external-condition-channel.js";
import { getAppLogger } from "../logger.js";
import { invalidateProxyProviderRouting } from "../proxy/proxy-host.js";
import { getDesktopModelCredentialStore } from "./model-credential-store.js";
import {
	ModelSettingsService,
	readModelsConfig,
	readModelsConfigSync,
	writeModelsConfig,
} from "./model-settings-service.js";

let desktopModelSettingsService: ModelSettingsService | undefined;
const modelSettingsLog = getAppLogger("model-settings");
const modelSettingsChangedListeners = new Set<(providerIds: readonly string[]) => void>();

export function onDesktopModelSettingsChanged(listener: (providerIds: readonly string[]) => void): () => void {
	modelSettingsChangedListeners.add(listener);
	return () => modelSettingsChangedListeners.delete(listener);
}

export function getDesktopModelSettingsService(): ModelSettingsService {
	const credentials = getDesktopModelCredentialStore();
	if (!desktopModelSettingsService) {
		desktopModelSettingsService = new ModelSettingsService({
			readConfig: readModelsConfig,
			writeConfig: writeModelsConfig,
			credentials,
			refreshRegistry: async () => {
				syncSharedModelRuntimeCredentials(credentials, readModelsConfigSync().providers);
				getOrCreateSharedModelRuntime().refresh();
			},
			onProviderAccessChanged: (providerIds) => {
				for (const provider of providerIds) {
					agentTeamExternalConditionChanges.publish({ category: "authentication", provider });
				}
			},
			onConfigChanged: (providerIds) => {
				// 供应商的代理开关就存在 models.json 里，改完要让代理解析器重读。
				invalidateProxyProviderRouting();
				for (const listener of modelSettingsChangedListeners) listener(providerIds);
			},
		});
		void desktopModelSettingsService.getConfig().catch((error) => {
			modelSettingsLog.warn("迁移模型凭据失败:", error);
		});
	}
	return desktopModelSettingsService;
}
