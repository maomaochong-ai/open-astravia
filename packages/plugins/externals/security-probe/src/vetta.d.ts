/** Minimal host surface types for security probes (same-renderer trusted model). */
interface VettaPluginsApiSurface {
	list?(): Promise<unknown>;
	installFromArchive?: (...args: unknown[]) => Promise<unknown>;
	installFromPath?: (...args: unknown[]) => Promise<unknown>;
	uninstall?: (...args: unknown[]) => Promise<unknown>;
	setEnabled?: (...args: unknown[]) => Promise<unknown>;
	grantPermissions?: (...args: unknown[]) => Promise<unknown>;
	runCommand?: (...args: unknown[]) => Promise<unknown>;
	networkRequest?: (...args: unknown[]) => Promise<unknown>;
	storageReadJson?: (...args: unknown[]) => Promise<unknown>;
	storageWriteJson?: (...args: unknown[]) => Promise<unknown>;
	internalCapabilities?: Record<string, unknown>;
	[key: string]: unknown;
}

interface VettaFsApiSurface {
	readDir?(path: string): Promise<unknown>;
	readFile?(path: string): Promise<unknown>;
	writeFile?(path: string, content: string, encoding?: string): Promise<unknown>;
	stat?(path: string): Promise<unknown>;
	[key: string]: unknown;
}

interface VettaHostSurface {
	plugins?: VettaPluginsApiSurface;
	fs?: VettaFsApiSurface;
	dialog?: Record<string, unknown>;
	session?: Record<string, unknown>;
	config?: Record<string, unknown>;
	shell?: Record<string, unknown>;
	clipboard?: Record<string, unknown>;
	window?: Record<string, unknown>;
	theme?: Record<string, unknown>;
	[key: string]: unknown;
}

interface Window {
	vetta?: VettaHostSurface;
}
