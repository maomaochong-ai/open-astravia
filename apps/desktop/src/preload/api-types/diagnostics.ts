export interface DiagnosticsExportResult {
	zipPath: string;
}

export interface DesktopDiagnosticsApi {
	exportDiagnosticsPackage(): Promise<DiagnosticsExportResult>;
	getLogDir(): Promise<string>;
	/** 渲染层诊断事件（long task 探针等）交主进程写进诊断日志，随导出包回收。 */
	logRendererEvent(scope: string, fields: unknown): Promise<void>;
}
