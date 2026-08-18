import { DOMAIN_UPDATER_CAPABILITIES, type UpdaterState } from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginUpdaterMethods = {
	getUpdaterState(this: PluginCapabilitySessionAccess, sessionId: string): Promise<UpdaterState> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_UPDATER_CAPABILITIES.GET_STATE, {});
	},

	getUpdaterCurrentVersion(this: PluginCapabilitySessionAccess, sessionId: string): Promise<string> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_UPDATER_CAPABILITIES.GET_CURRENT_VERSION, {});
	},

	checkUpdater(this: PluginCapabilitySessionAccess, sessionId: string): Promise<UpdaterState> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_UPDATER_CAPABILITIES.CHECK, {});
	},

	downloadUpdater(this: PluginCapabilitySessionAccess, sessionId: string): Promise<UpdaterState> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_UPDATER_CAPABILITIES.DOWNLOAD, {});
	},

	installUpdater(this: PluginCapabilitySessionAccess, sessionId: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_UPDATER_CAPABILITIES.INSTALL, {});
	},

	dismissUpdater(this: PluginCapabilitySessionAccess, sessionId: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_UPDATER_CAPABILITIES.DISMISS, {});
	},

	cancelUpdater(this: PluginCapabilitySessionAccess, sessionId: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_UPDATER_CAPABILITIES.CANCEL, {});
	},
};

export type PluginUpdaterMethods = typeof pluginUpdaterMethods;
