import type {
	RegisteredFileExplorerContextMenuAction,
	RegisteredFileExplorerDecorationProvider,
	RegisteredFileExplorerToolbarAction,
} from "@shared/store/atoms";
import type {
	PluginFileExplorerDecoration,
	PluginFileExplorerEntry,
	PluginFileExplorerWhen,
} from "@vetta-org/plugin-sdk";

function extensionOf(name: string): string {
	const index = name.lastIndexOf(".");
	return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : "";
}

export function matchesFileExplorerWhen(entry: PluginFileExplorerEntry, when?: PluginFileExplorerWhen): boolean {
	if (!when) return true;
	if (when.resourceType === "file" && entry.isDirectory) return false;
	if (when.resourceType === "directory" && !entry.isDirectory) return false;
	if (when.extensions && when.extensions.length > 0) {
		if (entry.isDirectory) return false;
		const extension = extensionOf(entry.name);
		if (!when.extensions.some((candidate) => candidate.replace(/^\./, "").toLowerCase() === extension)) return false;
	}
	if (when.fileNames && when.fileNames.length > 0) {
		const name = entry.name.toLowerCase();
		if (!when.fileNames.some((candidate) => candidate.toLowerCase() === name)) return false;
	}
	return true;
}

export function sortFileExplorerActions<
	T extends RegisteredFileExplorerContextMenuAction | RegisteredFileExplorerToolbarAction,
>(actions: readonly T[]): T[] {
	return [...actions].sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
}

export function resolveFileExplorerDecoration(
	entry: PluginFileExplorerEntry,
	providers: readonly RegisteredFileExplorerDecorationProvider[],
): { pluginId: string; decoration: PluginFileExplorerDecoration } | null {
	const ordered = [...providers].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
	for (const provider of ordered) {
		if (!matchesFileExplorerWhen(entry, provider.when)) continue;
		try {
			const decoration = provider.provideDecoration({ ...entry });
			if (decoration) return { pluginId: provider.pluginId, decoration };
		} catch (error) {
			console.error(`Plugin ${provider.pluginId} file decoration provider failed`, error);
		}
	}
	return null;
}
