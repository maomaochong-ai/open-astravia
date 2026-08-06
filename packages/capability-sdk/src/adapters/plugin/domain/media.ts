import { DOMAIN_MEDIA_CAPABILITIES, type MediaJob, type MediaProviderDescriptor } from "../../../domain.js";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginMediaMethods = {
	listMediaProviders(this: PluginCapabilitySessionAccess, sessionId: string): Promise<MediaProviderDescriptor[]> {
		return this.client(sessionId, { permission: "media.generate" }).invoke(
			DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS,
			{},
		);
	},

	createMediaJob(this: PluginCapabilitySessionAccess, sessionId: string, input: unknown): Promise<MediaJob> {
		return this.client(sessionId, { permission: "media.generate" }).invoke(
			DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB,
			DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.parseInput(input),
		);
	},

	getMediaJob(this: PluginCapabilitySessionAccess, sessionId: string, input: unknown): Promise<MediaJob> {
		return this.client(sessionId, { permission: "media.generate" }).invoke(
			DOMAIN_MEDIA_CAPABILITIES.GET_JOB,
			DOMAIN_MEDIA_CAPABILITIES.GET_JOB.parseInput(input),
		);
	},

	cancelMediaJob(this: PluginCapabilitySessionAccess, sessionId: string, input: unknown): Promise<MediaJob> {
		return this.client(sessionId, { permission: "media.generate" }).invoke(
			DOMAIN_MEDIA_CAPABILITIES.CANCEL_JOB,
			DOMAIN_MEDIA_CAPABILITIES.CANCEL_JOB.parseInput(input),
		);
	},
};

export type PluginMediaMethods = typeof pluginMediaMethods;
