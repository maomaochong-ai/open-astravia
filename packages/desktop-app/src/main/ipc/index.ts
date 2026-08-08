import type { WebContents } from "electron";
import type { ActionApprovalBroker } from "../app-actions/approval-broker.js";
import { registerNotificationIpc } from "../notifications/index.js";
import type { PluginActionService } from "../plugins/plugin-action-service.js";
import { registerAbilitiesIpc } from "./abilities.js";
import { registerActionApprovalIpc } from "./action-approval.js";
import { registerAppMonitorIpc } from "./app-monitor.js";
import { registerAppshotIpc } from "./appshot.js";
import { registerClipboardIpc } from "./clipboard.js";
import { registerDebugIpc } from "./debug.js";
import { registerDiagnosticsIpc } from "./diagnostics.js";
import { registerDialogIpc } from "./dialog.js";
import { registerDownloadsIpc } from "./downloads.js";
import { registerFileTransferIpc } from "./file-transfer.js";
import { registerFsIpc } from "./fs.js";
import { registerImIpc } from "./im.js";
import { registerMediaIpc } from "./media.js";
import { registerOnboardingIpc } from "./onboarding.js";
import { registerPermissionsIpc } from "./permissions.js";
import { registerPetIpc } from "./pet.js";
import { registerPluginCapabilitiesIpc } from "./plugin-capabilities.js";
import { registerPluginMediaProvidersIpc } from "./plugin-media-providers.js";
import { registerPluginsIpc } from "./plugins.js";
import { registerProjectExportIpc } from "./project-export.js";
import { registerQuickPanelIpc } from "./quickpanel.js";
import { registerRuntimesIpc } from "./runtimes.js";
import { registerSessionIpc } from "./session.js";
import { registerSettingsIpc } from "./settings.js";
import { registerSkillsIpc } from "./skills.js";
import { registerThemesIpc } from "./themes.js";
import { registerUpdaterIpc } from "./updater.js";
import { registerWebhookIpc } from "./webhook.js";

interface IpcTeardown {
	teardownAbilities: () => void;
	teardownActionApproval: () => void;
	teardownAppMonitor: () => void;
	teardownSession: () => void;
	teardownSettings: () => void;
	teardownUpdater: () => void;
	teardownSkills: () => void;
	teardownThemes: () => void;
	teardownDialog: () => void;
	teardownClipboard: () => void;
	teardownFs: () => void;
	teardownFileTransfer: () => void;
	teardownBatchTasks: () => void;
	teardownDownloads: () => void;
	teardownIm: () => void;
	teardownMedia: () => void;
	teardownDebug: () => void;
	teardownProjectExport: () => void;
	teardownWebhook: () => void;
	teardownRuntimes: () => void;
	teardownPermissions: () => void;
	teardownPlugins: () => void;
	teardownPluginCapabilities: () => void;
	teardownPluginMediaProviders: () => void;
	teardownNotifications: () => void;
	teardownPet: () => void;
	teardownQuickPanel: () => void;
	teardownAppshot: () => void;
	teardownDiagnostics: () => void;
	teardownOnboarding: () => void;
}

export function registerAllIpc(
	webContents: WebContents,
	options: { actionApprovalBroker: ActionApprovalBroker; pluginActionService: PluginActionService },
): IpcTeardown {
	return {
		teardownAbilities: registerAbilitiesIpc(),
		teardownActionApproval: registerActionApprovalIpc(options.actionApprovalBroker),
		teardownAppMonitor: registerAppMonitorIpc(),
		teardownSession: registerSessionIpc(webContents),
		teardownSettings: registerSettingsIpc(),
		teardownUpdater: registerUpdaterIpc(),
		teardownSkills: registerSkillsIpc(),
		teardownThemes: registerThemesIpc(),
		teardownDialog: registerDialogIpc(),
		teardownClipboard: registerClipboardIpc(),
		teardownFs: registerFsIpc(),
		teardownFileTransfer: registerFileTransferIpc(),
		teardownBatchTasks: () => {},
		teardownDownloads: registerDownloadsIpc(webContents),
		teardownIm: registerImIpc(webContents),
		teardownMedia: registerMediaIpc(),
		teardownDebug: registerDebugIpc(),
		teardownProjectExport: registerProjectExportIpc(),
		teardownWebhook: registerWebhookIpc(),
		teardownRuntimes: registerRuntimesIpc(),
		teardownPermissions: registerPermissionsIpc(),
		teardownPlugins: registerPluginsIpc(options.pluginActionService),
		teardownPluginCapabilities: registerPluginCapabilitiesIpc(),
		teardownPluginMediaProviders: registerPluginMediaProvidersIpc(),
		teardownNotifications: registerNotificationIpc(webContents),
		teardownPet: registerPetIpc(),
		teardownQuickPanel: registerQuickPanelIpc(),
		teardownAppshot: registerAppshotIpc(),
		teardownDiagnostics: registerDiagnosticsIpc(),
		teardownOnboarding: registerOnboardingIpc(),
	};
}

export function teardownAllIpc(teardown: IpcTeardown): void {
	teardown.teardownAbilities();
	teardown.teardownActionApproval();
	teardown.teardownAppMonitor();
	teardown.teardownSession();
	teardown.teardownSettings();
	teardown.teardownUpdater();
	teardown.teardownSkills();
	teardown.teardownThemes();
	teardown.teardownDialog();
	teardown.teardownClipboard();
	teardown.teardownFs();
	teardown.teardownFileTransfer();
	teardown.teardownBatchTasks();
	teardown.teardownDownloads();
	teardown.teardownIm();
	teardown.teardownMedia();
	teardown.teardownDebug();
	teardown.teardownProjectExport();
	teardown.teardownWebhook();
	teardown.teardownRuntimes();
	teardown.teardownPermissions();
	teardown.teardownPlugins();
	teardown.teardownPluginCapabilities();
	teardown.teardownPluginMediaProviders();
	teardown.teardownNotifications();
	teardown.teardownPet();
	teardown.teardownQuickPanel();
	teardown.teardownAppshot();
	teardown.teardownDiagnostics();
	teardown.teardownOnboarding();
}

export { registerBatchTasksIpc } from "./batch-tasks.js";
export { registerSchedulerIpc } from "./scheduler.js";

export type { IpcTeardown };
