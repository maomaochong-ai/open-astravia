/** Minimal host surface types for security probes (same-renderer trusted model). */
interface AstraviaPluginsApiSurface {
	list?(): Promise<unknown>;
	installFromArchive?: (...args: unknown[]) => Promise<unknown>;
	installFromPath?: (...args: unknown[]) => Promise<unknown>;
	uninstall?: (...args: unknown[]) => Promise<unknown>;
	setEnabled?: (...args: unknown[]) => Promise<unknown>;
	grantPermissions?: (...args: unknown[]) => Promise<unknown>;
	runCommand?: (...args: unknown[]) => Promise<unknown>;
	networkRequest?: (...args: unknown[]) => Promise<unknown>;
	storageReadFile?: (...args: unknown[]) => Promise<unknown>;
	storageCommit?: (...args: unknown[]) => Promise<unknown>;
	internalCapabilities?: Record<string, unknown>;
	[key: string]: unknown;
}

interface AstraviaFsApiSurface {
	readDir?(path: string): Promise<unknown>;
	readFile?(path: string): Promise<unknown>;
	writeFile?(path: string, content: string, encoding?: string): Promise<unknown>;
	stat?(path: string): Promise<unknown>;
	[key: string]: unknown;
}

interface AstraviaHostSurface {
	plugins?: AstraviaPluginsApiSurface;
	fs?: AstraviaFsApiSurface;
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
	astravia?: AstraviaHostSurface;
}
