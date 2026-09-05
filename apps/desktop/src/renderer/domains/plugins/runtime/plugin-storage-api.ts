import type { PluginStorageApi } from "@vetta-org/plugin-sdk";

export interface PluginStorageBridge {
	storageList(sessionId: string, prefix?: string): ReturnType<PluginStorageApi["list"]>;
	storageReadFile(
		sessionId: string,
		path: string,
		encoding: "utf8" | "base64",
	): ReturnType<PluginStorageApi["readFile"]>;
	storageReadSnapshot(
		sessionId: string,
		paths: readonly string[],
		encoding: "utf8" | "base64",
	): ReturnType<PluginStorageApi["readSnapshot"]>;
	storageCommit(
		sessionId: string,
		changes: Parameters<PluginStorageApi["commit"]>[0],
		expectedRevision?: string,
	): ReturnType<PluginStorageApi["commit"]>;
	storagePutBlob(
		sessionId: string,
		input: Parameters<PluginStorageApi["putBlob"]>[0],
	): ReturnType<PluginStorageApi["putBlob"]>;
	storagePutBlobFromFile(
		sessionId: string,
		input: Parameters<PluginStorageApi["putBlobFromFile"]>[0],
	): ReturnType<PluginStorageApi["putBlobFromFile"]>;
	storageReadBlob(sessionId: string, id: string): ReturnType<PluginStorageApi["readBlob"]>;
	storageGetBlobRef(sessionId: string, id: string): ReturnType<PluginStorageApi["getBlobRef"]>;
}

/** Pure renderer bridge: permission ownership stays with the caller, while argument forwarding is contract-tested here. */
export function createPluginStorageApi(
	capabilitySessionId: string,
	bridge: PluginStorageBridge,
	requireRead: () => void,
	requireWrite: () => void,
): PluginStorageApi {
	return {
		list: (prefix) => {
			requireRead();
			return bridge.storageList(capabilitySessionId, prefix);
		},
		readFile: (path, encoding) => {
			requireRead();
			return bridge.storageReadFile(capabilitySessionId, path, encoding);
		},
		writeFile: (path, data, encoding) => {
			requireWrite();
			return bridge.storageCommit(capabilitySessionId, [{ type: "write", path, data, encoding }]);
		},
		commit: (changes, options) => {
			requireWrite();
			return bridge.storageCommit(capabilitySessionId, changes, options?.expectedRevision);
		},
		readSnapshot: (paths, encoding) => {
			requireRead();
			return bridge.storageReadSnapshot(capabilitySessionId, paths, encoding);
		},
		putBlob: (input) => {
			requireWrite();
			return bridge.storagePutBlob(capabilitySessionId, input);
		},
		putBlobFromFile: (input) => {
			requireWrite();
			return bridge.storagePutBlobFromFile(capabilitySessionId, input);
		},
		readBlob: (id) => {
			requireRead();
			return bridge.storageReadBlob(capabilitySessionId, id);
		},
		getBlobRef: (id) => {
			requireRead();
			return bridge.storageGetBlobRef(capabilitySessionId, id);
		},
	};
}
