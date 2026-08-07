import {
	DOMAIN_MEDIA_CAPABILITIES,
	type MediaJob,
	type MediaProviderDescriptor,
	type MediaSavedArtifact,
} from "../../../domain.js";
import { PLUGIN_CAPABILITY_PERMISSIONS, type PluginCapabilitySessionAccess } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function qualifyCreateJobInput(access: PluginCapabilitySessionAccess, sessionId: string, input: unknown): unknown {
	if (!isRecord(input) || !Array.isArray(input.references)) return input;
	const session = access.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE });
	return {
		...input,
		references: input.references.map((reference) => {
			if (!isRecord(reference) || !isRecord(reference.source)) return reference;
			if (reference.source.type === "plugin-blob") {
				access.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
				return { ...reference, source: { ...reference.source, namespace: session.pluginId } };
			}
			if (reference.source.type === "workspace-file") {
				access.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ });
			}
			return reference;
		}),
	};
}

function qualifySaveArtifactInput(access: PluginCapabilitySessionAccess, sessionId: string, input: unknown): unknown {
	if (!isRecord(input) || !isRecord(input.destination)) return input;
	const session = access.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE });
	if (input.destination.type === "plugin-blob") {
		access.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_WRITE });
		return { ...input, destination: { ...input.destination, namespace: session.pluginId } };
	}
	if (input.destination.type === "workspace-file") {
		access.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_WRITE });
	}
	return input;
}

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
			DOMAIN_MEDIA_CAPABILITIES.CREATE_JOB.parseInput(qualifyCreateJobInput(this, sessionId, input)),
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

	saveMediaArtifact(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		input: unknown,
	): Promise<MediaSavedArtifact> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE }).invoke(
			DOMAIN_MEDIA_CAPABILITIES.SAVE_ARTIFACT,
			DOMAIN_MEDIA_CAPABILITIES.SAVE_ARTIFACT.parseInput(qualifySaveArtifactInput(this, sessionId, input)),
		);
	},

	async releaseMediaArtifact(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		artifactId: string,
	): Promise<void> {
		await this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.MEDIA_GENERATE }).invoke(
			DOMAIN_MEDIA_CAPABILITIES.RELEASE_ARTIFACT,
			{ artifactId },
		);
	},
};

export type PluginMediaMethods = typeof pluginMediaMethods;
