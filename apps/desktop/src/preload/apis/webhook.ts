import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";

const WEBHOOK_CHANNELS = {
	LIST: "vetta:webhook:list",
	LIST_PROVIDERS: "vetta:webhook:list-providers",
	CREATE: "vetta:webhook:create",
	UPDATE: "vetta:webhook:update",
	DELETE: "vetta:webhook:delete",
	TOGGLE: "vetta:webhook:toggle",
	TEST: "vetta:webhook:test",
	SEND: "vetta:webhook:send",
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
