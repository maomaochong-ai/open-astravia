export interface DiagnosticsExportResult {
	zipPath: string;
}

export interface DesktopDiagnosticsApi {
	exportDiagnosticsPackage(): Promise<DiagnosticsExportResult>;
	getLogDir(): Promise<string>;
}
