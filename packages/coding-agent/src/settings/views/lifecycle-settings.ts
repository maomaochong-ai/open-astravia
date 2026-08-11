import type { SettingsLifecyclePort } from "../contracts/settings-lifecycle.js";
import type { SettingsStatePort } from "../runtime/settings-state.js";

export function createSettingsLifecycleView(state: SettingsStatePort): SettingsLifecyclePort {
	return {
		getGlobalSettings: () => state.readGlobal(),
		getProjectSettings: () => state.readProject(),
		reload: () => state.reload(),
		reloadImageSettings: () => state.reloadSection("images"),
		reloadPersonalizationSettings: () => state.reloadSection("personalization"),
		applyOverrides: (overrides) => state.applyOverrides(overrides),
		flush: () => state.flush(),
		drainErrors: () => state.drainErrors(),
	};
}
