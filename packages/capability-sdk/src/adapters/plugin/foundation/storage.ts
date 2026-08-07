import {
	type CapabilityJsonValue,
	FOUNDATION_STORAGE_CAPABILITIES,
	parseCapabilityJsonValue,
	type StorageBlob,
	type StorageBlobRef,
} from "../../../foundation.js";
import { PLUGIN_CAPABILITY_PERMISSIONS, type PluginCapabilitySessionAccess } from "../types.js";

export const pluginStorageMethods = {
	readStorageJson(this: PluginCapabilitySessionAccess, sessionId: string, key: string): Promise<CapabilityJsonValue> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.READ_JSON, {
			namespace: session.pluginId,
			key,
		});
	},

	listStorage(this: PluginCapabilitySessionAccess, sessionId: string, prefix?: string): Promise<string[]> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.LIST, {
			namespace: session.pluginId,
			...(prefix === undefined ? {} : { prefix }),
		});
	},

	readStorageFile(this: PluginCapabilitySessionAccess, sessionId: string, path: string): Promise<string | null> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_READ });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.READ_FILE, {
			namespace: session.pluginId,
			path,
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

	writeStorageJson(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		key: string,
		value: unknown,
	): Promise<undefined> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_WRITE });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.WRITE_JSON, {
			namespace: session.pluginId,
			key,
			value: parseCapabilityJsonValue(value),
		});
	},

	writeStorageFile(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		path: string,
		data: string,
	): Promise<undefined> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.STORAGE_WRITE });
		return session.access.client.invoke(FOUNDATION_STORAGE_CAPABILITIES.WRITE_FILE, {
			namespace: session.pluginId,
			path,
			data,
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
