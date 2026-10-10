import { getUserMemoryPath } from "@astravia/coding-agent/config";
import { ipcMain } from "electron";
import type { MemoryFilesSnapshot, MemoryScope } from "../../preload/api-types/memory.js";
import {
	readMemoryFiles,
	resolveMemoryFilePaths,
	resolveMemoryScopePath,
	writeMemoryFile,
} from "../memory/memory-files.js";

export const MEMORY_CHANNELS = {
	READ: "astravia:memory:read",
	WRITE: "astravia:memory:write",
} as const;

function requireCwd(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) throw new Error("cwd must be a non-empty string");
	return value;
}

/** 读取时允许没有项目目录（空串），此时只返回用户级记忆。 */
function readCwd(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value !== "string") throw new Error("cwd must be a string");
	return value.trim();
}

function requireScope(value: unknown): MemoryScope {
	if (value !== "user" && value !== "project") throw new Error("scope must be one of: user, project");
	return value;
}

function requireContent(value: unknown): string {
	if (typeof value !== "string") throw new Error("content must be a string");
	return value;
}

export function registerMemoryIpc(): () => void {
	ipcMain.handle(MEMORY_CHANNELS.READ, (_event, params: unknown): MemoryFilesSnapshot => {
		const { cwd } = (params ?? {}) as { cwd?: unknown };
		return readMemoryFiles(resolveMemoryFilePaths(getUserMemoryPath(), readCwd(cwd)));
	});
	ipcMain.handle(MEMORY_CHANNELS.WRITE, (_event, params: unknown): void => {
		const { cwd, content, scope } = (params ?? {}) as { cwd?: unknown; content?: unknown; scope?: unknown };
		const resolvedScope = requireScope(scope);
		// 用户级记忆与会话无关，没有活跃会话时也要能保存。
		const paths = resolveMemoryFilePaths(getUserMemoryPath(), resolvedScope === "project" ? requireCwd(cwd) : "");
		writeMemoryFile(resolveMemoryScopePath(paths, resolvedScope), requireContent(content));
	});
	return () => {
		for (const channel of Object.values(MEMORY_CHANNELS)) ipcMain.removeHandler(channel);
	};
}
