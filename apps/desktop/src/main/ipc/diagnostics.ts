import { ipcMain, shell } from "electron";
import { buildDiagnosticsBundle } from "../diagnostics-bundle.js";
import { getAppLogBaseDir } from "../logger.js";

const DIAGNOSTICS_CHANNELS = {
	EXPORT: "vetta:diagnostics:export",
	GET_LOG_DIR: "vetta:diagnostics:get-log-dir",
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

	return () => {
		ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.EXPORT);
		ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.GET_LOG_DIR);
	};
}
