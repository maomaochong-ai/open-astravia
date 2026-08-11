import {
	type DefaultExecutionModeSettingInput,
	DOMAIN_GENERAL_SETTINGS_CAPABILITIES,
	type GeneralExecutionMode,
	type GeneralSettingsSnapshot,
	type NotificationsSettingInput,
	type WorkspaceSettingInput,
} from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginGeneralSettingsMethods = {
	getGeneralSettings(this: PluginCapabilitySessionAccess, sessionId: string): Promise<GeneralSettingsSnapshot> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_GENERAL_SETTINGS_CAPABILITIES.GET, {});
	},

	setNotifications(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		enabled: boolean,
	): Promise<NotificationsSettingInput> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_NOTIFICATIONS, {
			enabled,
		});
	},

	setDefaultExecutionMode(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		mode: GeneralExecutionMode,
	): Promise<DefaultExecutionModeSettingInput> {
		return this.client(sessionId, { official: true }).invoke(
			DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_DEFAULT_EXECUTION_MODE,
			{ mode },
		);
	},

	setWorkspace(this: PluginCapabilitySessionAccess, sessionId: string, path: string): Promise<WorkspaceSettingInput> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_GENERAL_SETTINGS_CAPABILITIES.SET_WORKSPACE, {
			path,
		});
	},
};

export type PluginGeneralSettingsMethods = typeof pluginGeneralSettingsMethods;
