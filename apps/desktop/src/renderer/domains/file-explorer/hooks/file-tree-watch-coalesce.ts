/** VS Code RunOnceScheduler-style coalesce for directory watcher bursts. */
export const FILE_TREE_WATCH_COALESCE_MS = 100;

export interface DirectoryReloadScheduler {
	notify(dirPath: string): void;
	dispose(): void;
}

export function createDirectoryReloadScheduler(
	reload: (dirPath: string) => void,
	delayMs: number = FILE_TREE_WATCH_COALESCE_MS,
): DirectoryReloadScheduler {
	const pending = new Map<string, ReturnType<typeof setTimeout>>();
	return {
		notify(dirPath: string) {
			const previous = pending.get(dirPath);
			if (previous !== undefined) clearTimeout(previous);
			pending.set(
				dirPath,
				setTimeout(() => {
					pending.delete(dirPath);
					reload(dirPath);
				}, delayMs),
			);
		},
		dispose() {
			for (const timer of pending.values()) clearTimeout(timer);
			pending.clear();
		},
	};
}
