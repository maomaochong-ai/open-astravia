/**
 * 知识库相关 IPC：
 * - 手动「立即整理」（起一轮加工）、保存设置后重载轮询器。
 * - raws ↔ UI 的读（list/tree）与写（增删改，走特权互斥写）。
 * 缓存重建无需手动触发——由加工轮收尾与轮询器启动自愈自动完成。
 */

import { ipcMain } from "electron";
import { getKnowledgeService } from "./knowledge-service.js";

const CHANNELS = {
	SCAN_NOW: "astravia:kb:scan-now",
	RETRY_FAILED: "astravia:kb:retry-failed",
	RELOAD: "astravia:kb:reload",
	IS_PROCESSING: "astravia:kb:is-processing",
	LIST: "astravia:kb:list",
	LIST_DIR: "astravia:kb:list-dir",
	STATUSES: "astravia:kb:statuses",
	ADD_FILES: "astravia:kb:add-files",
	DELETE_ENTRY: "astravia:kb:delete-entry",
	RENAME_ENTRY: "astravia:kb:rename-entry",
	CREATE: "astravia:kb:create",
	DELETE: "astravia:kb:delete",
	RENAME: "astravia:kb:rename",
	CLEAR_WIKI: "astravia:kb:clear-wiki",
	CLEAR_RECORDS: "astravia:kb:clear-records",
	DELETE_WIKI: "astravia:kb:delete-wiki",
} as const;

export function registerKnowledgeIpc(): void {
	const service = getKnowledgeService();
	ipcMain.handle(CHANNELS.SCAN_NOW, () => service.scanNow());
	ipcMain.handle(CHANNELS.RETRY_FAILED, () => service.retryFailed());
	ipcMain.handle(CHANNELS.RELOAD, () => service.reload());
	ipcMain.handle(CHANNELS.IS_PROCESSING, () => service.isProcessing());
	ipcMain.handle(CHANNELS.LIST, () => service.listBases());
	ipcMain.handle(CHANNELS.LIST_DIR, (_e, kbId: string, relPath: string) => service.listDirectory(kbId, relPath ?? ""));
	ipcMain.handle(CHANNELS.STATUSES, () => service.listFileStatuses());
	ipcMain.handle(CHANNELS.ADD_FILES, (_e, kbId: string, sourcePaths: string[], move: boolean) =>
		service.addFiles(kbId, sourcePaths, move),
	);
	ipcMain.handle(CHANNELS.DELETE_ENTRY, (_e, kbId: string, relPath: string) => service.deleteEntry(kbId, relPath));
	ipcMain.handle(CHANNELS.RENAME_ENTRY, (_e, kbId: string, relPath: string, newName: string) =>
		service.renameEntry(kbId, relPath, newName),
	);
	ipcMain.handle(CHANNELS.CREATE, (_e, name: string) => service.createBase(name));
	ipcMain.handle(CHANNELS.DELETE, (_e, name: string) => service.deleteBase(name));
	ipcMain.handle(CHANNELS.RENAME, (_e, oldName: string, newName: string) => service.renameBase(oldName, newName));
	ipcMain.handle(CHANNELS.CLEAR_WIKI, () => service.clearWiki());
	ipcMain.handle(CHANNELS.CLEAR_RECORDS, () => service.clearRecords());
	ipcMain.handle(CHANNELS.DELETE_WIKI, (_e, kbId: string, relPaths: string[]) => service.deleteWiki(kbId, relPaths));
}

export function unregisterKnowledgeIpc(): void {
	for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
}
