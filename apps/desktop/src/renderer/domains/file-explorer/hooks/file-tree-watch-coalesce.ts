/** VS Code RunOnceScheduler-style coalesce for directory watcher bursts. */
export const FILE_TREE_WATCH_COALESCE_MS = 100;

export interface DirectoryReloadScheduler {
	notify(dirPath: string): void;
	dispose(): void;
}

/**
 * 目录监听通道里「同一个目录」的判定键。
 *
 * 主进程收到 watchDir 后先 `path.resolve` 归一化，广播回来的也是归一化过的路径；
 * 渲染层这一侧却用项目里存的原始写法做键（Windows 上可能是 `C:/…`、小写盘符、
 * 带尾分隔符，macOS 上可能带尾斜杠或经过符号链接）。直接比字符串会让 `dir-changed`
 * 全部落空，表现为「工作区已经打开，可目录树一直不跟着变」。
 *
 * 键只用于比较和登记，真正发给 IPC 的仍是渲染层自己那份路径，缓存键因此不受影响。
 */
export function watchPathKey(path: string): string {
	const unified = path.replace(/\\/g, "/");
	const trimmed = unified.replace(/\/+$/, "");
	if (!trimmed) return unified.startsWith("/") ? "/" : "";
	// Windows 盘符路径大小写不敏感，盘符与路径都可能被不同来源写成不同形式。
	return /^[A-Za-z]:\//.test(trimmed) ? trimmed.toLowerCase() : trimmed;
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
