/**
 * 「管理会话」长列表的窗口化区间。
 *
 * 行高固定，按滚动位移直接算，不逐行测量。阈值比别处长列表低（80 条）：
 * 这个面板就是用来清理几十上百条历史会话的，超过这个量级窗口化的收益立刻成立；
 * 再往下，窗口化带来的焦点与滚动锚点问题比省下的渲染更麻烦。
 */
export const MANAGE_SESSIONS_VIRTUAL_THRESHOLD = 80;

export interface ManageSessionsVirtualRange {
	readonly start: number;
	readonly end: number;
	readonly paddingTop: number;
	readonly paddingBottom: number;
}

export function computeManageSessionsRange(input: {
	readonly scrollTop: number;
	readonly viewportHeight: number;
	readonly rowHeight: number;
	readonly count: number;
	readonly overscan?: number;
	readonly threshold?: number;
}): ManageSessionsVirtualRange {
	const { scrollTop, viewportHeight, rowHeight, count } = input;
	const overscan = input.overscan ?? 6;
	const threshold = input.threshold ?? MANAGE_SESSIONS_VIRTUAL_THRESHOLD;
	if (rowHeight <= 0 || count <= threshold) {
		return { start: 0, end: count, paddingTop: 0, paddingBottom: 0 };
	}
	const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
	const visibleRows = Math.ceil(viewportHeight / rowHeight) + 1;
	const start = Math.max(0, firstVisible - overscan);
	const end = Math.min(count, firstVisible + visibleRows + overscan);
	return {
		start,
		end,
		paddingTop: start * rowHeight,
		paddingBottom: Math.max(0, (count - end) * rowHeight),
	};
}

/** 长列表行高固定为 h-9（36px），窗口化据此定位。 */
export const MANAGE_SESSIONS_ROW_HEIGHT = 36;
/**
 * 列表可视高度的上限，与容器 `max-h-[min(420px,56vh)]` 的 420px 对齐。
 *
 * 只用于 CSS 上限与「还没测到实际高度」时的回退；窗口化区间要用容器实测高度，
 * 否则矮窗口（56vh < 420px）下算出的可见行数比真实视口多，选中行会滚进看不见的区域。
 */
export const MANAGE_SESSIONS_LIST_HEIGHT = 420;

/**
 * 选中项落在窗口外时，列表应当滚到的位置；已在窗口内返回 null。
 * 窗口化后目标行可能根本没挂载，`scrollIntoView` 无从调用，只能按下标直接定位。
 */
export function manageSessionsScrollTopFor(
	input: {
		readonly index: number;
		readonly rowHeight: number;
		readonly viewportHeight: number;
		readonly scrollTop: number;
	},
	range: ManageSessionsVirtualRange,
): number | null {
	if (input.index < 0) return null;
	if (input.index >= range.start && input.index < range.end) return null;
	const rowTop = input.index * input.rowHeight;
	// 目标行在视口上方时贴齐上沿，在下方时贴齐下沿——与 scrollIntoView({ block: "nearest" }) 一致。
	return rowTop < input.scrollTop ? rowTop : Math.max(0, rowTop - input.viewportHeight + input.rowHeight);
}
