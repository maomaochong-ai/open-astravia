/**
 * 插件活动面板标签卡的「上栏记录」（cwd → 条目表，见 ADR-0026）。
 *
 * 一个 tab 的可见性是三态：插件显式说过 → 听插件的；没说过 → 用 contribution 的
 * `initiallyVisible`（缺省 true，注册即上栏，老插件不改也出得来）。所以条目表要
 * 能表达「显式隐藏」，用 `-` 前缀编码：
 *   `git:changes`   → 显式上栏
 *   `-git:changes`  → 显式下栏
 * 无前缀条目沿用旧格式，历史 localStorage 记录直接兼容。
 */
const HIDDEN_PREFIX = "-";

/** 插件对该 tab 的显式态；null = 插件没表过态，交给 initiallyVisible 决定。 */
export function explicitTabVisibility(list: readonly string[], key: string): boolean | null {
	if (list.includes(key)) return true;
	if (list.includes(`${HIDDEN_PREFIX}${key}`)) return false;
	return null;
}

/**
 * 写入显式态，返回新 map；已经是该状态时返回 null（免掉一次无谓的 store 写入 +
 * localStorage 落盘）。同一个 key 的正反条目互斥。
 */
export function withPluginTabVisibility(
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
