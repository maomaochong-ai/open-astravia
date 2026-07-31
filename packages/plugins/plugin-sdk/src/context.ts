import type { PluginAgentApi } from "./agent.js";
import type { PluginAppActionsApi } from "./app-actions.js";
import type { PluginCommandApi } from "./command.js";
import type { PluginConversationApi } from "./conversation.js";
import type { Disposable } from "./disposable.js";
import type { PluginFileExplorerApi } from "./file-explorer.js";
import type { PluginFsApi } from "./fs.js";
import type { PluginI18nApi } from "./i18n.js";
import type { PluginNetworkApi } from "./network.js";
import type { PluginOfficialApi } from "./official.js";
import type { PluginPermission } from "./permissions.js";
import type { PluginSettingsApi } from "./settings.js";
import type { PluginStorageApi } from "./storage.js";
import type { PluginUiApi } from "./ui.js";

export interface PluginPermissionApi {
	has(permission: PluginPermission): boolean;
	require(permission: PluginPermission): void;
}

/** 工作模式（agent_mode 轴，见 ADR-0046）。宿主 Work/Coding，未来可能扩展。 */
export type AgentMode = "work" | "coding";

export interface PluginContext {
	plugin: {
		id: string;
		version: string;
	};
	permissions: PluginPermissionApi;
	ui: PluginUiApi;
	fileExplorer: PluginFileExplorerApi;
	conversation: PluginConversationApi;
	agent: PluginAgentApi;
	appActions: PluginAppActionsApi;
	official: PluginOfficialApi;
	fs: PluginFsApi;
	command: PluginCommandApi;
	network: PluginNetworkApi;
	storage: PluginStorageApi;
	settings: PluginSettingsApi;
	i18n: PluginI18nApi;
	/** 当前工作模式（agent_mode 轴）。开发者据此做模式定制。见 ADR-0046。 */
	getAgentMode(): AgentMode;
	/** 订阅工作模式变更（纯全局实时切换）。返回 Disposable 取消订阅。 */
	onAgentModeChanged(listener: (mode: AgentMode) => void): Disposable;
}

export interface PluginDefinition {
	activate(ctx: PluginContext): void | Promise<void>;
	deactivate?(): void | Promise<void>;
}

export function definePlugin(plugin: PluginDefinition): PluginDefinition {
	return plugin;
}
