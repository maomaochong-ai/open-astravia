import type { HostSettingsPort } from "./host-settings.js";
import type { ModelSettingsPort } from "./model-settings.js";
import type { ResourceSettingsPort } from "./resource-settings.js";
import type { SessionSettingsPort } from "./session-settings.js";
import type { SettingsLifecyclePort } from "./settings-lifecycle.js";

export interface SettingsRuntime
	extends SettingsLifecyclePort,
		ModelSettingsPort,
		SessionSettingsPort,
		ResourceSettingsPort,
		HostSettingsPort {}
