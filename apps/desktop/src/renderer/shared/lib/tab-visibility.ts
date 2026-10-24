/**
 * 活动面板标签卡「显式可见性记录」的编码：cwd → 条目表。
 *
 * 一个 tab 的可见性是三态：显式上栏 / 显式下栏 / 没表过态（交给 definition 的
 * `initiallyVisible`）。条目表用 `-` 前缀表达显式下栏：
 *   `git:changes`   → 显式上栏
 *   `-git:changes`  → 显式下栏
 * 无前缀条目沿用旧格式，历史 localStorage 记录直接兼容。
 *
 * 内置与插件 tab 共用这套记录：插件用它表达「还没 attach」，内置用它表达「用户从
 * 「+」菜单把它添加上来」（`initiallyVisible: false` 的内置面板默认不上栏，见 ADR-0026）。
 */
const HIDDEN_PREFIX = "-";

/** 该 tab 的显式态；null = 没表过态，交给 initiallyVisible 决定。 */
export function explicitTabVisibility(list: readonly string[], key: string): boolean | null {
	if (list.includes(key)) return true;
	if (list.includes(`${HIDDEN_PREFIX}${key}`)) return false;
	return null;
}

/**
 * 写入显式态，返回新 map；已经是该状态时返回 null（免掉一次无谓的 store 写入 +
 * localStorage 落盘）。同一个 key 的正反条目互斥。
 */
export function withTabVisibility(
	map: ReadonlyMap<string, string[]>,
	cwd: string,
	key: string,
	visible: boolean,
): Map<string, string[]> | null {
	const list = map.get(cwd) ?? [];
	if (explicitTabVisibility(list, key) === visible) return null;
	const hiddenKey = `${HIDDEN_PREFIX}${key}`;
	const rest = list.filter((entry) => entry !== key && entry !== hiddenKey);
	const next = new Map(map);
	next.set(cwd, [...rest, visible ? key : hiddenKey]);
	return next;
}
