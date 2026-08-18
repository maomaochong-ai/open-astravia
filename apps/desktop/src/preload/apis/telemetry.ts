import type { IpcRenderer } from "electron";
import { TELEMETRY_CONTEXT_CHANNEL } from "../../shared/telemetry.js";
import type { DesktopApi } from "../api.js";

export function createTelemetryApi(ipc: IpcRenderer): Pick<DesktopApi, "telemetry"> {
	return {
		telemetry: {
			setContext: (context) => ipc.send(TELEMETRY_CONTEXT_CHANNEL, context),
		},
	};
}
