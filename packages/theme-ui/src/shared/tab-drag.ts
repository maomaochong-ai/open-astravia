export const TAB_DRAG_START_DISTANCE = 4;

export function hasReachedTabDragDistance(deltaX: number, deltaY: number): boolean {
	return Math.hypot(deltaX, deltaY) >= TAB_DRAG_START_DISTANCE;
}

export function moveTabKey<T>(keys: readonly T[], from: T, to: T): T[] {
	const fromIndex = keys.indexOf(from);
	const toIndex = keys.indexOf(to);
	if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return [...keys];
	const next = [...keys];
	next.splice(fromIndex, 1);
	next.splice(toIndex, 0, from);
	return next;
}
