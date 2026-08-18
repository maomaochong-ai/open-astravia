import type {
	Disposable,
	PluginFileExplorerChange,
	PluginFileExplorerEntry,
	PluginFileExplorerRevealOptions,
	PluginWorkspaceRoot,
} from "@vetta-org/plugin-sdk";

export interface PluginFileExplorerHostAdapter {
	getWorkspaceRoot(): PluginWorkspaceRoot | null;
	getSelection(): readonly PluginFileExplorerEntry[];
	reveal(path: string, options?: PluginFileExplorerRevealOptions): Promise<void>;
	refresh(path?: string): Promise<void>;
}

let activeAdapter: PluginFileExplorerHostAdapter | null = null;
const selectionListeners = new Set<(selection: readonly PluginFileExplorerEntry[]) => void>();
const fileChangeListeners = new Set<(changes: readonly PluginFileExplorerChange[]) => void>();

export function bindPluginFileExplorerHost(adapter: PluginFileExplorerHostAdapter): Disposable {
	activeAdapter = adapter;
	return {
		dispose: () => {
			if (activeAdapter === adapter) activeAdapter = null;
		},
	};
}

export function getPluginFileExplorerWorkspaceRoots(): readonly PluginWorkspaceRoot[] {
	const root = activeAdapter?.getWorkspaceRoot() ?? null;
	return root ? [{ ...root }] : [];
}

export function getPluginFileExplorerSelection(): readonly PluginFileExplorerEntry[] {
	return (activeAdapter?.getSelection() ?? []).map((entry) => ({ ...entry }));
}

export async function revealPluginFileExplorerPath(
	path: string,
	options?: PluginFileExplorerRevealOptions,
): Promise<void> {
	if (!activeAdapter) throw new Error("File explorer is not available");
	await activeAdapter.reveal(path, options);
}

export async function refreshPluginFileExplorer(path?: string): Promise<void> {
	if (!activeAdapter) throw new Error("File explorer is not available");
	await activeAdapter.refresh(path);
}

export function onPluginFileExplorerSelectionChanged(
	listener: (selection: readonly PluginFileExplorerEntry[]) => void,
): Disposable {
	selectionListeners.add(listener);
	return { dispose: () => selectionListeners.delete(listener) };
}

export function onPluginFileExplorerFilesChanged(
	listener: (changes: readonly PluginFileExplorerChange[]) => void,
): Disposable {
	fileChangeListeners.add(listener);
	return { dispose: () => fileChangeListeners.delete(listener) };
}

export function emitPluginFileExplorerSelectionChanged(selection: readonly PluginFileExplorerEntry[]): void {
	for (const listener of selectionListeners) {
		try {
			listener(selection.map((entry) => ({ ...entry })));
		} catch (error) {
			console.error("Plugin file explorer selection listener threw", error);
		}
	}
}

export function emitPluginFileExplorerFilesChanged(changes: readonly PluginFileExplorerChange[]): void {
	if (changes.length === 0) return;
	for (const listener of fileChangeListeners) {
		try {
			listener(changes.map((change) => ({ ...change })));
		} catch (error) {
			console.error("Plugin file explorer change listener threw", error);
		}
	}
}
