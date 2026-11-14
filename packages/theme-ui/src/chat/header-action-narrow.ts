/** 挤窄分栏只关心这两件事，避免和按钮组视图互相引用。 */
export interface NarrowHeaderAction {
	readonly retainWhenNarrow?: boolean;
	readonly badge?: number | true;
}

export interface NarrowHeaderSplit<T extends NarrowHeaderAction> {
	/** 收进「更多」菜单的动作，顶栏在前、收纳在后。 */
	readonly overflow: readonly T[];
	/** 挤窄时仍留在活动面板开关旁边的动作（窗口置顶）。 */
	readonly retained: readonly T[];
}

/** 页头挤窄时：标了 `retainWhenNarrow` 的留下，其余（含已经收纳的）进下拉菜单。 */
export function partitionHeaderActionsForNarrow<T extends NarrowHeaderAction>(
	top: readonly T[],
	tray: readonly T[],
): NarrowHeaderSplit<T> {
	const overflow: T[] = [];
	const retained: T[] = [];
	for (const item of [...top, ...tray]) {
		if (item.retainWhenNarrow) retained.push(item);
		else overflow.push(item);
	}
	return { overflow, retained };
}

/** 菜单触发器上的角标：有数字就加总，否则只要有人带红点就显示一枚。 */
export function narrowOverflowBadge(items: readonly NarrowHeaderAction[]): number | true | undefined {
	let count = 0;
	let dot = false;
	for (const item of items) {
		if (item.badge === true) dot = true;
		else if (typeof item.badge === "number" && item.badge > 0) count += item.badge;
	}
	if (count > 0) return count;
	return dot ? true : undefined;
}
