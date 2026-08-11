import type { CapabilityAccessHandle } from "@vetta/capability-sdk";

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export const PLUGIN_CAPABILITY_PERMISSIONS = {
	AI_MODELS_LIST: "ai.models.list",
	AI_COMPLETE: "ai.complete",
	FILESYSTEM_READ: "fs.read",
	FILESYSTEM_WRITE: "fs.write",
	NETWORK_FETCH: "network.fetch",
	STORAGE_READ: "storage.read",
	STORAGE_WRITE: "storage.write",
	MEDIA_GENERATE: "media.generate",
} as const;

export interface PluginCapabilityAdapterOptions {
	readonly isOfficialPlugin: (pluginId: string) => boolean;
	readonly resolvePermissions: (pluginId: string) => readonly string[];
	readonly onSessionClosed?: (pluginId: string) => void;
}

export interface PluginCapabilitySession {
	readonly access: CapabilityAccessHandle;
	readonly pluginId: string;
}

export interface PluginCapabilityRequirement {
	readonly official?: boolean;
	readonly permission?: string;
}

/** Internal session/permission resolution used by method modules. */
export interface PluginCapabilitySessionAccess {
	client(sessionId: string, requirement: PluginCapabilityRequirement): CapabilityAccessHandle["client"];
	session(sessionId: string, requirement: PluginCapabilityRequirement): PluginCapabilitySession;
}
