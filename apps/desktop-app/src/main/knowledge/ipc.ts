/**
 * 知识库相关 IPC：
 * - 手动「立即整理」（起一轮加工）、保存设置后重载轮询器。
 * - raws ↔ UI 的读（list/tree）与写（增删改，走特权互斥写）。
 * 缓存重建无需手动触发——由加工轮收尾与轮询器启动自愈自动完成。
 */

import { ipcMain } from "electron";
import { getKnowledgeService } from "./knowledge-service.js";

const CHANNELS = {
	SCAN_NOW: "vetta:kb:scan-now",
	RETRY_FAILED: "vetta:kb:retry-failed",
	RELOAD: "vetta:kb:reload",
	IS_PROCESSING: "vetta:kb:is-processing",
	LIST: "vetta:kb:list",
	LIST_DIR: "vetta:kb:list-dir",
	STATUSES: "vetta:kb:statuses",
	ADD_FILES: "vetta:kb:add-files",
	DELETE_ENTRY: "vetta:kb:delete-entry",
	RENAME_ENTRY: "vetta:kb:rename-entry",
	CREATE: "vetta:kb:create",
	DELETE: "vetta:kb:delete",
	RENAME: "vetta:kb:rename",
	CLEAR_WIKI: "vetta:kb:clear-wiki",
	CLEAR_RECORDS: "vetta:kb:clear-records",
	DELETE_WIKI: "vetta:kb:delete-wiki",
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
