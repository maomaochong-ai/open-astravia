/**
 * 会话标签的纯领域模型。
 *
 * 标签是「用户资产」而非会话内容：它不写进会话文件（append-only JSONL），
 * 而是以软链的方式落在 ~/.vetta/desktop-app/conversation-tags.json —— 这样
 * 只读来源的会话同样可被标注，重装应用也不丢失。
 *
 * 这里只放不依赖 fs/electron 的纯函数，主进程仓库与渲染进程共用同一套语义。
 */

export const CONVERSATION_TAGS_SCHEMA_VERSION = 1;

/** 标签变更广播通道：主进程在每次写盘后推送最新快照。 */
export const CONVERSATION_TAGS_CHANGED_CHANNEL = "vetta:conversation-tags:changed";

export interface ConversationTag {
	id: string;
	name: string;
	/** 归一化后的 `#rrggbb` 小写色值，用于菜单与筛选项的 Dot。 */
	color: string;
	/** epoch ms；菜单与下拉一律按它升序，保证位置稳定、不随使用频率跳动。 */
	createdAt: number;
}

export interface ConversationTagsSnapshot {
	tags: readonly ConversationTag[];
	/** 会话磁盘路径 → 标签 id 列表。以会话为键，因为渲染列表是最高频路径。 */
	assignments: Readonly<Record<string, readonly string[]>>;
}

/** 预设 8 色，语义顺序对齐 Finder：红/橙/黄/绿/蓝/紫/灰/粉。 */
export const CONVERSATION_TAG_PRESET_COLORS = [
	"#ff5f57",
	"#ff9f0a",
	"#ffd60a",
	"#32d74b",
	"#0a84ff",
	"#bf5af0",
	"#98989d",
	"#ff375f",
] as const;

export const CONVERSATION_TAG_DEFAULT_COLOR = CONVERSATION_TAG_PRESET_COLORS[0];

const TAG_NAME_MAX_LENGTH = 64;

export function emptyConversationTags(): ConversationTagsSnapshot {
	return { tags: [], assignments: {} };
}

/** 接受 `#rgb` / `#rrggbb`（大小写不限），归一化为小写 `#rrggbb`；非法返回 null。 */
export function normalizeTagColor(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const raw = value.trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
	if (/^#[0-9a-f]{3}$/.test(raw)) {
		return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
	}
	return null;
}

/** 名称必填（空名在筛选下拉里就是一行空白），但允许重名——颜色才是主要区分手段。 */
export function normalizeTagName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = value.trim().slice(0, TAG_NAME_MAX_LENGTH);
	return name.length > 0 ? name : null;
}

function sanitizeTag(value: unknown): ConversationTag | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const input = value as Partial<ConversationTag>;
	if (typeof input.id !== "string" || input.id.trim().length === 0) return null;
	const name = normalizeTagName(input.name);
	if (name === null) return null;
	const color = normalizeTagColor(input.color);
	if (color === null) return null;
	const createdAt =
		typeof input.createdAt === "number" && Number.isFinite(input.createdAt) && input.createdAt > 0
			? input.createdAt
			: 0;
	return { id: input.id, name, color, createdAt };
}

function sortByCreatedAt(tags: ConversationTag[]): ConversationTag[] {
	return [...tags].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * 从磁盘内容还原快照。任何结构性损坏都退化为「丢弃该条目」而非整文件作废，
 * 免得一个坏标签让用户的全部标注凭空消失。
 */
export function parseConversationTagsFile(value: unknown): ConversationTagsSnapshot {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyConversationTags();
	const input = value as { version?: unknown; tags?: unknown; assignments?: unknown };
	if (input.version !== CONVERSATION_TAGS_SCHEMA_VERSION) return emptyConversationTags();

	const tags: ConversationTag[] = [];
	const seen = new Set<string>();
	if (Array.isArray(input.tags)) {
		for (const raw of input.tags) {
			const tag = sanitizeTag(raw);
			if (!tag || seen.has(tag.id)) continue;
			seen.add(tag.id);
			tags.push(tag);
		}
	}

	const assignments: Record<string, string[]> = {};
	if (typeof input.assignments === "object" && input.assignments !== null && !Array.isArray(input.assignments)) {
		for (const [sessionPath, rawIds] of Object.entries(input.assignments as Record<string, unknown>)) {
			if (sessionPath.trim().length === 0 || !Array.isArray(rawIds)) continue;
			const ids: string[] = [];
			for (const id of rawIds) {
				// 指向已不存在的标签的引用直接丢弃；死路径则保留——会话文件可能
				// 只是暂时不可见（外部盘未挂载），据此清理是危险的。
				if (typeof id !== "string" || !seen.has(id) || ids.includes(id)) continue;
				ids.push(id);
			}
			if (ids.length > 0) assignments[sessionPath] = ids;
		}
	}

	return { tags: sortByCreatedAt(tags), assignments };
}

export function serializeConversationTags(snapshot: ConversationTagsSnapshot): {
	version: typeof CONVERSATION_TAGS_SCHEMA_VERSION;
	tags: readonly ConversationTag[];
	assignments: Readonly<Record<string, readonly string[]>>;
} {
	return {
		version: CONVERSATION_TAGS_SCHEMA_VERSION,
		tags: snapshot.tags,
		assignments: snapshot.assignments,
	};
}

export function conversationTagIds(snapshot: ConversationTagsSnapshot, sessionPath: string): readonly string[] {
	return snapshot.assignments[sessionPath] ?? [];
}

export function conversationCountForTag(snapshot: ConversationTagsSnapshot, tagId: string): number {
	let count = 0;
	for (const ids of Object.values(snapshot.assignments)) if (ids.includes(tagId)) count += 1;
	return count;
}

export interface CreateConversationTagInput {
	id: string;
	name: string;
	color: string;
	createdAt: number;
	/** 传入时同时给该会话打上新标签——「新标签」入口的默认语义。 */
	sessionPath?: string;
}

export function createConversationTag(
	snapshot: ConversationTagsSnapshot,
	input: CreateConversationTagInput,
): ConversationTagsSnapshot {
	const name = normalizeTagName(input.name);
	const color = normalizeTagColor(input.color);
	if (name === null || color === null) return snapshot;
	const tag: ConversationTag = { id: input.id, name, color, createdAt: input.createdAt };
	const next: ConversationTagsSnapshot = {
		tags: sortByCreatedAt([...snapshot.tags, tag]),
		assignments: snapshot.assignments,
	};
	return input.sessionPath
		? setConversationTagAssigned(next, { sessionPath: input.sessionPath, tagId: tag.id, assigned: true })
		: next;
}

export function updateConversationTag(
	snapshot: ConversationTagsSnapshot,
	input: { id: string; name?: string; color?: string },
): ConversationTagsSnapshot {
	const name = input.name === undefined ? undefined : normalizeTagName(input.name);
	const color = input.color === undefined ? undefined : normalizeTagColor(input.color);
	if (name === null || color === null) return snapshot;
	let changed = false;
	const tags = snapshot.tags.map((tag) => {
		if (tag.id !== input.id) return tag;
		changed = true;
		return { ...tag, name: name ?? tag.name, color: color ?? tag.color };
	});
	return changed ? { tags, assignments: snapshot.assignments } : snapshot;
}

/** 删除标签会连带摘掉全部会话上的该标签，但不触碰会话本身。 */
export function deleteConversationTag(snapshot: ConversationTagsSnapshot, tagId: string): ConversationTagsSnapshot {
	if (!snapshot.tags.some((tag) => tag.id === tagId)) return snapshot;
	const assignments: Record<string, readonly string[]> = {};
	for (const [sessionPath, ids] of Object.entries(snapshot.assignments)) {
		const kept = ids.filter((id) => id !== tagId);
		if (kept.length > 0) assignments[sessionPath] = kept;
	}
	return { tags: snapshot.tags.filter((tag) => tag.id !== tagId), assignments };
}

export function setConversationTagAssigned(
	snapshot: ConversationTagsSnapshot,
	input: { sessionPath: string; tagId: string; assigned: boolean },
): ConversationTagsSnapshot {
	if (!snapshot.tags.some((tag) => tag.id === input.tagId)) return snapshot;
	const current = snapshot.assignments[input.sessionPath] ?? [];
	const has = current.includes(input.tagId);
	if (has === input.assigned) return snapshot;
	const assignments = { ...snapshot.assignments };
	if (input.assigned) assignments[input.sessionPath] = [...current, input.tagId];
	else {
		const kept = current.filter((id) => id !== input.tagId);
		if (kept.length > 0) assignments[input.sessionPath] = kept;
		else delete assignments[input.sessionPath];
	}
	return { tags: snapshot.tags, assignments };
}

/** 会话被删除时调用，清掉它留下的孤儿标注。 */
export function removeConversationAssignments(
	snapshot: ConversationTagsSnapshot,
	sessionPaths: Iterable<string>,
): ConversationTagsSnapshot {
	const assignments = { ...snapshot.assignments };
	let changed = false;
	for (const sessionPath of sessionPaths) {
		if (assignments[sessionPath] === undefined) continue;
		delete assignments[sessionPath];
		changed = true;
	}
	return changed ? { tags: snapshot.tags, assignments } : snapshot;
}
