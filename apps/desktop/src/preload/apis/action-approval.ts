import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

const CHANNELS = {
	REQUEST: "astravia:action-approval:request",
	RESPONSE: "astravia:action-approval:response",
	TIMEOUT: "astravia:action-approval:timeout",
} as const;

export function createActionApprovalApi(ipc: IpcRenderer): Pick<DesktopApi, "actionApproval"> {
	return {
		actionApproval: {
			onRequest: (handler) => onIpcEvent(ipc, CHANNELS.REQUEST, handler),
			onTimeout: (handler) => onIpcEvent(ipc, CHANNELS.TIMEOUT, handler),
			respond: (approvalId, approved, input) => ipc.invoke(CHANNELS.RESPONSE, approvalId, approved, input),
		},
	};
}
