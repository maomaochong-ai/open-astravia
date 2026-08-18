/**
 * 项目名判重。两个入口共用：侧边栏的「新建项目」与新会话页项目选择器里的「新建项目」。
 *
 * 判重必须发生在对话框确认那一刻——落盘链路遇到同名会静默复用已有目录，用户以为
 * 建了新项目，会话却进了旧项目，事后很难发现。
 */

/** 文件系统在 macOS / Windows 上不区分大小写，重名判断也不应该区分。 */
export function normalizeProjectName(name: string): string {
	return name.trim().toLowerCase();
}

/** 空名字交给对话框自己的必填校验，这里不报重名。 */
export function isDuplicateProjectName(name: string, takenNames: readonly string[]): boolean {
	const normalized = normalizeProjectName(name);
	if (!normalized) return false;
	return takenNames.some((taken) => normalizeProjectName(taken) === normalized);
}
