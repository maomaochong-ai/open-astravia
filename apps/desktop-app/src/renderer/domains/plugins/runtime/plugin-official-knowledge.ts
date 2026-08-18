import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialKnowledgeApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["knowledge"] {
	const knowledge = window.vetta.plugins.internalCapabilities.knowledge;
	return {
		list: async () => {
			assertOfficial();
			return knowledge.listBases(capabilitySessionId);
		},
		fileStatuses: async () => {
			assertOfficial();
			return knowledge.listFileStatuses(capabilitySessionId);
		},
		isProcessing: async () => {
			assertOfficial();
			return knowledge.isProcessing(capabilitySessionId);
		},
		getProcessing: async () => {
			assertOfficial();
			return knowledge.getProcessing(capabilitySessionId);
		},
		create: async (name) => {
			assertOfficial();
			await knowledge.createBase(capabilitySessionId, name);
		},
		rename: async (name, newName) => {
			assertOfficial();
			await knowledge.renameBase(capabilitySessionId, name, newName);
		},
		delete: async (name) => {
			assertOfficial();
			await knowledge.deleteBase(capabilitySessionId, name);
		},
		addFiles: async (kbId, paths, move = false) => {
			assertOfficial();
			await knowledge.addFiles(capabilitySessionId, kbId, paths, move);
		},
		deleteEntry: async (kbId, relPath) => {
			assertOfficial();
			await knowledge.deleteEntry(capabilitySessionId, kbId, relPath);
		},
		scanNow: async () => {
			assertOfficial();
			return knowledge.scanNow(capabilitySessionId);
		},
		retryFailed: async () => {
			assertOfficial();
			return knowledge.retryFailed(capabilitySessionId);
		},
		setProcessing: async (data) => {
			assertOfficial();
			return knowledge.setProcessing(capabilitySessionId, data);
		},
	};
}
