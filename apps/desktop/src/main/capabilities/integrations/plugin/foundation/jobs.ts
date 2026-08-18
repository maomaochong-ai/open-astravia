import { FOUNDATION_JOB_CAPABILITIES, type Job } from "@vetta/capability-sdk";
import { PLUGIN_CAPABILITY_PERMISSIONS, type PluginCapabilitySessionAccess } from "../types.js";

export const pluginJobMethods = {
	getJob(this: PluginCapabilitySessionAccess, sessionId: string, id: string): Promise<Job> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE });
		return session.access.client.invoke(FOUNDATION_JOB_CAPABILITIES.GET, { ownerId: session.pluginId, id });
	},

	cancelJob(this: PluginCapabilitySessionAccess, sessionId: string, id: string): Promise<Job> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE });
		return session.access.client.invoke(FOUNDATION_JOB_CAPABILITIES.CANCEL, { ownerId: session.pluginId, id });
	},
};

export type PluginJobMethods = typeof pluginJobMethods;
