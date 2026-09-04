import { getPluginCtx } from "../plugin-context.js";
import { ProviderSettingsStore } from "./provider-settings.js";

/** 配置在 Provider 与工作区配置页之间共享，惰性建单例。 */
let store: ProviderSettingsStore | null = null;

export function getSettingsStore(): ProviderSettingsStore {
	if (!store) {
		const { storage } = getPluginCtx();
		store = new ProviderSettingsStore({
			readJson: (key) => storage.readJson<unknown>(key),
			writeJson: (key, value) => storage.writeJson(key, value),
		});
	}
	return store;
}

export function resetSettingsStore(): void {
	store = null;
}
