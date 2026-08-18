import {
	recordKnowledgeBaseClearWiki,
	recordKnowledgeBaseFilesAdded,
	recordKnowledgeBaseFilesDeleted,
	recordKnowledgeBaseManualScan,
	recordKnowledgeBaseRetryFailed,
} from "../app-monitor/app-monitor-service.js";
import {
	type KnowledgeBaseConfig,
	normalizeKnowledgeBase,
	readDesktopConfig,
	writeDesktopConfig,
} from "../config/desktop-config-store.js";
import { getAppLogger } from "../logger.js";
import {
	isKnowledgeProcessing,
	reloadKnowledgePoller,
	retryFailedKnowledge,
	runKnowledgeRound,
	scheduleKnowledgeBaseCurrentSnapshot,
} from "./poller.js";
import {
	addFilesToKnowledgeBase,
	createKnowledgeBase,
	deleteKnowledgeBase,
	deleteKnowledgeEntry,
	listKnowledgeBases,
	listKnowledgeDir,
	renameKnowledgeBase,
	renameKnowledgeEntry,
} from "./raws-fs.js";
import { getKnowledgeFileStatuses } from "./status.js";
import { clearAllWiki, clearProcessingRecords, deleteWikiForEntries } from "./wiki-ops.js";

const log = getAppLogger("knowledge-service");

export interface KnowledgeProcessingUpdate {
	readonly enabled?: boolean;
	readonly pollIntervalMinutes?: number;
	readonly processingModelKey?: string | null;
	readonly processingModelReasoningLevel?: string | null;
	readonly agentConcurrency?: number;
	readonly ocrConcurrency?: number;
}

export class KnowledgeService {
	async scanNow(): Promise<{ skipped: boolean; reason?: "no-model" }> {
		log.info("manual scan triggered");
		recordKnowledgeBaseManualScan();
		const kb = (await readDesktopConfig()).knowledgeBase;
		return runKnowledgeRound(kb?.processingModelKey, kb?.agentConcurrency ?? 3, kb?.processingModelReasoningLevel);
	}

	async retryFailed(): Promise<{ skipped: boolean; reason?: "no-model" }> {
		log.info("retry failed knowledge triggered");
		recordKnowledgeBaseRetryFailed();
		const kb = (await readDesktopConfig()).knowledgeBase;
		return retryFailedKnowledge(kb?.processingModelKey, kb?.agentConcurrency ?? 3, kb?.processingModelReasoningLevel);
	}

	async reload(): Promise<void> {
		await reloadKnowledgePoller();
		scheduleKnowledgeBaseCurrentSnapshot();
	}

	isProcessing(): boolean {
		return isKnowledgeProcessing();
	}

	listBases(): ReturnType<typeof listKnowledgeBases> {
		return listKnowledgeBases();
	}

	listDirectory(kbId: string, relPath: string): ReturnType<typeof listKnowledgeDir> {
		return listKnowledgeDir(kbId, relPath);
	}

	listFileStatuses(): ReturnType<typeof getKnowledgeFileStatuses> {
		return getKnowledgeFileStatuses();
	}

	async addFiles(kbId: string, sourcePaths: string[], move: boolean): Promise<void> {
		await addFilesToKnowledgeBase(kbId, sourcePaths, move);
		recordKnowledgeBaseFilesAdded(sourcePaths.length);
		scheduleKnowledgeBaseCurrentSnapshot();
	}

	async deleteEntry(kbId: string, relPath: string): Promise<void> {
		await deleteKnowledgeEntry(kbId, relPath);
		recordKnowledgeBaseFilesDeleted(1);
		scheduleKnowledgeBaseCurrentSnapshot();
	}

	async renameEntry(kbId: string, relPath: string, newName: string): Promise<void> {
		await renameKnowledgeEntry(kbId, relPath, newName);
		scheduleKnowledgeBaseCurrentSnapshot();
	}

	async createBase(name: string): Promise<void> {
		await createKnowledgeBase(name);
		scheduleKnowledgeBaseCurrentSnapshot();
	}

	async deleteBase(name: string): Promise<void> {
		await deleteKnowledgeBase(name);
		scheduleKnowledgeBaseCurrentSnapshot();
	}

	async renameBase(oldName: string, newName: string): Promise<void> {
		await renameKnowledgeBase(oldName, newName);
		scheduleKnowledgeBaseCurrentSnapshot();
	}

	async clearWiki(): Promise<void> {
		log.info("clear all wiki triggered");
		await clearAllWiki();
		recordKnowledgeBaseClearWiki();
		scheduleKnowledgeBaseCurrentSnapshot();
	}

	async clearRecords(): Promise<void> {
		log.info("clear processing records triggered");
		await clearProcessingRecords();
	}

	deleteWiki(kbId: string, relPaths: string[]): Promise<void> {
		return deleteWikiForEntries(kbId, relPaths);
	}

	async getProcessing(): Promise<KnowledgeBaseConfig> {
		return { ...(await readDesktopConfig()).knowledgeBase };
	}

	async setProcessing(data: KnowledgeProcessingUpdate): Promise<KnowledgeBaseConfig> {
		const config = await readDesktopConfig();
		const knowledgeBase = { ...config.knowledgeBase };
		if (data.enabled !== undefined) knowledgeBase.enabled = data.enabled;
		if (data.pollIntervalMinutes !== undefined) knowledgeBase.pollIntervalMinutes = data.pollIntervalMinutes;
		if (data.processingModelKey === null) delete knowledgeBase.processingModelKey;
		else if (data.processingModelKey !== undefined) knowledgeBase.processingModelKey = data.processingModelKey;
		if (data.processingModelReasoningLevel === null) delete knowledgeBase.processingModelReasoningLevel;
		else if (data.processingModelReasoningLevel !== undefined) {
			knowledgeBase.processingModelReasoningLevel = data.processingModelReasoningLevel;
		}
		if (data.agentConcurrency !== undefined) knowledgeBase.agentConcurrency = data.agentConcurrency;
		if (data.ocrConcurrency !== undefined) knowledgeBase.ocrConcurrency = data.ocrConcurrency;

		const normalized = normalizeKnowledgeBase(knowledgeBase);
		await writeDesktopConfig({ ...config, knowledgeBase: normalized });
		await this.reload();
		return { ...normalized };
	}
}

let instance: KnowledgeService | undefined;

export function getKnowledgeService(): KnowledgeService {
	if (!instance) instance = new KnowledgeService();
	return instance;
}
