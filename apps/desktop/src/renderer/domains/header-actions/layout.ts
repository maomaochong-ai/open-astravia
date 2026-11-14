/**
 * 会话页顶栏按钮组的布局：哪些动作在顶栏、哪些收纳、各自的顺序。
 *
 * 纯函数，不碰 React 与存储，方便单测。规则（插件文档 `ui-slots.md` 里对开发者公开了同一份）：
 * - 顶栏最多 `MAX_TOP_ACTIONS` 格，内置与插件共用；
 * - 用户存下来的顺序优先；已经不存在的 key（插件被停用）不参与计算，但存储里保留，装回来位置还在；
 * - 没出现在存储里的新动作：顶栏还有空位就按默认顺序插进去，没有空位进收纳末尾，绝不挤走用户已有的布局；
 * - 存储里的顶栏超过上限（上限调小、手改存储）时，多出来的从末尾起溢出到收纳最前面。
 */

export const MAX_TOP_ACTIONS = 7;

/**
 * 用户从没调整过布局时，顶栏默认显示的动作，按这个顺序从左到右；其余动作（含其它插件的）一律收纳。
 * 默认外的动作（含「从外部应用打开」这类插件动作）都进收纳；某个默认动作此刻不可用时自然缺席。
 * 用户一旦调整过，就以他存下来的布局为准，不再看这份默认。
 */
export const DEFAULT_TOP_ACTIONS: readonly string[] = ["builtin:terminal", "builtin:bottom-panel", "builtin:export"];

export interface HeaderLayout {
	readonly top: readonly string[];
	readonly tray: readonly string[];
}

export type HeaderZone = "top" | "tray";

function unique(keys: readonly string[]): string[] {
	return [...new Set(keys)];
}

/**
 * 计算此刻真正使用的布局。
 *
 * @param defaultOrder 当前所有可用动作的 key，按默认顺序排好（插件按 `order` 在前，内置在后）。
 * @param saved 用户存下来的布局；从没调整过传 `null`。
 * @param defaultTop 从没调整过（`saved` 为 `null`）时顶栏显示哪些、什么顺序；省略则按 `defaultOrder` 尽量排满顶栏。
 */
export function resolveHeaderLayout(
	defaultOrder: readonly string[],
	saved: HeaderLayout | null,
	max: number = MAX_TOP_ACTIONS,
	defaultTop?: readonly string[],
): { top: string[]; tray: string[] } {
	const available = new Set(defaultOrder);
	if (saved === null && defaultTop) {
		const top = unique(defaultTop)
			.filter((key) => available.has(key))
			.slice(0, max);
		const topSet = new Set(top);
		return { top, tray: defaultOrder.filter((key) => !topSet.has(key)) };
	}
	const top = unique(saved?.top ?? []).filter((key) => available.has(key));
	const topSet = new Set(top);
	const tray = unique(saved?.tray ?? []).filter((key) => available.has(key) && !topSet.has(key));
	const known = new Set([...top, ...tray]);
	const defaultIndex = new Map(defaultOrder.map((key, index) => [key, index] as const));

	for (const key of defaultOrder) {
		if (known.has(key)) continue;
		if (top.length < max) {
			// 插在第一个默认顺序比它靠后的顶栏项之前：没调整过的布局会原样还原默认顺序。
			const at = top.findIndex((other) => (defaultIndex.get(other) ?? 0) > (defaultIndex.get(key) ?? 0));
			top.splice(at < 0 ? top.length : at, 0, key);
		} else {
			tray.push(key);
		}
	}

	if (top.length > max) tray.unshift(...top.splice(max));
	return { top, tray };
}

/**
 * 把 `key` 移到 `zone` 的 `index` 位置，返回新布局；顶栏已满且 `key` 不在顶栏时返回 `null`（拒绝）。
 *
 * `index` 按「移动前」的列表计（拖动时看到的就是这个列表）；同区内向后移动时自动扣掉自己占的那一位。
 * 超出范围的 `index` 夹到两端。`current` 必须是 {@link resolveHeaderLayout} 的结果，
 * `previouslySaved` 里此刻不可用的 key 会按原来所在的区拼回末尾，保证停用的插件装回来时位置还在。
 */
export function moveHeaderAction(
	current: HeaderLayout,
	key: string,
	zone: HeaderZone,
	index: number,
	previouslySaved: HeaderLayout | null = null,
	max: number = MAX_TOP_ACTIONS,
): HeaderLayout | null {
	const fromTop = current.top.indexOf(key);
	const fromTray = current.tray.indexOf(key);
	if (fromTop < 0 && fromTray < 0) return null;
	if (zone === "top" && fromTop < 0 && current.top.length >= max) return null;

	const sourceZone: HeaderZone = fromTop >= 0 ? "top" : "tray";
	const sourceIndex = fromTop >= 0 ? fromTop : fromTray;
	const next = { top: [...current.top], tray: [...current.tray] };
	next[sourceZone].splice(sourceIndex, 1);

	let at = Math.max(0, Math.min(index, current[zone].length));
	if (zone === sourceZone && sourceIndex < at) at -= 1;
	next[zone].splice(at, 0, key);

	const present = new Set([...next.top, ...next.tray]);
	const stale = (list: readonly string[] | undefined) => (list ?? []).filter((other) => !present.has(other));
	return {
		top: [...next.top, ...stale(previouslySaved?.top)],
		tray: [...next.tray, ...stale(previouslySaved?.tray)],
	};
}
