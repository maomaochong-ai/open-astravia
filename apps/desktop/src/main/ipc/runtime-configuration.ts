import type { RuntimeConfigurationJsonObject } from "@vetta/runtime-core/configuration";
import { ipcMain, type WebContents } from "electron";
import { RUNTIME_CONFIGURATION_CHANNELS } from "../../shared/runtime-configuration-ipc.js";
import { getDesktopRuntimeConfigurationService } from "../runtime-configuration/runtime-configuration-composition.js";

export function registerRuntimeConfigurationIpc(webContents: WebContents): () => void {
	const service = getDesktopRuntimeConfigurationService();
	ipcMain.handle(RUNTIME_CONFIGURATION_CHANNELS.LIST, () => service.list());
	ipcMain.handle(RUNTIME_CONFIGURATION_CHANNELS.SET, async (_event, configurationId: unknown, patch: unknown) => {
		if (
			typeof configurationId !== "string" ||
			configurationId.trim() === "" ||
			configurationId !== configurationId.trim()
		) {
			throw new Error("Invalid Runtime Configuration id");
		}
		if (!isJsonObject(patch)) throw new Error("Invalid Runtime Configuration patch");
		const catalog = await service.set(configurationId, patch);
		if (!webContents.isDestroyed()) {
			webContents.send(RUNTIME_CONFIGURATION_CHANNELS.CHANGED, { configurationId });
		}
		return catalog;
	});
	return () => {
		ipcMain.removeHandler(RUNTIME_CONFIGURATION_CHANNELS.LIST);
		ipcMain.removeHandler(RUNTIME_CONFIGURATION_CHANNELS.SET);
	};
}

function isJsonObject(value: unknown): value is RuntimeConfigurationJsonObject {
	return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): boolean {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
