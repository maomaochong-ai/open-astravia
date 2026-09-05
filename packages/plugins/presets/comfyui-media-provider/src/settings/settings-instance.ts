import { readJsonFile, writeJsonFile } from "@vetta-org/plugin-sdk";
import { getPluginCtx } from "../plugin-context.js";
import { ProviderSettingsStore } from "./provider-settings.js";

/** 配置在 Provider 与工作区配置页之间共享，惰性建单例。 */
let store: ProviderSettingsStore | null = null;

export function getSettingsStore(): ProviderSettingsStore {
	if (!store) {
		const { storage } = getPluginCtx();
		store = new ProviderSettingsStore({
			readJson: (key) => readJsonFile<unknown>(storage, key),
			writeJson: (key, value) => writeJsonFile(storage, key, value).then(() => undefined),
		});
	}
	return store;
}

export function resetSettingsStore(): void {
	store = null;
}
