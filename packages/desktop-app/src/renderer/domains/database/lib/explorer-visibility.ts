/**
 * 连接树可见性过滤器（#2，对齐 dbx-main ConnectionTree 的
 * 数据库/Schema/表显示过滤子集）的纯函数与本地持久化。
 *
 * 语义：
 * - 每个连接可配置两层过滤：scopes（分层连接下的 schema / database 名）
 *   与 tables（连接全局的表名）。每层都是 include + exclude 两组 glob
 *   （`*` 匹配任意串、`?` 匹配单字符，大小写不敏感）。
 * - include 为空 = 不限；否则名称须命中其中至少一个。
 *   exclude 命中即隐藏（优先级高于 include）。
 * - 过滤只影响「显示」，不改变树加载/展开/顺序状态；配置变更即时生效并
 *   持久化（键 astravia.db.explorer.v1.visibility，值按连接名索引）。
 *   会话内临时放开全部 = 清空该连接配置。
 */

/** 一组 glob 过滤规则。 */
export interface VisibilityPatterns {
	readonly include: readonly string[];
	readonly exclude: readonly string[];
}

/** 单个连接的可见性配置；缺省字段 = 该层不设限。 */
export interface ConnectionVisibility {
	/** 分层连接（schemas/databases 族）：可见的 schema / database 名。 */
	readonly scopes?: VisibilityPatterns;
	/** 表名过滤（对 flat 表与各 scope 内表统一生效）。 */
	readonly tables?: VisibilityPatterns;
}

/** 连接名 → 可见性配置。 */
export type ExplorerVisibilityMap = Readonly<Record<string, ConnectionVisibility>>;

const VISIBILITY_STORAGE_KEY = "astravia.db.explorer.v1.visibility";

function globToRegExp(glob: string): RegExp {
	const escaped = glob
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`, "i");
}

/** 名称是否命中某层过滤规则（无规则 = 可见）。 */
export function isNameVisible(name: string, patterns?: VisibilityPatterns): boolean {
	if (!patterns) return true;
	const { include = [], exclude = [] } = patterns;
	if (include.length > 0 && !include.some((p) => globToRegExp(p).test(name))) return false;
	return !exclude.some((p) => globToRegExp(p).test(name));
}

/** 过滤作用域列表（未配置时返回原数组引用）。 */
export function filterScopesByVisibility<T extends { readonly name: string }>(
	items: readonly T[],
	patterns: VisibilityPatterns | undefined,
): readonly T[] {
	if (!patterns) return items;
	const kept = items.filter((item) => isNameVisible(item.name, patterns));
	return kept.length === items.length ? items : kept;
}

/** 过滤表列表（未配置时返回原数组引用）。 */
export function filterTablesByVisibility<T extends { readonly name: string }>(
	items: readonly T[],
	patterns: VisibilityPatterns | undefined,
): readonly T[] {
	return filterScopesByVisibility(items, patterns);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function parsePatterns(value: unknown): VisibilityPatterns | undefined {
	if (typeof value !== "object" || value == null) return undefined;
	const { include, exclude } = value as { include?: unknown; exclude?: unknown };
	if (!isStringArray(include) && !isStringArray(exclude)) return undefined;
	return {
		include: isStringArray(include) ? include : [],
		exclude: isStringArray(exclude) ? exclude : [],
	};
}

/** 读取全部连接可见性配置（损坏/结构不符 → 空 map）。 */
export function loadExplorerVisibility(): ExplorerVisibilityMap {
	try {
		const raw = localStorage.getItem(VISIBILITY_STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed == null) return {};
		const map: Record<string, ConnectionVisibility> = {};
		for (const [connection, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof value !== "object" || value == null) continue;
			const { scopes, tables } = value as { scopes?: unknown; tables?: unknown };
			const scopesPatterns = parsePatterns(scopes);
			const tablesPatterns = parsePatterns(tables);
			if (scopesPatterns || tablesPatterns) {
				map[connection] = {
					...(scopesPatterns ? { scopes: scopesPatterns } : {}),
					...(tablesPatterns ? { tables: tablesPatterns } : {}),
				};
			}
		}
		return map;
	} catch {
		return {};
	}
}

/** 持久化全部可见性配置（空配置的连接键被剔除；写入失败静默忽略）。 */
export function saveExplorerVisibility(map: ExplorerVisibilityMap): void {
	try {
		const record: Record<string, ConnectionVisibility> = {};
		for (const [connection, visibility] of Object.entries(map)) {
			const empty =
				(!visibility.scopes ||
					(visibility.scopes.include.length === 0 && visibility.scopes.exclude.length === 0)) &&
				(!visibility.tables || (visibility.tables.include.length === 0 && visibility.tables.exclude.length === 0));
			if (empty) continue;
			record[connection] = visibility;
		}
		localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(record));
	} catch {
		// localStorage 不可用（隐私模式 / 配额）时静默降级，不影响树渲染。
	}
}
