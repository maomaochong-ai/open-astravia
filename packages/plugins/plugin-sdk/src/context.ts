import type { PluginAgentApi } from "./agent.js";
import type { PluginAiApi } from "./ai.js";
import type { PluginAppActionsApi } from "./app-actions.js";
import type { PluginArtifactsApi } from "./artifacts.js";
import type { PluginCaptureApi } from "./capture.js";
import type { PluginCommandApi } from "./command.js";
import type { PluginConversationApi } from "./conversation.js";
import type { Disposable } from "./disposable.js";
import type { PluginFileExplorerApi } from "./file-explorer.js";
import type { PluginFsApi } from "./fs.js";
import type { PluginGatewayApi } from "./gateway.js";
import type { PluginI18nApi } from "./i18n.js";
import type { PluginJobsApi } from "./jobs.js";
import type { PluginMediaApi } from "./media.js";
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

/**
 * 工作模式 id。合法值由宿主的模式注册表定义（ADR-0071），插件不应硬编码枚举；
 * 需要区分模式时按 id 字符串比较，未知 id 一律按通用处理。
 */
export type AgentMode = string;

export interface PluginContext {
	plugin: {
		id: string;
		version: string;
		/**
		 * Host-resolved brand icon from `plugin.json#icon` (if declared).
		 * Opaque string for `<img src>` / Iconify — plugins must not invent
		 * host protocols; use this or omit Activity Tab `icon` to inherit it.
		 */
		iconUrl?: string;
	};
	permissions: PluginPermissionApi;
	ui: PluginUiApi;
	fileExplorer: PluginFileExplorerApi;
	conversation: PluginConversationApi;
	agent: PluginAgentApi;
	appActions: PluginAppActionsApi;
	ai: PluginAiApi;
	official: PluginOfficialApi;
	fs: PluginFsApi;
	command: PluginCommandApi;
	media: PluginMediaApi;
	jobs: PluginJobsApi;
	artifacts: PluginArtifactsApi;
	/** 主进程离屏窗口截图（`capture.offscreen` 权限）。旧宿主上为 `undefined`，使用前判空。 */
	capture?: PluginCaptureApi;
	network: PluginNetworkApi;
	/**
	 * Vetta 服务端网关调用（ADR-0056）。**仅内置 official 插件可用**，
	 * 第三方插件读到 `undefined`，故使用前必须判空。
	 */
	gateway?: PluginGatewayApi;
	storage: PluginStorageApi;
	settings: PluginSettingsApi;
	i18n: PluginI18nApi;
	/**
	 * 当前的**新会话默认工作模式**（agent_mode 轴，见 ADR-0046 及其 2026-08 修订）。
	 *
	 * 工作模式只在会话创建时固化，之后会话内不可变，因此这里读到的是用户此刻的设置值，
	 * **不是**某个已存在会话正在使用的模式，不要用它推断进行中的会话。
	 * 模式也不再隐藏任何插件能力，只适合做展示层的软性定制，不要据此隐藏功能入口。
	 */
	getAgentMode(): AgentMode;
	/** 订阅默认工作模式变更（用户改设置时触发）。返回 Disposable 取消订阅。 */
	onAgentModeChanged(listener: (mode: AgentMode) => void): Disposable;
}

export type PluginActivationCleanup = Disposable | (() => void | Promise<void>);

export interface PluginDefinition {
	/**
	 * Activate one plugin instance. Returning a cleanup binds resource ownership to
	 * this specific activation, including overlapping hot-reload activations.
	 */
	activate(ctx: PluginContext): void | PluginActivationCleanup | Promise<void | PluginActivationCleanup>;
	/** Legacy module-level cleanup. Prefer an activation-scoped cleanup return value. */
	deactivate?(): void | Promise<void>;
}

export function definePlugin(plugin: PluginDefinition): PluginDefinition {
	return plugin;
}
