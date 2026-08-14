import {
	DOMAIN_QUICK_PANEL_CAPABILITIES,
	DOMAIN_SHORTCUT_CAPABILITIES,
	type QuickPanelPostSendBehavior,
	type QuickPanelSettings,
	type QuickPanelTrigger,
	type ShortcutBindingResetResult,
	type ShortcutBindingsResult,
	type ShortcutSettings,
} from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginShortcutMethods = {
	getShortcutSettings(this: PluginCapabilitySessionAccess, sessionId: string): Promise<ShortcutSettings> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SHORTCUT_CAPABILITIES.GET_SETTINGS, {});
	},

	setShortcutBinding(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		id: string,
		shortcut: string,
	): Promise<ShortcutBindingsResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SHORTCUT_CAPABILITIES.SET_BINDING, {
			id,
			shortcut,
		});
	},

	resetShortcutBinding(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		id: string,
	): Promise<ShortcutBindingResetResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SHORTCUT_CAPABILITIES.RESET_BINDING, {
			id,
		});
	},

	resetAllShortcutBindings(this: PluginCapabilitySessionAccess, sessionId: string): Promise<ShortcutBindingsResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_SHORTCUT_CAPABILITIES.RESET_ALL_BINDINGS, {});
	},

	setQuickPanelTrigger(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		trigger: QuickPanelTrigger,
	): Promise<QuickPanelSettings> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_QUICK_PANEL_CAPABILITIES.SET_TRIGGER, {
			trigger,
		});
	},

	setQuickPanelPostSendBehavior(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		behavior: QuickPanelPostSendBehavior,
	): Promise<QuickPanelSettings> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_QUICK_PANEL_CAPABILITIES.SET_POST_SEND_BEHAVIOR, {
			behavior,
		});
	},
};

export type PluginShortcutMethods = typeof pluginShortcutMethods;
