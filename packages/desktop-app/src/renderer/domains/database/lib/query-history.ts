/**
 * SQL 查询历史（V3-③）：localStorage 持久化 + 最近 N 条去重置顶。
 * 纯函数便于单测；localStorage 读写全部 try/catch 静默失败（监控/存储异常不影响查询功能）。
 */

export interface QueryHistoryEntry {
	readonly id: string;
	readonly connection: string;
	readonly sql: string;
	readonly at: number;
}

const STORAGE_KEY = "astravia:db:query-history";

/** 历史上限：最近 N 条（与 dbx QueryHistory 的「最近 N 条持久化」语义对齐）。 */
export const QUERY_HISTORY_LIMIT = 50;

function isQueryHistoryEntry(value: unknown): value is QueryHistoryEntry {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.id === "string" &&
		typeof entry.connection === "string" &&
		typeof entry.sql === "string" &&
		typeof entry.at === "number"
	);
}

function makeId(now: number): string {
	return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 插入一条历史：相同 connection + sql 去重置顶；超限截断。返回新数组（不修改入参）。 */
export function pushQueryHistory(
	entries: readonly QueryHistoryEntry[],
	connection: string,
	sql: string,
	now: number = Date.now(),
): QueryHistoryEntry[] {
	const trimmed = sql.trim();
	if (!trimmed) return [...entries];
	const rest = entries.filter((entry) => !(entry.connection === connection && entry.sql.trim() === trimmed));
	const next: QueryHistoryEntry = { id: makeId(now), connection, sql: trimmed, at: now };
	return [next, ...rest].slice(0, QUERY_HISTORY_LIMIT);
}

/** 删除指定 id 的一条历史（对齐 dbx 历史面板单条删除）。返回新数组；id 不存在则原样返回。 */
export function removeQueryHistory(entries: readonly QueryHistoryEntry[], id: string): QueryHistoryEntry[] {
	const next = entries.filter((entry) => entry.id !== id);
	return next.length === entries.length ? [...entries] : next;
}

/** 读取历史：非法 JSON / 非数组 / 脏条目全部跳过，返回合法条目的最近 N 条。 */
export function loadQueryHistory(): QueryHistoryEntry[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isQueryHistoryEntry).slice(0, QUERY_HISTORY_LIMIT);
	} catch {
		return [];
	}
}

export function saveQueryHistory(entries: readonly QueryHistoryEntry[]): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
	} catch {
		// 存储不可用时静默失败（查询功能不受影响）。
	}
}

export function clearQueryHistory(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// 静默失败。
	}
}
