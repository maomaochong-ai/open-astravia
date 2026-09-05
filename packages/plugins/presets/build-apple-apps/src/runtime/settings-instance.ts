import { readJsonFile, writeJsonFile } from "@vetta-org/plugin-sdk";
import { getPluginCtx } from "../plugin-context.js";
import { PanelSettingsStore } from "./panel-settings.js";

/** 配置在活动 Tab、工作区配置页和 activate() 的显隐逻辑之间共享，惰性建单例。 */
let store: PanelSettingsStore | null = null;

export function getSettingsStore(): PanelSettingsStore {
	if (!store) {
		const { storage } = getPluginCtx();
		store = new PanelSettingsStore({
			readJson: (key) => readJsonFile<unknown>(storage, key),
			writeJson: (key, value) => writeJsonFile(storage, key, value).then(() => undefined),
		});
	}
	return store;
}

export function resetSettingsStore(): void {
	store = null;
}
