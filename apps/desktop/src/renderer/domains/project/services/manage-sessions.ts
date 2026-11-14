export interface ManageSessionsMatch<T> {
	readonly item: T;
	/** 标题里命中的区间；查询为空时没有高亮。 */
	readonly ranges: readonly { readonly start: number; readonly end: number }[];
}

/**
 * 按标题做不区分大小写的子串过滤，保持原有顺序（侧栏的置顶 / 时间序）。
 * 「管理会话」要的是「快速找到并删掉」，子串比模糊匹配更可预期。
 */
export function filterManageSessions<T extends { readonly label: string }>(
	items: readonly T[],
	query: string,
): ManageSessionsMatch<T>[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return items.map((item) => ({ item, ranges: [] }));
	const matches: ManageSessionsMatch<T>[] = [];
	for (const item of items) {
		const start = item.label.toLowerCase().indexOf(needle);
		if (start >= 0) matches.push({ item, ranges: [{ start, end: start + needle.length }] });
	}
	return matches;
}

/**
 * 删掉 `removedId` 之后应当选中谁：优先同位置的下一条，其次上一条。
 * 连续按快捷键删除时，选中项要停在原地附近而不是跳回顶部。
 */
export function selectionAfterRemoval(ids: readonly string[], removedId: string): string | null {
	const index = ids.indexOf(removedId);
	if (index < 0) return ids[0] ?? null;
	return ids[index + 1] ?? ids[index - 1] ?? null;
}

/** 在 `ids` 里按 `delta` 循环移动选中项；当前选中不在其中时从头（或从尾）开始。 */
export function moveSelection(ids: readonly string[], current: string | null, delta: 1 | -1): string | null {
	if (ids.length === 0) return null;
	const index = current === null ? -1 : ids.indexOf(current);
	if (index < 0) return delta === 1 ? ids[0] : ids[ids.length - 1];
	return ids[(index + delta + ids.length) % ids.length];
}

/**
 * 窗口化的实现放在 theme-ui（面板视图自己要用），这里只做再导出，
 * 避免桌面侧与视图各算一套区间。
 */
export {
	computeManageSessionsRange,
	MANAGE_SESSIONS_VIRTUAL_THRESHOLD,
	type ManageSessionsVirtualRange,
} from "@astravia-org/theme-ui/project/manage-sessions-range";
