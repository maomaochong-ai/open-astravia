import { readAgentSettingsDocument, updateAgentSettingsDocument } from "../agent-settings/settings-document-store.js";
import { getAppLogger } from "../logger.js";
import {
	getPluginSettings,
	listPlugins,
	pluginAgentContributionService,
	setPluginSettings,
} from "../plugins/plugin-catalog.js";
import { publishPluginSettingsChanged } from "../plugins/plugin-settings-events.js";
import { DesktopRuntimeConfigurationService } from "./runtime-configuration-service.js";

let desktopRuntimeConfigurationService: DesktopRuntimeConfigurationService | undefined;

/** Desktop 进程唯一装配点；领域存储通过 Adapter 注入 Runtime Core 配置控制面。 */
export function getDesktopRuntimeConfigurationService(): DesktopRuntimeConfigurationService {
	desktopRuntimeConfigurationService ??= new DesktopRuntimeConfigurationService({
		readAgentSettings: readAgentSettingsDocument,
		updateAgentSettings: updateAgentSettingsDocument,
		listPlugins,
		getPluginSettings,
		setPluginSettings,
		publishPluginSettingsChanged,
		readConfiguredTools: () => pluginAgentContributionService.readConfiguredToolSummary(),
		logger: getAppLogger("runtime-configuration"),
	});
	return desktopRuntimeConfigurationService;
}
