import {
	DOMAIN_KNOWLEDGE_CAPABILITIES,
	type KnowledgeBase,
	type KnowledgeFileStatuses,
	type KnowledgeProcessingSettings,
	type KnowledgeScanResult,
} from "@vetta/capability-sdk";
import type { PluginCapabilitySessionAccess } from "../types.js";

export const pluginKnowledgeMethods = {
	listKnowledgeBases(this: PluginCapabilitySessionAccess, sessionId: string): Promise<KnowledgeBase[]> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_KNOWLEDGE_CAPABILITIES.LIST_BASES, {});
	},

	listKnowledgeFileStatuses(this: PluginCapabilitySessionAccess, sessionId: string): Promise<KnowledgeFileStatuses> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_KNOWLEDGE_CAPABILITIES.LIST_FILE_STATUSES, {});
	},

	isKnowledgeProcessing(this: PluginCapabilitySessionAccess, sessionId: string): Promise<boolean> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_KNOWLEDGE_CAPABILITIES.GET_PROCESSING_STATUS, {});
	},

	getKnowledgeProcessing(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
	): Promise<KnowledgeProcessingSettings> {
		return this.client(sessionId, { official: true }).invoke(
			DOMAIN_KNOWLEDGE_CAPABILITIES.GET_PROCESSING_SETTINGS,
			{},
		);
	},

	createKnowledgeBase(this: PluginCapabilitySessionAccess, sessionId: string, name: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_KNOWLEDGE_CAPABILITIES.CREATE_BASE, { name });
	},

	renameKnowledgeBase(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		name: string,
		newName: string,
	): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_KNOWLEDGE_CAPABILITIES.RENAME_BASE, {
			name,
			newName,
		});
	},

	deleteKnowledgeBase(this: PluginCapabilitySessionAccess, sessionId: string, name: string): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_KNOWLEDGE_CAPABILITIES.DELETE_BASE, { name });
	},

	addKnowledgeFiles(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		kbId: string,
		paths: string[],
		move: boolean,
	): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_KNOWLEDGE_CAPABILITIES.ADD_FILES, {
			kbId,
			paths,
			move,
		});
	},

	deleteKnowledgeEntry(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		kbId: string,
		relPath: string,
	): Promise<undefined> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_KNOWLEDGE_CAPABILITIES.DELETE_ENTRY, {
			kbId,
			relPath,
		});
	},

	scanKnowledgeNow(this: PluginCapabilitySessionAccess, sessionId: string): Promise<KnowledgeScanResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_KNOWLEDGE_CAPABILITIES.SCAN_NOW, {});
	},

	retryFailedKnowledge(this: PluginCapabilitySessionAccess, sessionId: string): Promise<KnowledgeScanResult> {
		return this.client(sessionId, { official: true }).invoke(DOMAIN_KNOWLEDGE_CAPABILITIES.RETRY_FAILED, {});
	},

	setKnowledgeProcessing(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		data: unknown,
	): Promise<KnowledgeProcessingSettings> {
		const input = DOMAIN_KNOWLEDGE_CAPABILITIES.SET_PROCESSING_SETTINGS.parseInput({ data });
		return this.client(sessionId, { official: true }).invoke(
			DOMAIN_KNOWLEDGE_CAPABILITIES.SET_PROCESSING_SETTINGS,
			input,
		);
	},
};

export type PluginKnowledgeMethods = typeof pluginKnowledgeMethods;
