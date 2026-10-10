import { getProjectMemoryPath } from "@astravia/coding-agent/config";
import { NodeTextFileStorage } from "@astravia/runtime-node/host";
import type { MemoryFileSnapshot, MemoryFilesSnapshot, MemoryScope } from "../../preload/api-types/memory.js";

export interface MemoryFilePaths {
	user: string;
	/** 无会话 cwd 时为 null：没有项目就不存在项目级记忆文件。 */
	project: string | null;
}

/**
 * 解析两个作用域各自的 MEMORY.md 路径。用户级路径由调用方注入（IPC 层传
 * `getUserMemoryPath()`），使单元测试可以指向临时目录而不触碰真实的 `~/.astravia`。
 */
export function resolveMemoryFilePaths(userMemoryFile: string, cwd: string): MemoryFilePaths {
	return { user: userMemoryFile, project: cwd ? getProjectMemoryPath(cwd) : null };
}

export function resolveMemoryScopePath(paths: MemoryFilePaths, scope: MemoryScope): string {
	if (scope === "user") return paths.user;
	if (!paths.project) throw new Error("project scope requires a project directory");
	return paths.project;
}

function readMemoryFile(path: string): MemoryFileSnapshot {
	const content = new NodeTextFileStorage(path).read();
	// 读取失败与内容为空是两件事：前者让界面提示文件尚未创建，后者是用户主动清空。
	return { path, content: content ?? "", exists: content !== undefined };
}

export function readMemoryFiles(paths: MemoryFilePaths): MemoryFilesSnapshot {
	return {
		user: readMemoryFile(paths.user),
		project: paths.project ? readMemoryFile(paths.project) : null,
	};
}

export function writeMemoryFile(path: string, content: string): void {
	new NodeTextFileStorage(path).replace(content);
}
