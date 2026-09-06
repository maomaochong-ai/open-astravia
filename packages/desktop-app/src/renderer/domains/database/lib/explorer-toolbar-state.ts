import type { ConnectionSortOrder, TableKindFilter } from "./database-tree";

/**
 * 树工具条可持久化状态（#7）：搜索词、只看健康、对象种类过滤、连接排序。
 * 与展开/折叠状态（astravia.db.explorer.v1.*，位于 useDatabaseExplorerModel）
 * 同属"会话可恢复"体验；这里独立成键，读写失败一律静默降级为默认值。
 */
export interface ExplorerToolbarState {
	readonly searchQuery: string;
	readonly healthyOnly: boolean;
	readonly globalSearch: boolean;
	readonly sortOrder: ConnectionSortOrder;
	readonly kindFilter: TableKindFilter;
}

const STORAGE_KEY = "astravia:db:explorer-toolbar";

export const DEFAULT_EXPLORER_TOOLBAR_STATE: ExplorerToolbarState = {
	searchQuery: "",
	healthyOnly: false,
	globalSearch: true,
	sortOrder: "default",
	kindFilter: "all",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSortOrder(value: unknown): value is ConnectionSortOrder {
	return value === "default" || value === "asc" || value === "desc";
}

function isKindFilter(value: unknown): value is TableKindFilter {
	return value === "all" || value === "tables" || value === "views";
}

/** 解析本地快照并做字段级校验：任一字段损坏/缺失即回落该字段默认值（容忍手改与跨版本）。 */
export function parseExplorerToolbarState(raw: string | null): ExplorerToolbarState {
	if (!raw) return DEFAULT_EXPLORER_TOOLBAR_STATE;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed)) return DEFAULT_EXPLORER_TOOLBAR_STATE;
		return {
			searchQuery: typeof parsed.searchQuery === "string" ? parsed.searchQuery : "",
			healthyOnly: parsed.healthyOnly === true,
			// 历史快照无该字段时默认开启（保持既有"搜索即跨连接"体验）。
			globalSearch: parsed.globalSearch !== false,
			sortOrder: isSortOrder(parsed.sortOrder) ? parsed.sortOrder : "default",
			kindFilter: isKindFilter(parsed.kindFilter) ? parsed.kindFilter : "all",
		};
	} catch {
		return DEFAULT_EXPLORER_TOOLBAR_STATE;
	}
}

/** 读入持久化工具条状态（存储不可用/损坏时返回默认值）。 */
export function loadExplorerToolbarState(): ExplorerToolbarState {
	try {
		return parseExplorerToolbarState(window.localStorage.getItem(STORAGE_KEY));
	} catch {
		return DEFAULT_EXPLORER_TOOLBAR_STATE;
	}
}

/** 保存工具条状态（隐私模式/配额等写入失败静默降级为内存态）。 */
export function saveExplorerToolbarState(state: ExplorerToolbarState): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// 忽略写入失败：下次会话从默认值开始
	}
}
