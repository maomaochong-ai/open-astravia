import type { PluginOfficialApi } from "@astravia-org/plugin-sdk";
import { SHORTCUT_ACTIONS } from "../../../../shared/shortcuts";

export function createOfficialShortcutsApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["shortcuts"] {
	const shortcuts = window.astravia.plugins.internalCapabilities.shortcuts;
	return {
		listAvailableActions: () => {
			assertOfficial();
			return SHORTCUT_ACTIONS.map((action) => ({
				id: action.id,
				defaultShortcut: action.defaultShortcut,
			}));
		},
		get: async () => {
			assertOfficial();
			return shortcuts.getSettings(capabilitySessionId);
		},
		setBinding: async (id, shortcut) => {
			assertOfficial();
			return shortcuts.setBinding(capabilitySessionId, id, shortcut);
		},
		resetBinding: async (id) => {
			assertOfficial();
			return shortcuts.resetBinding(capabilitySessionId, id);
		},
		resetAllBindings: async () => {
			assertOfficial();
			return shortcuts.resetAllBindings(capabilitySessionId);
		},
		setQuickPanelTrigger: async (trigger) => {
			assertOfficial();
			return shortcuts.setQuickPanelTrigger(capabilitySessionId, trigger);
		},
		setQuickPanelBehavior: async (behavior) => {
			assertOfficial();
			return shortcuts.setQuickPanelPostSendBehavior(capabilitySessionId, behavior);
		},
	};
}
