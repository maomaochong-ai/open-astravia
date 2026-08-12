import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";

export type DesktopAgentMode = "work" | "coding";

/**
 * 会话级工作模式的落盘位置：与会话文件同目录的一份 sessionId → mode 索引。
 * 放在会话目录里，删项目 / 清会话目录时随之消失，不需要额外清理路径。
 */
const STORE_FILE_NAME = "agent-modes.json";

/**
 * 没有记录的历史会话统一按 "work" 恢复。这里必须是常量而不是「当前默认模式」：
 * 否则用户在新会话页改默认值，会连带改写所有老会话的模式，正是本次要消除的行为。
 */
export const LEGACY_SESSION_AGENT_MODE: DesktopAgentMode = "work";

export function normalizeDesktopAgentMode(value: unknown): DesktopAgentMode {
	return value === "coding" ? "coding" : "work";
}

export function resolveAgentModeStorePath(sessionPath: string): string {
	return join(dirname(sessionPath), STORE_FILE_NAME);
}

function sessionKey(sessionPath: string): string {
	return basename(sessionPath).replace(/\.jsonl$/i, "");
}

async function readStore(storePath: string): Promise<Record<string, DesktopAgentMode>> {
	try {
		const raw: unknown = JSON.parse(await readFile(storePath, "utf8"));
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
		const result: Record<string, DesktopAgentMode> = {};
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			if (value === "work" || value === "coding") result[key] = value;
		}
		return result;
	} catch {
		return {};
	}
}

/** 读取该会话创建时固化的工作模式；没有记录返回 undefined（调用方回落常量，不回落全局默认）。 */
export async function readSessionAgentMode(sessionPath: string): Promise<DesktopAgentMode | undefined> {
	const store = await readStore(resolveAgentModeStorePath(sessionPath));
	return store[sessionKey(sessionPath)];
}

/** 固化该会话的工作模式。已有记录不覆盖：会话内模式不可变。 */
export async function recordSessionAgentMode(sessionPath: string, mode: DesktopAgentMode): Promise<void> {
	const storePath = resolveAgentModeStorePath(sessionPath);
	const store = await readStore(storePath);
	const key = sessionKey(sessionPath);
	if (store[key] === mode) return;
	if (store[key] !== undefined) return;
	await atomicWriteJSONAsync(storePath, { ...store, [key]: mode });
}
