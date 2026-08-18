import type { DesktopAbilitiesApi } from "./api-types/abilities.js";
import type { DesktopActionApprovalApi } from "./api-types/action-approval.js";
import type { DesktopAppLifecycleApi } from "./api-types/app-lifecycle.js";
import type { DesktopAppMonitorApi } from "./api-types/app-monitor.js";
import type { DesktopAppshotApi } from "./api-types/appshot.js";
import type { DesktopAuthApi } from "./api-types/auth.js";
import type { DesktopBatchTasksApi } from "./api-types/batch-tasks.js";
import type { DesktopConfigApi } from "./api-types/config.js";
import type { DesktopDebugApi } from "./api-types/debug.js";
import type { DesktopDiagnosticsApi } from "./api-types/diagnostics.js";
import type { DesktopDialogApi } from "./api-types/dialog.js";
import type { DesktopDownloadsApi } from "./api-types/downloads.js";
import type { DesktopI18nApi } from "./api-types/i18n.js";
import type { DesktopImApi } from "./api-types/im.js";
import type { DesktopKnowledgeApi } from "./api-types/knowledge.js";
import type { DesktopMcpApi } from "./api-types/mcp.js";
import type { DesktopMediaApi } from "./api-types/media.js";
import type { DesktopModelsApi } from "./api-types/models.js";
import type { DesktopNotificationApi } from "./api-types/notification.js";
import type { DesktopPetApi } from "./api-types/pet.js";
import type { DesktopPluginsApi } from "./api-types/plugins.js";
import type { DesktopProjectApi } from "./api-types/project.js";
import type { DesktopQuickPanelApi } from "./api-types/quick-panel.js";
import type { DesktopSchedulerApi } from "./api-types/scheduler.js";
import type { DesktopSessionApi } from "./api-types/session.js";
import type { DesktopSkillsApi } from "./api-types/skills.js";
import type { DesktopSpeechInputApi } from "./api-types/speech-input.js";
import type {
	DesktopClipboardApi,
	DesktopPermissionsApi,
	DesktopRuntimesApi,
	DesktopSettingsApi,
	DesktopShellApi,
	DesktopSubscriptionApi,
	DesktopTrayApi,
	DesktopWindowApi,
} from "./api-types/system.js";
import type { DesktopTelemetryApi } from "./api-types/telemetry.js";
import type { DesktopThemeApi } from "./api-types/theme.js";
import type { DesktopThemesApi } from "./api-types/themes.js";
import type { DesktopUpdaterApi } from "./api-types/updater.js";
import type { DesktopWebhookApi } from "./api-types/webhook.js";
import type { DesktopFsApi } from "./fs-types.js";

export type * from "./api-types/abilities.js";
export type * from "./api-types/action-approval.js";
export type * from "./api-types/app-lifecycle.js";
export type * from "./api-types/app-monitor.js";
export type * from "./api-types/appshot.js";
export type * from "./api-types/auth.js";
export type * from "./api-types/batch-tasks.js";
export type * from "./api-types/config.js";
export type * from "./api-types/debug.js";
export type * from "./api-types/dialog.js";
export type * from "./api-types/downloads.js";
export type * from "./api-types/i18n.js";
export type * from "./api-types/im.js";
export type * from "./api-types/mcp.js";
export type * from "./api-types/media.js";
export type * from "./api-types/models.js";
export type * from "./api-types/notification.js";
export type * from "./api-types/pet.js";
export type * from "./api-types/plugins.js";
export type * from "./api-types/project.js";
export type * from "./api-types/quick-panel.js";
export type * from "./api-types/scheduler.js";
export type * from "./api-types/session.js";
export type * from "./api-types/shared.js";
export type * from "./api-types/skills.js";
export type * from "./api-types/speech-input.js";
export type * from "./api-types/system.js";
export type * from "./api-types/telemetry.js";
export type * from "./api-types/theme.js";
export type * from "./api-types/themes.js";
export type * from "./api-types/updater.js";
export type * from "./api-types/webhook.js";

export interface DesktopHostAccessApi {
	/** 仅供 renderer 启动模块领取一次；插件运行前令牌已经被宿主持有。 */
	claim(): string;
}

export interface DesktopApi {
	hostAccess: DesktopHostAccessApi;
	abilities: DesktopAbilitiesApi;
	actionApproval: DesktopActionApprovalApi;
	appLifecycle: DesktopAppLifecycleApi;
	appMonitor: DesktopAppMonitorApi;
	session: DesktopSessionApi;
	speechInput: DesktopSpeechInputApi;
	dialog: DesktopDialogApi;
	theme: DesktopThemeApi;
	themes: DesktopThemesApi;
	telemetry: DesktopTelemetryApi;
	i18n: DesktopI18nApi;
	fs: DesktopFsApi;
	skills: DesktopSkillsApi;
	config: DesktopConfigApi;
	knowledge: DesktopKnowledgeApi;
	models: DesktopModelsApi;
	mcp: DesktopMcpApi;
	media: DesktopMediaApi;
	settings: DesktopSettingsApi;
	subscription: DesktopSubscriptionApi;
	shell: DesktopShellApi;
	clipboard: DesktopClipboardApi;
	window: DesktopWindowApi;
	auth: DesktopAuthApi;
	updater: DesktopUpdaterApi;
	tray: DesktopTrayApi;
	scheduler: DesktopSchedulerApi;
	batchTasks: DesktopBatchTasksApi;
	downloads: DesktopDownloadsApi;
	im: DesktopImApi;
	debug: DesktopDebugApi;
	diagnostics: DesktopDiagnosticsApi;
	project: DesktopProjectApi;
	webhook: DesktopWebhookApi;
	runtimes: DesktopRuntimesApi;
	permissions: DesktopPermissionsApi;
	notification: DesktopNotificationApi;
	plugins: DesktopPluginsApi;
	pet: DesktopPetApi;
	quickPanel: DesktopQuickPanelApi;
	appshot: DesktopAppshotApi;
}

declare global {
	interface Window {
		vetta: DesktopApi;
	}
}
