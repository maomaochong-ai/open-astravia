import { ipcMain } from "electron";
import type { WebhookCreateInput, WebhookMessage, WebhookUpdatePatch } from "../webhook/index.js";
import { getWebhookManager } from "../webhook/index.js";

const CHANNELS = {
	LIST: "astravia:webhook:list",
	LIST_PROVIDERS: "astravia:webhook:list-providers",
	CREATE: "astravia:webhook:create",
	UPDATE: "astravia:webhook:update",
	DELETE: "astravia:webhook:delete",
	TOGGLE: "astravia:webhook:toggle",
	TEST: "astravia:webhook:test",
	SEND: "astravia:webhook:send",
} as const;

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`invalid ${field}`);
	}
}

export function registerWebhookIpc(): () => void {
	const manager = getWebhookManager();

	ipcMain.handle(CHANNELS.LIST, () => manager.list());

	ipcMain.handle(CHANNELS.LIST_PROVIDERS, () => manager.listProviderDescriptors());

	ipcMain.handle(CHANNELS.CREATE, (_event, payload: WebhookCreateInput) => {
		try {
			return { ok: true as const, endpoint: manager.create(payload) };
		} catch (err) {
			return { ok: false as const, error: (err as Error).message };
		}
	});

	ipcMain.handle(CHANNELS.UPDATE, (_event, id: unknown, patch: WebhookUpdatePatch) => {
		assertNonEmptyString(id, "id");
		try {
			return { ok: true as const, endpoint: manager.update(id, patch) };
		} catch (err) {
			return { ok: false as const, error: (err as Error).message };
		}
	});

	ipcMain.handle(CHANNELS.DELETE, (_event, id: unknown) => {
		assertNonEmptyString(id, "id");
		manager.delete(id);
		return { ok: true as const };
	});

	ipcMain.handle(CHANNELS.TOGGLE, (_event, id: unknown, enabled: unknown) => {
		assertNonEmptyString(id, "id");
		if (typeof enabled !== "boolean") throw new Error("invalid enabled");
		try {
			return { ok: true as const, endpoint: manager.setEnabled(id, enabled) };
		} catch (err) {
			return { ok: false as const, error: (err as Error).message };
		}
	});

	ipcMain.handle(CHANNELS.TEST, async (_event, id: unknown) => {
		assertNonEmptyString(id, "id");
		return manager.test(id);
	});

	ipcMain.handle(CHANNELS.SEND, async (_event, id: unknown, message: WebhookMessage) => {
		assertNonEmptyString(id, "id");
		return manager.send(id, message);
	});

	return () => {
		for (const channel of Object.values(CHANNELS)) {
			ipcMain.removeHandler(channel);
		}
	};
}
