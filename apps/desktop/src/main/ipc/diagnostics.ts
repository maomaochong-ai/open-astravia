import { ipcMain, shell } from "electron";
import { buildDiagnosticsBundle } from "../diagnostics-bundle.js";
import { getAppLogBaseDir, writeAppLog } from "../logger.js";

const DIAGNOSTICS_CHANNELS = {
	EXPORT: "astravia:diagnostics:export",
	GET_LOG_DIR: "astravia:diagnostics:get-log-dir",
	LOG_RENDERER_EVENT: "astravia:diagnostics:log-renderer-event",
} as const;

export { DIAGNOSTICS_CHANNELS };

export interface DiagnosticsExportResult {
	zipPath: string;
}

export function registerDiagnosticsIpc(): () => void {
	ipcMain.handle(DIAGNOSTICS_CHANNELS.EXPORT, async (): Promise<DiagnosticsExportResult> => {
		const { zipPath } = await buildDiagnosticsBundle();
		shell.showItemInFolder(zipPath);
		return { zipPath };
	});

	ipcMain.handle(DIAGNOSTICS_CHANNELS.GET_LOG_DIR, (): string => getAppLogBaseDir());

	// 渲染层诊断事件（long task 探针等）经此落进诊断日志，随「导出诊断包」一起回收。
	// scope 只用于归类（如 "long-task"），主进程不信任渲染层的任意内容，先做长度钳制。
	ipcMain.handle(DIAGNOSTICS_CHANNELS.LOG_RENDERER_EVENT, (_event, scope: unknown, fields: unknown): void => {
		if (typeof scope !== "string" || scope.length === 0 || scope.length > 64) return;
		writeAppLog("warn", `renderer:${scope}`, fields);
	});

	return () => {
		ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.EXPORT);
		ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.GET_LOG_DIR);
		ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.LOG_RENDERER_EVENT);
	};
}
