import type { SettingsDocument } from "../contracts/settings-document.js";
import type { SettingsRuntime } from "../contracts/settings-runtime.js";
import type { SettingsStoragePort } from "../contracts/settings-storage.js";
import { MemorySettingsStorage } from "../storage/memory-settings-storage.js";
import { createHostSettingsView, type HostSettingsDefaults } from "../views/host-settings.js";
import { createSettingsLifecycleView } from "../views/lifecycle-settings.js";
import { createModelSettingsView } from "../views/model-settings.js";
import { createResourceSettingsView } from "../views/resource-settings.js";
import { createSessionSettingsView } from "../views/session-settings.js";
import { SettingsState, type SettingsStatePort } from "./settings-state.js";

export function createSettingsRuntimeFromStorage(
	storage: SettingsStoragePort,
	hostDefaults: HostSettingsDefaults = {},
): SettingsRuntime {
	return composeSettingsRuntime(SettingsState.load(storage), hostDefaults);
}

export function createInMemorySettingsRuntime(
	initial: Partial<SettingsDocument> = {},
	hostDefaults: HostSettingsDefaults = {},
): SettingsRuntime {
	const storage = new MemorySettingsStorage();
	return composeSettingsRuntime(SettingsState.inMemory(storage, initial), hostDefaults);
}

function composeSettingsRuntime(state: SettingsStatePort, hostDefaults: HostSettingsDefaults): SettingsRuntime {
	return {
		...createSettingsLifecycleView(state),
		...createModelSettingsView(state),
		...createSessionSettingsView(state),
		...createResourceSettingsView(state),
		...createHostSettingsView(state, hostDefaults),
	};
}
