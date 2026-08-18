/**
 * 侧边栏导航布局（置顶区 / 收纳区）的纯逻辑。
 *
 * 术语：
 * - **置顶区（pinned）**：侧边栏左上方常驻的导航项。「新会话」永远锁在第一位，
 *   其余位置由用户排布，含「新会话」在内**最多 {@link MAX_PINNED_NAV_ITEMS} 个**。
 * - **收纳区（more）**：「更多」弹出菜单里的次要入口，顺序同样可拖拽。
 *
 * 目录（catalog）由内置入口 + 插件贡献的工作区视图共同组成，随插件启停变化；
 * 布局只存 key 顺序，所以卸载插件不会破坏其它项的位置，装回来也能复位。
 */

/** 「新会话」的导航 key，永远锁定在置顶区第一位，不可拖走也不可收纳。 */
export const NEW_SESSION_NAV_KEY = "new-session";

/** 置顶区容量上限（含「新会话」）。 */
export const MAX_PINNED_NAV_ITEMS = 5;

export const SIDEBAR_NAV_LAYOUT_STORAGE_KEY = "vetta-sidebar-nav-layout";

export interface SidebarNavLayout {
	/** 置顶区 key 顺序（不含「新会话」——它由渲染层强制置顶）。 */
	readonly pinned: readonly string[];
	/** 收纳区 key 顺序。 */
	readonly more: readonly string[];
}

export interface ResolvedSidebarNavLayout {
	/** 置顶区最终顺序，第一项恒为「新会话」。 */
	readonly pinned: readonly string[];
	readonly more: readonly string[];
}

export const EMPTY_SIDEBAR_NAV_LAYOUT: SidebarNavLayout = { pinned: [], more: [] };

function dedupe(keys: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const key of keys) {
		if (typeof key !== "string" || key.length === 0 || key === NEW_SESSION_NAV_KEY) continue;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(key);
	}
	return result;
}

/**
 * 把持久化布局与当前目录对账：
 * - 目录里没有的 key 丢弃（插件卸载 / 入口下线）；
 * - 目录里新出现、布局没记过的 key 追加到**收纳区末尾**（新入口不抢占顶部位置）；
 * - 置顶区超出容量的溢出项按顺序退回收纳区最前，保证不会静默丢失入口。
 *
 * `defaultPinned` 只在「布局里从没出现过这个 key」时才决定它落在哪一区——
 * 用户一旦把某项收纳过，重启后就不会被默认值拉回置顶。
 */
export function resolveSidebarNavLayout(
	catalogKeys: readonly string[],
	layout: SidebarNavLayout,
	defaultPinned: readonly string[] = [],
): ResolvedSidebarNavLayout {
	const catalog = new Set(catalogKeys.filter((key) => key !== NEW_SESSION_NAV_KEY));
	const known = new Set<string>([...layout.pinned, ...layout.more]);
	const pinned = dedupe(layout.pinned).filter((key) => catalog.has(key));
	const more = dedupe(layout.more).filter((key) => catalog.has(key));
	const placed = new Set<string>([...pinned, ...more]);

	// 目录里的新 key：按目录顺序补位，默认置顶集合的进置顶区，其余进收纳区。
	for (const key of catalogKeys) {
		if (key === NEW_SESSION_NAV_KEY || placed.has(key)) continue;
		if (!known.has(key) && defaultPinned.includes(key)) pinned.push(key);
		else more.push(key);
		placed.add(key);
	}

	// 「新会话」占一格，用户可自由排布的置顶位是 MAX - 1。
	const capacity = Math.max(0, MAX_PINNED_NAV_ITEMS - 1);
	const overflow = pinned.splice(capacity);
	return { pinned: [NEW_SESSION_NAV_KEY, ...pinned], more: [...overflow, ...more] };
}

/** 置顶区是否还有空位（含「新会话」计数）。 */
export function canPinMore(resolved: ResolvedSidebarNavLayout): boolean {
	return resolved.pinned.length < MAX_PINNED_NAV_ITEMS;
}

function withoutKey(keys: readonly string[], key: string): string[] {
	return keys.filter((candidate) => candidate !== key);
}

/**
 * 把某项从收纳区移到置顶区末尾。已在置顶区、是「新会话」、或置顶区已满时原样返回
 * ——满了直接忽略而不是挤掉别人，避免用户在不知情时丢掉一个入口。
 */
export function pinNavKey(resolved: ResolvedSidebarNavLayout, key: string): ResolvedSidebarNavLayout {
	if (key === NEW_SESSION_NAV_KEY) return resolved;
	if (resolved.pinned.includes(key)) return resolved;
	if (!resolved.more.includes(key)) return resolved;
	if (!canPinMore(resolved)) return resolved;
	return { pinned: [...resolved.pinned, key], more: withoutKey(resolved.more, key) };
}

/** 把某项从置顶区收回收纳区最前（收回来立刻能看见）。「新会话」不可收纳。 */
export function unpinNavKey(resolved: ResolvedSidebarNavLayout, key: string): ResolvedSidebarNavLayout {
	if (key === NEW_SESSION_NAV_KEY) return resolved;
	if (!resolved.pinned.includes(key)) return resolved;
	return { pinned: withoutKey(resolved.pinned, key), more: [key, ...resolved.more] };
}

function moveWithin(keys: readonly string[], fromIndex: number, toIndex: number): string[] {
	const next = [...keys];
	const [moved] = next.splice(fromIndex, 1);
	next.splice(toIndex, 0, moved);
	return next;
}

/**
 * 在某一区内重排。`toKey` 为 null 表示移到该区末尾。跨区拖拽请用
 * {@link moveNavKeyToRegion}，它会顺带处理容量与「新会话」锁位。
 */
export function reorderNavKeys(
	resolved: ResolvedSidebarNavLayout,
	region: "pinned" | "more",
	fromKey: string,
	toKey: string | null,
): ResolvedSidebarNavLayout {
	const keys = region === "pinned" ? resolved.pinned : resolved.more;
	const fromIndex = keys.indexOf(fromKey);
	if (fromIndex < 0) return resolved;
	if (region === "pinned" && fromKey === NEW_SESSION_NAV_KEY) return resolved;
	let toIndex = toKey === null ? keys.length - 1 : keys.indexOf(toKey);
	if (toIndex < 0 || toIndex === fromIndex) return resolved;
	// 「新会话」锁死首位：任何想插到它前面的拖拽都落到它后面。
	if (region === "pinned" && toIndex === 0) toIndex = 1;
	if (toIndex === fromIndex) return resolved;
	const next = moveWithin(keys, fromIndex, toIndex);
	return region === "pinned" ? { ...resolved, pinned: next } : { ...resolved, more: next };
}

/**
 * 跨区移动：把 `key` 放进 `region`，落在 `beforeKey` 之前（null = 末尾）。
 * 置顶区已满时拒绝移入（返回原布局），由调用方给出提示。
 */
export function moveNavKeyToRegion(
	resolved: ResolvedSidebarNavLayout,
	key: string,
	region: "pinned" | "more",
	beforeKey: string | null = null,
): ResolvedSidebarNavLayout {
	if (key === NEW_SESSION_NAV_KEY) return resolved;
	const inPinned = resolved.pinned.includes(key);
	const inMore = resolved.more.includes(key);
	if (!inPinned && !inMore) return resolved;
	if ((region === "pinned" && inPinned) || (region === "more" && inMore)) {
		return reorderNavKeys(resolved, region, key, beforeKey);
	}
	if (region === "pinned" && !canPinMore(resolved)) return resolved;

	const pinned = withoutKey(resolved.pinned, key);
	const more = withoutKey(resolved.more, key);
	const target = region === "pinned" ? pinned : more;
	const insertAt = beforeKey === null ? target.length : target.indexOf(beforeKey);
	const index = insertAt < 0 ? target.length : insertAt;
	// 置顶区首位是锁死的「新会话」，插入位置至少为 1。
	target.splice(region === "pinned" ? Math.max(1, index) : index, 0, key);
	return { pinned, more };
}

/** 落盘形态（置顶区去掉恒定的「新会话」）。 */
export function toStoredSidebarNavLayout(resolved: ResolvedSidebarNavLayout): SidebarNavLayout {
	return { pinned: withoutKey(resolved.pinned, NEW_SESSION_NAV_KEY), more: [...resolved.more] };
}

/** 宽松解析持久化内容；任何形状不对的部分退化为空，绝不抛错。 */
export function parseSidebarNavLayout(raw: unknown): SidebarNavLayout {
	if (raw == null || typeof raw !== "object") return EMPTY_SIDEBAR_NAV_LAYOUT;
	const record = raw as Record<string, unknown>;
	const pinned = Array.isArray(record.pinned) ? dedupe(record.pinned as string[]) : [];
	const more = Array.isArray(record.more) ? dedupe(record.more as string[]) : [];
	// 同一 key 不能同时出现在两区：以置顶区为准。
	const pinnedSet = new Set(pinned);
	return { pinned, more: more.filter((key) => !pinnedSet.has(key)) };
}
