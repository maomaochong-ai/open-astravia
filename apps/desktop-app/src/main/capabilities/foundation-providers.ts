import { bindCapability, type CapabilityRegistry } from "@vetta/capability-runtime";
import {
	CAPABILITY_ERROR_CODES,
	CapabilityError,
	type CapabilityJsonMap,
	type CapabilityJsonValue,
	type Disposable,
	FOUNDATION_ARTIFACT_CAPABILITIES,
	FOUNDATION_FILESYSTEM_CAPABILITIES,
	FOUNDATION_GATEWAY_CAPABILITIES,
	FOUNDATION_NETWORK_CAPABILITIES,
	FOUNDATION_STORAGE_CAPABILITIES,
	parseCapabilityJsonValue,
} from "@vetta/capability-sdk";
import { persistArtifact } from "../artifacts/artifact-persistence.js";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import {
	assertFilesystemRealPathWithinProject,
	createFilesystemDirectory,
	deleteFilesystemPath,
	listFilesystemFilesRecursive,
	moveFilesystemPath,
	readFilesystemBinaryFile,
	readFilesystemDirectory,
	readFilesystemFile,
	renameFilesystemPath,
	statFilesystemPath,
	writeFilesystemFile,
} from "../filesystem/filesystem-service.js";
import { requestVettaGateway as requestGateway } from "../gateway/vetta-gateway-service.js";
import type { JobManager } from "../jobs/job-manager.js";
import { listPlugins } from "../plugins/plugin-catalog.js";
import { requestForPlugin as requestNetwork } from "../plugins/plugin-network-service.js";
import {
	getPluginBlobRef as getNamespacedBlobRef,
	listPluginFiles as listNamespacedFiles,
	putPluginBlob as putNamespacedBlob,
	putPluginBlobFromFile as putNamespacedBlobFromFile,
	readPluginBlob as readNamespacedBlob,
	readPluginFile as readNamespacedFile,
	readPluginJson as readNamespacedJson,
	writePluginFile as writeNamespacedFile,
	writePluginJson as writeNamespacedJson,
} from "../plugins/plugin-storage-service.js";
import {
	clearThemeStorage,
	getThemeStorageData,
	removeThemeStorageValue,
	setThemeStorageValue,
} from "../themes/theme-data-store.js";
import { themeIdFromStorageCapabilityNamespace } from "./integrations/theme-capability-adapter.js";
import { registerDesktopJobProvider } from "./job-provider.js";

const FOUNDATION_STORAGE_PROVIDER_OWNER = "vetta.foundation.storage";
const FOUNDATION_FILESYSTEM_PROVIDER_OWNER = "vetta.foundation.filesystem";
const FOUNDATION_NETWORK_STORAGE_PROVIDER_OWNER = "vetta.foundation.network-storage";
const FOUNDATION_ARTIFACT_PROVIDER_OWNER = "vetta.foundation.artifact";

interface NamespacedStorageBackend {
	clear(namespace: string): Promise<CapabilityJsonMap>;
	getAll(namespace: string): Promise<CapabilityJsonMap>;
	remove(namespace: string, key: string): Promise<CapabilityJsonMap>;
	set(namespace: string, key: string, value: CapabilityJsonValue): Promise<CapabilityJsonMap>;
}

const desktopStorageBackend: NamespacedStorageBackend = {
	async getAll(namespace) {
		return getThemeStorageData(themeIdFromStorageCapabilityNamespace(namespace));
	},
	async set(namespace, key, value) {
		return setThemeStorageValue(themeIdFromStorageCapabilityNamespace(namespace), key, value);
	},
	async remove(namespace, key) {
		return removeThemeStorageValue(themeIdFromStorageCapabilityNamespace(namespace), key);
	},
	async clear(namespace) {
		return clearThemeStorage(themeIdFromStorageCapabilityNamespace(namespace));
	},
};

function assertNotAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.ABORTED, "Capability invocation was aborted");
	}
}

export function registerDesktopFoundationProviders(
	registry: CapabilityRegistry,
	artifacts: ArtifactStore,
	jobs: JobManager,
): Disposable {
	const artifactRegistration = registry.registerOwner(FOUNDATION_ARTIFACT_PROVIDER_OWNER, [
		bindCapability(FOUNDATION_ARTIFACT_CAPABILITIES.PERSIST, {
			execute: async (input, context) => {
				assertNotAborted(context.signal);
				return persistArtifact(artifacts, input);
			},
		}),
		bindCapability(FOUNDATION_ARTIFACT_CAPABILITIES.RELEASE, {
			execute: async ({ ownerId, artifactId }, context) => {
				assertNotAborted(context.signal);
				await artifacts.release(ownerId, artifactId);
			},
		}),
	]);
	const jobRegistration = registerDesktopJobProvider(registry, jobs);
	const storageRegistration = registry.registerOwner(FOUNDATION_STORAGE_PROVIDER_OWNER, [
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.GET_ALL, {
			execute: async ({ namespace }, context) => {
				assertNotAborted(context.signal);
				return desktopStorageBackend.getAll(namespace);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.SET, {
			execute: async ({ namespace, key, value }, context) => {
				assertNotAborted(context.signal);
				return desktopStorageBackend.set(namespace, key, value);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.REMOVE, {
			execute: async ({ namespace, key }, context) => {
				assertNotAborted(context.signal);
				return desktopStorageBackend.remove(namespace, key);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.CLEAR, {
			execute: async ({ namespace }, context) => {
				assertNotAborted(context.signal);
				return desktopStorageBackend.clear(namespace);
			},
		}),
	]);
	const filesystemRegistration = registry.registerOwner(FOUNDATION_FILESYSTEM_PROVIDER_OWNER, [
		bindCapability(FOUNDATION_FILESYSTEM_CAPABILITIES.READ_DIRECTORY, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				await assertFilesystemRealPathWithinProject(path);
				return readFilesystemDirectory(path);
			},
		}),
		bindCapability(FOUNDATION_FILESYSTEM_CAPABILITIES.READ_FILE, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				await assertFilesystemRealPathWithinProject(path);
				return readFilesystemFile(path);
			},
		}),
		bindCapability(FOUNDATION_FILESYSTEM_CAPABILITIES.READ_BINARY_FILE, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				await assertFilesystemRealPathWithinProject(path);
				return readFilesystemBinaryFile(path);
			},
		}),
		bindCapability(FOUNDATION_FILESYSTEM_CAPABILITIES.WRITE_FILE, {
			execute: async ({ path, content, encoding }, context) => {
				assertNotAborted(context.signal);
				await assertFilesystemRealPathWithinProject(path);
				await writeFilesystemFile(path, content, encoding);
			},
		}),
		bindCapability(FOUNDATION_FILESYSTEM_CAPABILITIES.STAT, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				await assertFilesystemRealPathWithinProject(path);
				return statFilesystemPath(path);
			},
		}),
		bindCapability(FOUNDATION_FILESYSTEM_CAPABILITIES.RENAME, {
			execute: async ({ oldPath, newPath }, context) => {
				assertNotAborted(context.signal);
				await assertFilesystemRealPathWithinProject(oldPath);
				await assertFilesystemRealPathWithinProject(newPath);
				await renameFilesystemPath(oldPath, newPath);
			},
		}),
		bindCapability(FOUNDATION_FILESYSTEM_CAPABILITIES.DELETE, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				await assertFilesystemRealPathWithinProject(path);
				await deleteFilesystemPath(path);
			},
		}),
		bindCapability(FOUNDATION_FILESYSTEM_CAPABILITIES.MOVE, {
			execute: async ({ sourcePath, destinationDirectory }, context) => {
				assertNotAborted(context.signal);
				await assertFilesystemRealPathWithinProject(sourcePath);
				await assertFilesystemRealPathWithinProject(destinationDirectory);
				await moveFilesystemPath(sourcePath, destinationDirectory);
			},
		}),
		bindCapability(FOUNDATION_FILESYSTEM_CAPABILITIES.CREATE_DIRECTORY, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				await assertFilesystemRealPathWithinProject(path);
				await createFilesystemDirectory(path);
			},
		}),
		bindCapability(FOUNDATION_FILESYSTEM_CAPABILITIES.LIST_FILES_RECURSIVE, {
			execute: async ({ path }, context) => {
				assertNotAborted(context.signal);
				await assertFilesystemRealPathWithinProject(path);
				return listFilesystemFilesRecursive(path);
			},
		}),
	]);
	const networkStorageRegistration = registry.registerOwner(FOUNDATION_NETWORK_STORAGE_PROVIDER_OWNER, [
		bindCapability(FOUNDATION_NETWORK_CAPABILITIES.REQUEST, {
			execute: async ({ namespace, request }, context) => {
				assertNotAborted(context.signal);
				const plugin = listPlugins().find((candidate) => candidate.id === namespace);
				if (!plugin || !plugin.enabled) throw new Error(`Network policy namespace is not enabled: ${namespace}`);
				const response = await requestNetwork(
					plugin,
					request as unknown as Parameters<typeof requestNetwork>[1],
					context.signal as Parameters<typeof requestNetwork>[2],
				);
				return parseCapabilityJsonValue(response);
			},
		}),
		bindCapability(FOUNDATION_GATEWAY_CAPABILITIES.REQUEST, {
			execute: async ({ request }, context) => {
				assertNotAborted(context.signal);
				const response = await requestGateway(
					request as unknown as Parameters<typeof requestGateway>[0],
					context.signal,
				);
				return parseCapabilityJsonValue(response);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.READ_JSON, {
			execute: async ({ namespace, key }, context) => {
				assertNotAborted(context.signal);
				return (await readNamespacedJson<CapabilityJsonValue>(namespace, key)) ?? null;
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.WRITE_JSON, {
			execute: async ({ namespace, key, value }, context) => {
				assertNotAborted(context.signal);
				await writeNamespacedJson(namespace, key, value);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.LIST, {
			execute: async ({ namespace, prefix }, context) => {
				assertNotAborted(context.signal);
				return listNamespacedFiles(namespace, prefix);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.READ_FILE, {
			execute: async ({ namespace, path }, context) => {
				assertNotAborted(context.signal);
				return readNamespacedFile(namespace, path);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.WRITE_FILE, {
			execute: async ({ namespace, path, data }, context) => {
				assertNotAborted(context.signal);
				await writeNamespacedFile(namespace, path, data);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB, {
			execute: async ({ namespace, blob }, context) => {
				assertNotAborted(context.signal);
				return putNamespacedBlob(namespace, blob);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.PUT_BLOB_FROM_FILE, {
			execute: async ({ namespace, blob }, context) => {
				assertNotAborted(context.signal);
				return putNamespacedBlobFromFile(namespace, blob);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.READ_BLOB, {
			execute: async ({ namespace, id }, context) => {
				assertNotAborted(context.signal);
				return readNamespacedBlob(namespace, id);
			},
		}),
		bindCapability(FOUNDATION_STORAGE_CAPABILITIES.GET_BLOB_REF, {
			execute: async ({ namespace, id }, context) => {
				assertNotAborted(context.signal);
				return getNamespacedBlobRef(namespace, id);
			},
		}),
	]);
	return {
		dispose: () => {
			networkStorageRegistration.dispose();
			filesystemRegistration.dispose();
			storageRegistration.dispose();
			jobRegistration.dispose();
			artifactRegistration.dispose();
		},
	};
}
