export interface ActivityTabPoint {
	x: number;
	y: number;
}

export interface ActivityTabBounds {
	bottom: number;
	height: number;
	left: number;
	right: number;
	top: number;
	width: number;
}

export interface FloatingActivityTabRect {
	height: number;
	width: number;
	x: number;
	y: number;
}

export interface DockedTabCenter<T extends string> {
	centerX: number;
	key: T;
}

export const FLOATING_ACTIVITY_TAB_MARGIN = 8;
export const FLOATING_ACTIVITY_TAB_MIN_HEIGHT = 260;
export const FLOATING_ACTIVITY_TAB_DETACH_DISTANCE = 24;
export const FLOATING_ACTIVITY_TAB_DOCK_TOLERANCE = 12;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

export function hasLeftTabStrip(
	point: ActivityTabPoint,
	bounds: ActivityTabBounds,
	distance = FLOATING_ACTIVITY_TAB_DETACH_DISTANCE,
): boolean {
	return (
		point.x < bounds.left - distance ||
		point.x > bounds.right + distance ||
		point.y < bounds.top - distance ||
		point.y > bounds.bottom + distance
	);
}

export function isInsideTabStrip(
	point: ActivityTabPoint,
	bounds: ActivityTabBounds,
	tolerance = FLOATING_ACTIVITY_TAB_DOCK_TOLERANCE,
): boolean {
	return (
		point.x >= bounds.left - tolerance &&
		point.x <= bounds.right + tolerance &&
		point.y >= bounds.top - tolerance &&
		point.y <= bounds.bottom + tolerance
	);
}

export function clampFloatingTabRect(
	rect: FloatingActivityTabRect,
	workspace: ActivityTabBounds,
	minWidth: number,
	minHeight = FLOATING_ACTIVITY_TAB_MIN_HEIGHT,
	margin = FLOATING_ACTIVITY_TAB_MARGIN,
): FloatingActivityTabRect {
	const availableWidth = Math.max(0, workspace.width - margin * 2);
	const availableHeight = Math.max(0, workspace.height - margin * 2);
	const width = clamp(rect.width, Math.min(minWidth, availableWidth), availableWidth);
	const height = clamp(rect.height, Math.min(minHeight, availableHeight), availableHeight);
	const minX = workspace.left + margin;
	const minY = workspace.top + margin;
	return {
		x: clamp(rect.x, minX, workspace.right - margin - width),
		y: clamp(rect.y, minY, workspace.bottom - margin - height),
		width,
		height,
	};
}

export function createFloatingTabRect(input: {
	panel: ActivityTabBounds;
	point: ActivityTabPoint;
	workspace: ActivityTabBounds;
	minWidth: number;
}): { offset: ActivityTabPoint; rect: FloatingActivityTabRect } {
	const height = Math.min(
		input.panel.height,
		Math.max(FLOATING_ACTIVITY_TAB_MIN_HEIGHT, input.workspace.height * 0.75),
	);
	const offset = {
		x: clamp(input.point.x - input.panel.left, 0, input.panel.width),
		y: clamp(input.point.y - input.panel.top, 0, height),
	};
	const rect = clampFloatingTabRect(
		{
			x: input.point.x - offset.x,
			y: input.point.y - offset.y,
			width: input.panel.width,
			height,
		},
		input.workspace,
		input.minWidth,
	);
	return { offset, rect };
}

export function moveFloatingTabRect(
	rect: FloatingActivityTabRect,
	point: ActivityTabPoint,
	offset: ActivityTabPoint,
	workspace: ActivityTabBounds,
	minWidth: number,
): FloatingActivityTabRect {
	return clampFloatingTabRect({ ...rect, x: point.x - offset.x, y: point.y - offset.y }, workspace, minWidth);
}

export function resizeFloatingTabRect(
	rect: FloatingActivityTabRect,
	delta: ActivityTabPoint,
	workspace: ActivityTabBounds,
	minWidth: number,
): FloatingActivityTabRect {
	return clampFloatingTabRect(
		{ ...rect, width: rect.width + delta.x, height: rect.height + delta.y },
		workspace,
		minWidth,
	);
}

/** 仅替换停靠 tab 的相对顺序，其他浮动 tab 在完整顺序中的槽位保持不变。 */
export function mergeDockedTabOrder<T extends string>(
	fullOrder: readonly T[],
	floatingKeys: ReadonlySet<T>,
	reorderedDockedKeys: readonly T[],
): T[] {
	const reordered = [...reorderedDockedKeys];
	let dockedIndex = 0;
	const merged = fullOrder.map((key) => (floatingKeys.has(key) ? key : (reordered[dockedIndex++] ?? key)));
	for (; dockedIndex < reordered.length; dockedIndex += 1) {
		const key = reordered[dockedIndex];
		if (key != null && !merged.includes(key)) merged.push(key);
	}
	return merged;
}

export function insertDockedTabAtPoint<T extends string>(
	dockedKeys: readonly T[],
	movingKey: T,
	centers: readonly DockedTabCenter<T>[],
	pointerX: number,
): T[] {
	const next = dockedKeys.filter((key) => key !== movingKey);
	const before = centers.find((entry) => entry.key !== movingKey && pointerX < entry.centerX)?.key;
	const index = before == null ? next.length : Math.max(0, next.indexOf(before));
	next.splice(index, 0, movingKey);
	return next;
}
