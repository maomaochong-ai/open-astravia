/** Minimal host bridge types for trusted plugins (ADR-0023). */
interface AstraviaPluginDevWatchState {
	projectDir: string;
	entryUrl?: string;
	origin?: string;
	status: "starting" | "running" | "error";
	error?: string;
}

interface AstraviaPluginsChangedEvent {
	pluginIds?: string[];
	reload?: boolean;
	reason?: "dev-ready" | "dev-update" | "dev-status";
}

interface AstraviaPluginsApi {
	list(): Promise<
		Array<{
			id: string;
			name: string;
			version: string;
			enabled: boolean;
			source: string;
			rootPath?: string;
			permissions?: string[];
			grantedPermissions?: string[];
			devWatch?: AstraviaPluginDevWatchState;
		}>
	>;
	installFromArchive(
		buffer: ArrayBuffer,
		options?: { grantedPermissions?: string[]; enable?: boolean; source?: "archive" | "remote" },
	): Promise<{ id: string; name: string; version: string }>;
	installFromPath(
		path: string,
		options?: {
			initiator?: "plugin-workbench";
			grantedPermissions?: string[];
			enable?: boolean;
		},
	): Promise<{ id: string; name: string; version: string }>;
	uninstall(id: string): Promise<void>;
	reload(id: string): Promise<unknown>;
	startDevWatch(id: string, projectDir: string): Promise<unknown>;
	stopDevWatch(id: string): Promise<void>;
	setEnabled(id: string, enabled: boolean): Promise<unknown>;
	grantPermissions(id: string, permissions: string[]): Promise<unknown>;
	onPluginsChanged(listener: (event?: AstraviaPluginsChangedEvent) => void): () => void;
	registerModeGate(pluginId: string): Promise<void>;
	setContributionMode(pluginId: string, active: boolean): Promise<void>;
}

interface AstraviaFsApi {
	readDir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
	readFile(path: string): Promise<{ content: string; encoding: string }>;
	writeFile(path: string, content: string, encoding?: string): Promise<void>;
	stat(path: string): Promise<{ size: number } | null>;
}

interface AstraviaDialogSaveCopyOptions {
	defaultFileName?: string;
	title?: string;
	filters?: Array<{ name: string; extensions: string[] }>;
}

interface AstraviaDialogApi {
	/** Native save dialog that copies an existing file; null if cancelled. */
	saveCopy(sourcePath: string, options?: AstraviaDialogSaveCopyOptions): Promise<string | null>;
}

interface Window {
	astravia: {
		plugins: AstraviaPluginsApi;
		fs: AstraviaFsApi;
		dialog: AstraviaDialogApi;
	};
}
