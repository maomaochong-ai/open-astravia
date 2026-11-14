/**
 * 顶栏动作的显示偏好：哪些留在胶囊里、顺序如何。
 *
 * 为什么需要：动作数量随功能增长，而「哪几个常用」因人而异——写代码的人常开终端，
 * 写文档的人常开导出。用一套固定集合加宽度收纳只能保证「不溢出」，不能保证
 * 「常用的一直在」。这里把顺序与是否显示交给用户，并只在本地保存。
 *
 * 存储约定（与其它本地偏好一致）：
 * - 键为 `astravia-header-actions`，值为动作 id 的数组；
 * - 只保存 id，不保存按钮本身——动作由宿主每次重新提供，插件卸载后残留的 id 被忽略；
 * - 读不出来或格式不对时回落到空数组，由调用方按默认顺序渲染。
 */
export const HEADER_ACTIONS_STORAGE_KEY = "astravia-header-actions";

/** 单个动作的显示偏好。 */
export interface HeaderActionPreference {
	/** 按用户期望的顺序排列的动作 id。 */
	readonly order: readonly string[];
	/** 被用户主动隐藏的动作 id（仍在「更多」里可见，只是不进胶囊）。 */
	readonly hidden: readonly string[];
}

export const EMPTY_HEADER_ACTION_PREFERENCE: HeaderActionPreference = { order: [], hidden: [] };

function normalizeIds(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of value) {
		if (typeof item !== "string" || item.length === 0) continue;
		// 去重：同一动作重复出现会让「调整」模式出现两格同样的按钮。
		if (seen.has(item)) continue;
		seen.add(item);
		result.push(item);
	}
	return result;
}

/** 从存储值解析偏好；任何异常都回到空偏好，不让坏数据影响顶栏渲染。 */
export function parseHeaderActionPreference(raw: unknown): HeaderActionPreference {
	if (typeof raw !== "string" || raw.length === 0) return EMPTY_HEADER_ACTION_PREFERENCE;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return EMPTY_HEADER_ACTION_PREFERENCE;
		const record = parsed as { order?: unknown; hidden?: unknown };
		return { order: normalizeIds(record.order), hidden: normalizeIds(record.hidden) };
	} catch {
		return EMPTY_HEADER_ACTION_PREFERENCE;
	}
}

export function serializeHeaderActionPreference(preference: HeaderActionPreference): string {
	return JSON.stringify({ order: preference.order, hidden: preference.hidden });
}

/**
 * 按偏好重排动作。
 *
 * 三条规则：
 * 1. 偏好里有、宿主也提供的动作排到前面（按偏好的相对顺序）；
 * 2. 宿主新提供、偏好里没有的动作按原顺序排在后面——升级后新增的按钮不会凭空消失；
 * 3. 偏好里有、宿主已不提供的 id 直接忽略（插件被卸载）。
 */
export function applyHeaderActionOrder<T extends { readonly id: string }>(
	items: readonly T[],
	order: readonly string[],
): T[] {
	if (order.length === 0) return [...items];
	const byId = new Map(items.map((item) => [item.id, item]));
	const ordered: T[] = [];
	for (const id of order) {
		const item = byId.get(id);
		if (!item) continue;
		ordered.push(item);
		byId.delete(id);
	}
	// 剩下的保持宿主给的顺序接在后面。
	for (const item of items) {
		if (byId.has(item.id)) ordered.push(item);
	}
	return ordered;
}

/** 拖动排序：把 `fromId` 移到 `toId` 的位置。两者相同时原样返回。 */
export function moveHeaderAction(order: readonly string[], fromId: string, toId: string): string[] {
	if (fromId === toId) return [...order];
	const next = [...order];
	const fromIndex = next.indexOf(fromId);
	const toIndex = next.indexOf(toId);
	// 未记录过的动作先补齐：拖动发生在完整列表上，而不是只有偏好里那几个。
	if (fromIndex < 0 || toIndex < 0) return next;
	next.splice(fromIndex, 1);
	next.splice(toIndex, 0, fromId);
	return next;
}
