import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { atomicWriteJSON } from "@vetta/toolkit/atomic-write";
import {
	type ConversationTagsSnapshot,
	type CreateConversationTagInput,
	createConversationTag,
	deleteConversationTag,
	emptyConversationTags,
	parseConversationTagsFile,
	removeConversationAssignments,
	serializeConversationTags,
	setConversationTagAssigned,
	updateConversationTag,
} from "../../shared/conversation-tags.js";

/**
 * 会话标签仓库：~/.vetta/desktop-app/conversation-tags.json 的单一写者。
 *
 * 启动读一次进内存，之后所有变更改内存再原子落盘，永不重新读盘——
 * 写入是同步的且中间没有 await，因此「读-改-写」不存在交错窗口。
 */

const DEFAULT_PATH = join(getVettaHomePath(), "desktop-app", "conversation-tags.json");

export function defaultConversationTagsPath(): string {
	return DEFAULT_PATH;
}

let cache: ConversationTagsSnapshot | null = null;
let cachePath = DEFAULT_PATH;
const listeners = new Set<(snapshot: ConversationTagsSnapshot) => void>();

function read(filePath: string): ConversationTagsSnapshot {
	if (!existsSync(filePath)) return emptyConversationTags();
	try {
		return parseConversationTagsFile(JSON.parse(readFileSync(filePath, "utf-8")) as unknown);
	} catch {
		return emptyConversationTags();
	}
}

function snapshot(filePath: string): ConversationTagsSnapshot {
	if (cache === null || cachePath !== filePath) {
		cachePath = filePath;
		cache = read(filePath);
	}
	return cache;
}

function commit(filePath: string, next: ConversationTagsSnapshot): ConversationTagsSnapshot {
	const current = snapshot(filePath);
	if (next === current) return current;
	cache = next;
	try {
		atomicWriteJSON(filePath, serializeConversationTags(next));
	} catch {
		// 落盘失败时保留内存态，避免界面回滚到旧值；下一次变更会重试写入。
	}
	for (const listener of listeners) listener(next);
	return next;
}

export function onConversationTagsChanged(listener: (snapshot: ConversationTagsSnapshot) => void): () => void {
	listeners.add(listener);
	return () => void listeners.delete(listener);
}

export function listConversationTags(filePath = DEFAULT_PATH): ConversationTagsSnapshot {
	return snapshot(filePath);
}

export function addConversationTag(
	input: Omit<CreateConversationTagInput, "id" | "createdAt"> & { id?: string; createdAt?: number },
	filePath = DEFAULT_PATH,
): ConversationTagsSnapshot {
	const current = snapshot(filePath);
	const createdAt = input.createdAt ?? nextCreatedAt(current);
	return commit(
		filePath,
		createConversationTag(current, {
			...input,
			id: input.id ?? crypto.randomUUID(),
			createdAt,
		}),
	);
}

/** 时钟不前进时仍保证新标签排在最后，和置顶排序采用同样的单调处理。 */
function nextCreatedAt(current: ConversationTagsSnapshot): number {
	let latest = 0;
	for (const tag of current.tags) latest = Math.max(latest, tag.createdAt);
	return Math.max(Date.now(), latest + 1);
}

export function renameConversationTag(
	input: { id: string; name?: string; color?: string },
	filePath = DEFAULT_PATH,
): ConversationTagsSnapshot {
	return commit(filePath, updateConversationTag(snapshot(filePath), input));
}

export function removeConversationTag(tagId: string, filePath = DEFAULT_PATH): ConversationTagsSnapshot {
	return commit(filePath, deleteConversationTag(snapshot(filePath), tagId));
}

export function assignConversationTag(
	input: { sessionPath: string; tagId: string; assigned: boolean },
	filePath = DEFAULT_PATH,
): ConversationTagsSnapshot {
	return commit(filePath, setConversationTagAssigned(snapshot(filePath), input));
}

export function forgetConversations(
	sessionPaths: readonly string[],
	filePath = DEFAULT_PATH,
): ConversationTagsSnapshot {
	return commit(filePath, removeConversationAssignments(snapshot(filePath), sessionPaths));
}

/** 仅供测试：丢弃内存缓存，下次访问重新读盘。 */
export function resetConversationTagsCache(): void {
	cache = null;
	cachePath = DEFAULT_PATH;
}
