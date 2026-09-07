import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";

/**
 * 单 Agent 会话的绑定落盘位置：与会话文件同目录的一份 sessionId → agentProfileId 索引。
 * 与 agent-modes.json 同构——放在会话目录里，删项目 / 清会话目录时随之消失，不需要额外清理路径。
 *
 * 这里只存**身份**，不存能力快照：会话每次打开都按当前 profile 重新解析白名单，
 * 因此改 Agent 的技能 / MCP 后重开会话即生效，与 Team 成员跟随 profile 的行为一致。
 */
const STORE_FILE_NAME = "agent-bindings.json";

export function resolveAgentBindingStorePath(sessionPath: string): string {
	return join(dirname(sessionPath), STORE_FILE_NAME);
}

function sessionKey(sessionPath: string): string {
	return basename(sessionPath).replace(/\.jsonl$/i, "");
}

async function readStore(storePath: string): Promise<Record<string, string>> {
	try {
		const raw: unknown = JSON.parse(await readFile(storePath, "utf8"));
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
		const result: Record<string, string> = {};
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			if (typeof value === "string" && value.length > 0) result[key] = value;
		}
		return result;
	} catch {
		return {};
	}
}

/** 读取该会话绑定的 Agent Profile id；没有绑定返回 undefined（普通对话）。 */
export async function readSessionAgentBinding(sessionPath: string): Promise<string | undefined> {
	const store = await readStore(resolveAgentBindingStorePath(sessionPath));
	return store[sessionKey(sessionPath)];
}

/**
 * 固化该会话归属的 Agent。已有记录不覆盖：会话属于哪个 Agent 是会话身份，中途不可改。
 * 想换 Agent 只能新建会话——这与 agent-modes 的会话内不可变是同一套心智。
 */
export async function recordSessionAgentBinding(sessionPath: string, agentProfileId: string): Promise<void> {
	const storePath = resolveAgentBindingStorePath(sessionPath);
	const store = await readStore(storePath);
	const key = sessionKey(sessionPath);
	if (store[key] !== undefined) return;
	await atomicWriteJSONAsync(storePath, { ...store, [key]: agentProfileId });
}
