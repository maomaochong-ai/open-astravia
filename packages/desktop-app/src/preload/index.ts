import { contextBridge, ipcRenderer, webUtils } from "electron";
import "./telemetry.js";
import type { DesktopApi } from "./api.js";
import { createAbilitiesApi } from "./apis/abilities.js";
import { createActionApprovalApi } from "./apis/action-approval.js";
import { createAppLifecycleApi } from "./apis/app-lifecycle.js";
import { createAppMonitorApi } from "./apis/app-monitor.js";
import { createAppshotApi } from "./apis/appshot.js";
import { createBatchTasksApi } from "./apis/batch-tasks.js";
import { createDownloadsApi } from "./apis/downloads.js";
import { createI18nApi } from "./apis/i18n.js";
import { createImApi } from "./apis/im.js";
import { createNotificationApi } from "./apis/notification.js";
import { createPetApi } from "./apis/pet.js";
import { createPluginsApi } from "./apis/plugins.js";
import { createQuickPanelApi } from "./apis/quick-panel.js";
import { createSchedulerApi } from "./apis/scheduler.js";
import { createSessionApi } from "./apis/session.js";
import { createSystemApi } from "./apis/system.js";
import { createTelemetryApi } from "./apis/telemetry.js";
import { createThemesApi } from "./apis/themes.js";
import { createWebhookApi } from "./apis/webhook.js";
import { createHostAccessGate } from "./host-access.js";

const USER_ACTIVITY_CHANNEL = "vetta:app-monitor:user-activity";
const USER_ACTIVITY_THROTTLE_MS = 15_000;
let lastUserActivitySentAt = 0;

const reportUserActivity = (): void => {
	const now = Date.now();
	if (now - lastUserActivitySentAt < USER_ACTIVITY_THROTTLE_MS) return;
	lastUserActivitySentAt = now;
	ipcRenderer.send(USER_ACTIVITY_CHANNEL);
};

for (const eventName of ["keydown", "mousedown", "mousemove", "touchstart", "wheel"] as const) {
	window.addEventListener(eventName, reportUserActivity, { capture: true, passive: true });
}

const rawApi: Omit<DesktopApi, "hostAccess"> = {
	...createAbilitiesApi(ipcRenderer),
	...createActionApprovalApi(ipcRenderer),
	...createAppLifecycleApi(ipcRenderer),
	...createAppMonitorApi(ipcRenderer),
	...createSessionApi(ipcRenderer),
	...createImApi(ipcRenderer),
	...createDownloadsApi(ipcRenderer),
	...createBatchTasksApi(ipcRenderer),
	...createSchedulerApi(ipcRenderer),
	...createWebhookApi(ipcRenderer),
	...createNotificationApi(ipcRenderer),
	...createPluginsApi(ipcRenderer, webUtils),
	...createThemesApi(ipcRenderer),
	...createPetApi(ipcRenderer),
	...createQuickPanelApi(ipcRenderer),
	...createAppshotApi(ipcRenderer),
	...createI18nApi(ipcRenderer),
	...createTelemetryApi(ipcRenderer),
	...createSystemApi(ipcRenderer, webUtils),
};

const hostGate = createHostAccessGate(rawApi);
const api: DesktopApi = {
	hostAccess: hostGate.hostAccess,
	...hostGate.api,
};

contextBridge.exposeInMainWorld("vetta", api);
