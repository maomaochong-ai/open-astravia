import { FOUNDATION_STORAGE_CAPABILITIES, type StorageBlob, type StorageBlobRef } from "@vetta/capability-sdk";
import { PLUGIN_CAPABILITY_PERMISSIONS, type PluginCapabilitySessionAccess } from "../types.js";

export const pluginStorageMethods = {
	listStorage(this: PluginCapabilitySessionAccess, sessionId: string, prefix?: string): Promise<string[]> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.LIST, {
			namespace: session.pluginId,
			...(prefix === undefined ? {} : { prefix }),
		});
	},

	readStorageFile(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		path: string,
		encoding: "utf8" | "base64",
	): Promise<string | null> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.READ_FILE, {
			namespace: session.pluginId,
			path,
			encoding,
		});
	},

	readStorageSnapshot(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		paths: readonly string[],
		encoding: "utf8" | "base64",
	): Promise<{ revision: string; files: Record<string, string | null> }> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.READ_SNAPSHOT, {
			namespace: session.pluginId,
			paths,
			encoding,
		});
	},

	readStorageBlob(this: PluginCapabilitySessionAccess, sessionId: string, id: string): Promise<StorageBlob | null> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.READ_BLOB, {
			namespace: session.pluginId,
			id,
		});
	},

	getStorageBlobRef(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		id: string,
	): Promise<StorageBlobRef | null> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.GET_BLOB_REF, {
			namespace: session.pluginId,
			id,
		});
	},

	commitStorage(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		changes: readonly (
			| { type: "write"; path: string; data: string; encoding: "utf8" | "base64" }
			| { type: "remove"; path: string }
		)[],
		expectedRevision?: string,
	): Promise<{ revision: string; changedPaths: string[] }> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_WRITE });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.COMMIT, {
			namespace: session.pluginId,
			changes,
			...(expectedRevision === undefined ? {} : { expectedRevision }),
		});
	},

	putStorageBlob(this: PluginCapabilitySessionAccess, sessionId: string, input: unknown): Promise<StorageBlobRef> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_WRITE });
		const parsedInput = FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB.parseInput({
			namespace: session.pluginId,
			blob: input,
		});
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB, parsedInput);
	},

	putStorageBlobFromFile(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		input: unknown,
	): Promise<StorageBlobRef> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_WRITE });
		const parsedInput = FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB_FROM_FILE.parseInput({
			namespace: session.pluginId,
			blob: input,
		});
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB_FROM_FILE, parsedInput);
	},
};

export type PluginStorageMethods = typeof pluginStorageMethods;
