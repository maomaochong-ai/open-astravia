import { isSubPath, pathDirname } from "@shared/lib/utils";
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
import { validateFileExplorerDecoration } from "../../plugins/runtime/plugin-file-explorer-validation";

function extensionOf(name: string): string {
	const index = name.lastIndexOf(".");
	return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : "";
}

export function matchesFileExplorerWhen(entry: PluginFileExplorerEntry, when?: PluginFileExplorerWhen): boolean {
	if (!when) return true;
	if (when.resourceType === "file" && entry.isDirectory) return false;
	if (when.resourceType === "directory" && !entry.isDirectory) return false;
	if (when.extensions && when.extensions.length > 0) {
		// 目录也参与扩展名匹配：`x.vetd/` 这类「目录包」是一份文档，不是一堆文件，
		// 插件要能像给文件那样给它挂图标和右键项。想只要文件就显式写
		// `resourceType: "file"`。
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
): { pluginId: string; priority: number; decoration: PluginFileExplorerDecoration } | null {
	const ordered = [...providers].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
	for (const provider of ordered) {
		if (!matchesFileExplorerWhen(entry, provider.when)) continue;
		try {
			const decoration = validateFileExplorerDecoration(provider.provideDecoration({ ...entry }));
			if (decoration) return { pluginId: provider.pluginId, priority: provider.priority ?? 0, decoration };
		} catch (error) {
			console.error(`Plugin ${provider.pluginId} file decoration provider failed`, error);
		}
	}
	return null;
}

/** Resolve status once per snapshot; propagation never scans disk or crosses workspace roots. */
export function createFileExplorerDecorations(
	root: string,
	cache: ReadonlyMap<string, readonly PluginFileExplorerEntry[]>,
	providers: readonly RegisteredFileExplorerDecorationProvider[],
): Map<string, NonNullable<ReturnType<typeof resolveFileExplorerDecoration>>> {
	const entries = new Map<string, PluginFileExplorerEntry>();
	for (const provider of providers)
		for (const entry of provider.changedEntries?.values() ?? []) {
			if (isSubPath(entry.path, root)) entries.set(entry.path, entry);
		}
	for (const children of cache.values()) for (const entry of children) entries.set(entry.path, entry);
	const result = new Map<string, NonNullable<ReturnType<typeof resolveFileExplorerDecoration>>>();
	for (const entry of entries.values()) {
		const resolved = resolveFileExplorerDecoration(entry, providers);
		if (resolved) result.set(entry.path, resolved);
	}
	const propagated = new Map<string, NonNullable<ReturnType<typeof resolveFileExplorerDecoration>>>();
	for (const [path, resolved] of result) {
		if (!resolved.decoration.propagate) continue;
		let parent = pathDirname(path);
		while (parent !== root && isSubPath(parent, root)) {
			const previous = propagated.get(parent);
			if (!previous || resolved.priority > previous.priority) {
				const { badge, color, tooltip } = resolved.decoration;
				propagated.set(parent, {
					pluginId: resolved.pluginId,
					priority: resolved.priority,
					decoration: { badge, color, tooltip },
				});
			}
			const next = pathDirname(parent);
			if (next === parent) break;
			parent = next;
		}
	}
	for (const [path, decoration] of propagated) if (!result.has(path)) result.set(path, decoration);
	return result;
}
