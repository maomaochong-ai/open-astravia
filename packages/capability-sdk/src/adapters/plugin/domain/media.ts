import { DOMAIN_MEDIA_CAPABILITIES, type MediaProviderDescriptor } from "../../../domain.js";
import type { Job } from "../../../foundation.js";
import { PLUGIN_CAPABILITY_PERMISSIONS, type PluginCapabilitySessionAccess } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function qualifySubmitInput(access: PluginCapabilitySessionAccess, sessionId: string, input: unknown): unknown {
	if (!isRecord(input) || !Array.isArray(input.inputs)) return input;
	const session = access.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE });
	return {
		...input,
		ownerId: session.pluginId,
		inputs: input.inputs.map((mediaInput) => {
			if (!isRecord(mediaInput) || !isRecord(mediaInput.source)) return mediaInput;
			if (mediaInput.source.type === "plugin-blob") {
				access.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
				return { ...mediaInput, source: { ...mediaInput.source, namespace: session.pluginId } };
			}
			if (mediaInput.source.type === "workspace-file") {
				access.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ });
			}
			return mediaInput;
		}),
	};
}

export const pluginMediaMethods = {
	listMediaProviders(this: PluginCapabilitySessionAccess, sessionId: string): Promise<MediaProviderDescriptor[]> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE }).invoke(
			DOMAIN_MEDIA_CAPABILITIES.LIST_PROVIDERS,
			{},
		);
	},

	submitMedia(this: PluginCapabilitySessionAccess, sessionId: string, input: unknown): Promise<Job> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE }).invoke(
			DOMAIN_MEDIA_CAPABILITIES.SUBMIT,
			DOMAIN_MEDIA_CAPABILITIES.SUBMIT.parseInput(qualifySubmitInput(this, sessionId, input)),
		);
	},
};

export type PluginMediaMethods = typeof pluginMediaMethods;
