import { isAbsolute, resolve } from "node:path";

/**
 * 原生拖拽（Electron `startDrag`，Windows 上是 CF_HDROP）的路径准备。
 *
 * 为什么单独一层：文件树一次可以选中成百上千个条目（拖一个目录出来更是如此），
 * 而这条通道原先复用了「文件搬运计划」的 100 项上限，超限直接抛错——
 * 表现就是**拖大目录时拖不动了**，用户只好改成复制路径粘贴进输入框。
 * 拖拽本身没有这个限制，上限只用来挡住病态输入。
 */
export const MAX_NATIVE_DRAG_ITEMS = 20_000;

/** 去重并解析成绝对路径。非法输入抛出带原因的错误，由调用方记日志。 */
export function normalizeNativeDragPaths(rawPaths: unknown, limit: number = MAX_NATIVE_DRAG_ITEMS): string[] {
	if (!Array.isArray(rawPaths)) throw new Error("Invalid paths");
	if (rawPaths.length === 0) throw new Error("Invalid paths");
	if (rawPaths.length > limit) {
		throw new Error(`Invalid paths: ${rawPaths.length} items exceeds the drag limit of ${limit}`);
	}
	const resolved = new Set<string>();
	for (const item of rawPaths) {
		if (typeof item !== "string" || !item.trim() || !isAbsolute(item)) throw new Error("Invalid paths");
		resolved.add(resolve(item));
	}
	return [...resolved];
}
