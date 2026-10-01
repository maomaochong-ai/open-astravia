import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";

const WEBHOOK_CHANNELS = {
	LIST: "astravia:webhook:list",
	LIST_PROVIDERS: "astravia:webhook:list-providers",
	CREATE: "astravia:webhook:create",
	UPDATE: "astravia:webhook:update",
	DELETE: "astravia:webhook:delete",
	TOGGLE: "astravia:webhook:toggle",
	TEST: "astravia:webhook:test",
	SEND: "astravia:webhook:send",
} as const;

export function createWebhookApi(ipc: IpcRenderer): Pick<DesktopApi, "webhook"> {
	return {
		webhook: {
			list: () => ipc.invoke(WEBHOOK_CHANNELS.LIST),
			listProviders: () => ipc.invoke(WEBHOOK_CHANNELS.LIST_PROVIDERS),
			create: (input) => ipc.invoke(WEBHOOK_CHANNELS.CREATE, input),
			update: (id, patch) => ipc.invoke(WEBHOOK_CHANNELS.UPDATE, id, patch),
			delete: (id) => ipc.invoke(WEBHOOK_CHANNELS.DELETE, id),
			toggle: (id, enabled) => ipc.invoke(WEBHOOK_CHANNELS.TOGGLE, id, enabled),
			test: (id) => ipc.invoke(WEBHOOK_CHANNELS.TEST, id),
			send: (id, message) => ipc.invoke(WEBHOOK_CHANNELS.SEND, id, message),
		},
	};
}
