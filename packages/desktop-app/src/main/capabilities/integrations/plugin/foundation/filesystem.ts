import {
	type FilesystemEntry,
	type FilesystemFileRef,
	type FilesystemReadBinaryFileResult,
	type FilesystemReadFileResult,
	type FilesystemStatResult,
	FOUNDATION_FILESYSTEM_CAPABILITIES,
} from "@vetta/capability-sdk";
import { PLUGIN_CAPABILITY_PERMISSIONS, type PluginCapabilitySessionAccess } from "../types.js";

export const pluginFilesystemMethods = {
	readDirectory(this: PluginCapabilitySessionAccess, sessionId: string, path: string): Promise<FilesystemEntry[]> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ }).invoke(
			FOUNDATION_FILESYSTEM_CAPABILITIES.READ_DIRECTORY,
			{ path },
		);
	},

	readFile(this: PluginCapabilitySessionAccess, sessionId: string, path: string): Promise<FilesystemReadFileResult> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ }).invoke(
			FOUNDATION_FILESYSTEM_CAPABILITIES.READ_FILE,
			{ path },
		);
	},

	readBinaryFile(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		path: string,
	): Promise<FilesystemReadBinaryFileResult> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ }).invoke(
			FOUNDATION_FILESYSTEM_CAPABILITIES.READ_BINARY_FILE,
			{ path },
		);
	},

	writeFile(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		path: string,
		content: string,
		encoding?: "utf8" | "base64",
	): Promise<undefined> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_WRITE }).invoke(
			FOUNDATION_FILESYSTEM_CAPABILITIES.WRITE_FILE,
			{ path, content, encoding },
		);
	},

	stat(this: PluginCapabilitySessionAccess, sessionId: string, path: string): Promise<FilesystemStatResult | null> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ }).invoke(
			FOUNDATION_FILESYSTEM_CAPABILITIES.STAT,
			{ path },
		);
	},

	rename(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		oldPath: string,
		newPath: string,
	): Promise<undefined> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_WRITE }).invoke(
			FOUNDATION_FILESYSTEM_CAPABILITIES.RENAME,
			{ oldPath, newPath },
		);
	},

	delete(this: PluginCapabilitySessionAccess, sessionId: string, path: string): Promise<undefined> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_WRITE }).invoke(
			FOUNDATION_FILESYSTEM_CAPABILITIES.DELETE,
			{ path },
		);
	},

	move(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		sourcePath: string,
		destinationDirectory: string,
	): Promise<undefined> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_WRITE }).invoke(
			FOUNDATION_FILESYSTEM_CAPABILITIES.MOVE,
			{ sourcePath, destinationDirectory },
		);
	},

	createDirectory(this: PluginCapabilitySessionAccess, sessionId: string, path: string): Promise<undefined> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_WRITE }).invoke(
			FOUNDATION_FILESYSTEM_CAPABILITIES.CREATE_DIRECTORY,
			{ path },
		);
	},

	listFilesRecursive(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		path: string,
	): Promise<FilesystemFileRef[]> {
		return this.client(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.FILESYSTEM_READ }).invoke(
			FOUNDATION_FILESYSTEM_CAPABILITIES.LIST_FILES_RECURSIVE,
			{ path },
		);
	},
};

export type PluginFilesystemMethods = typeof pluginFilesystemMethods;
