import type {
	Disposable,
	PluginFileExplorerChange,
	PluginFileExplorerEntry,
	PluginFileExplorerRevealOptions,
	PluginWorkspaceRoot,
} from "@vetta-org/plugin-sdk";
import { logPluginRuntimeError } from "./plugin-runtime-log";

export interface PluginFileExplorerHostAdapter {
	getWorkspaceRoot(): PluginWorkspaceRoot | null;
	getSelection(): readonly PluginFileExplorerEntry[];
	reveal(path: string, options?: PluginFileExplorerRevealOptions): Promise<void>;
	refresh(path?: string): Promise<void>;
}

let activeAdapter: PluginFileExplorerHostAdapter | null = null;

interface PluginFileExplorerListener<T> {
	readonly pluginId: string;
	readonly pluginVersion: string;
	readonly listener: (value: T) => void;
}

const selectionListeners = new Set<PluginFileExplorerListener<readonly PluginFileExplorerEntry[]>>();
const fileChangeListeners = new Set<PluginFileExplorerListener<readonly PluginFileExplorerChange[]>>();

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
	pluginId: string,
	pluginVersion: string,
	listener: (selection: readonly PluginFileExplorerEntry[]) => void,
): Disposable {
	const entry = { pluginId, pluginVersion, listener };
	selectionListeners.add(entry);
	return { dispose: () => selectionListeners.delete(entry) };
}

export function onPluginFileExplorerFilesChanged(
	pluginId: string,
	pluginVersion: string,
	listener: (changes: readonly PluginFileExplorerChange[]) => void,
): Disposable {
	const entry = { pluginId, pluginVersion, listener };
	fileChangeListeners.add(entry);
	return { dispose: () => fileChangeListeners.delete(entry) };
}

export function emitPluginFileExplorerSelectionChanged(selection: readonly PluginFileExplorerEntry[]): void {
	for (const entry of selectionListeners) {
		try {
			entry.listener(selection.map((item) => ({ ...item })));
		} catch (error) {
			logPluginRuntimeError(
				"file explorer listener failed",
				{
					pluginId: entry.pluginId,
					pluginVersion: entry.pluginVersion,
					stage: "selection-change",
				},
				error,
			);
		}
	}
}

export function emitPluginFileExplorerFilesChanged(changes: readonly PluginFileExplorerChange[]): void {
	if (changes.length === 0) return;
	for (const entry of fileChangeListeners) {
		try {
			entry.listener(changes.map((change) => ({ ...change })));
		} catch (error) {
			logPluginRuntimeError(
				"file explorer listener failed",
				{
					pluginId: entry.pluginId,
					pluginVersion: entry.pluginVersion,
					stage: "files-change",
				},
				error,
			);
		}
	}
}
