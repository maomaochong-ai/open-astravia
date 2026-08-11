import type { SettingsDocument } from "../contracts/settings-document.js";
import type { SettingsRuntime } from "../contracts/settings-runtime.js";
import type { SettingsStoragePort } from "../contracts/settings-storage.js";
import { FileSettingsStorage } from "../storage/file-settings-storage.js";
import { MemorySettingsStorage } from "../storage/memory-settings-storage.js";
import { createHostSettingsView } from "../views/host-settings.js";
import { createSettingsLifecycleView } from "../views/lifecycle-settings.js";
import { createModelSettingsView } from "../views/model-settings.js";
import { createResourceSettingsView } from "../views/resource-settings.js";
import { createSessionSettingsView } from "../views/session-settings.js";
import { SettingsState, type SettingsStatePort } from "./settings-state.js";

export function createFileSettingsRuntime(cwd?: string, agentDir?: string): SettingsRuntime {
	return composeSettingsRuntime(SettingsState.load(new FileSettingsStorage(cwd, agentDir)));
}

export function createSettingsRuntimeFromStorage(storage: SettingsStoragePort): SettingsRuntime {
	return composeSettingsRuntime(SettingsState.load(storage));
}

export function createInMemorySettingsRuntime(initial: Partial<SettingsDocument> = {}): SettingsRuntime {
	const storage = new MemorySettingsStorage();
	return composeSettingsRuntime(SettingsState.inMemory(storage, initial));
}

function composeSettingsRuntime(state: SettingsStatePort): SettingsRuntime {
	return {
		...createSettingsLifecycleView(state),
		...createModelSettingsView(state),
		...createSessionSettingsView(state),
		...createResourceSettingsView(state),
		...createHostSettingsView(state),
	};
}
