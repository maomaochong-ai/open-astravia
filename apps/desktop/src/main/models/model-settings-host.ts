import { getOrCreateSharedModelRuntime, syncSharedModelRuntimeCredentials } from "../agent-runtime/host-services.js";
import { agentTeamExternalConditionChanges } from "../agent-teams/team-external-condition-channel.js";
import { getAppLogger } from "../logger.js";
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
				syncSharedModelRuntimeCredentials(credentials, readModelsConfigSync().providers);
				getOrCreateSharedModelRuntime().refresh();
			},
			onProviderAccessChanged: (providerIds) => {
				for (const provider of providerIds) {
					agentTeamExternalConditionChanges.publish({ category: "authentication", provider });
				}
			},
		});
		void desktopModelSettingsService.getConfig().catch((error) => {
			modelSettingsLog.warn("迁移模型凭据失败:", error);
		});
	}
	return desktopModelSettingsService;
}
