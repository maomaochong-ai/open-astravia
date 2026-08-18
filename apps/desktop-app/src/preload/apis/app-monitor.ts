import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";

const RECORD_EVENT_CHANNEL = "vetta:app-monitor:record-event";
const GET_ACHIEVEMENT_USAGE_CHANNEL = "vetta:app-monitor:get-achievement-usage";
const GET_PROMPT_REF_USAGE_CHANNEL = "vetta:app-monitor:get-prompt-ref-usage";

export function createAppMonitorApi(ipc: IpcRenderer): Pick<DesktopApi, "appMonitor"> {
	return {
		appMonitor: {
			getAchievementUsage: () => ipc.invoke(GET_ACHIEVEMENT_USAGE_CHANNEL),
			getPromptRefUsage: () => ipc.invoke(GET_PROMPT_REF_USAGE_CHANNEL),
			recordEvent: (event) => ipc.send(RECORD_EVENT_CHANNEL, event),
		},
	};
}
