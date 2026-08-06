/**
 * 画布的对齐吸附求解：纯几何，不碰 React / DOM。
 *
 * 每个矩形在每个轴上抽三条参考线（start / center / end），被拖方的线与候选方的线
 * 两两比对，X、Y 各自独立取偏差最小的一条吸上去。求解与呈现拆成两步：
 * {@link solveSnap} 只给修正量，怎么把修正量落到矩形上由调用方决定——移动是整体
 * 平移，改尺寸是只动被拖的那条边，两者对同一个 offset 的用法完全不同。位置定下来
 * 之后再调 {@link describeSnap} 拿引导线与缝隙标注。
 */

export type Axis = "x" | "y";
export type SnapEdge = "start" | "center" | "end";

export interface SnapRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** 一条引导线。`axis: "x"` 是竖线（钉住 x 坐标），沿 y 从 from 画到 to。 */
export interface SnapGuide {
	axis: Axis;
	position: number;
	from: number;
	to: number;
}

/** 吸上之后与参考 frame 的缝隙。`axis: "y"` 是竖直方向的缝，画在 x = at 处。 */
export interface SnapGap {
	axis: Axis;
	at: number;
	from: number;
	to: number;
}

export interface SnapAxis {
	/** 加到被拖线上的修正量（吸附落点 − 当前位置）。 */
	offset: number;
	/** 吸附落点的世界坐标。 */
	position: number;
}

export interface SnapSolution {
	x: SnapAxis | null;
	y: SnapAxis | null;
}

export interface SnapDecoration {
	guides: SnapGuide[];
	gaps: SnapGap[];
}

export const NO_SNAP: SnapSolution = { x: null, y: null };

/** 平局时边缘胜过中线，所以 center 排在最后（求解按这个顺序先到先得）。 */
export const ALL_EDGES: readonly SnapEdge[] = ["start", "end", "center"];
/** 浮点比较容差，单位是世界像素。 */
const EPSILON = 0.01;

function startOf(rect: SnapRect, axis: Axis): number {
	return axis === "x" ? rect.x : rect.y;
}

function sizeOf(rect: SnapRect, axis: Axis): number {
	return axis === "x" ? rect.width : rect.height;
}

function lineOf(rect: SnapRect, axis: Axis, edge: SnapEdge): number {
	const start = startOf(rect, axis);
	if (edge === "start") return start;
	const size = sizeOf(rect, axis);
	return edge === "center" ? start + size / 2 : start + size;
}

/** 一组矩形的包围盒。多选拖动时被吸附的是它，不是各个成员。 */
export function boundsOf(rects: readonly SnapRect[]): SnapRect | null {
	if (rects.length === 0) return null;
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const rect of rects) {
		left = Math.min(left, rect.x);
		top = Math.min(top, rect.y);
		right = Math.max(right, rect.x + rect.width);
		bottom = Math.max(bottom, rect.y + rect.height);
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function solveAxis(
	axis: Axis,
	moving: SnapRect,
	targets: readonly SnapRect[],
	threshold: number,
	edges: readonly SnapEdge[],
): SnapAxis | null {
	let best: { offset: number; position: number; delta: number } | null = null;
	// 两层都按 ALL_EDGES 的顺序走，配合下面的「严格更优才替换」实现平局仲裁。
	for (const movingEdge of ALL_EDGES) {
		if (!edges.includes(movingEdge)) continue;
		const from = lineOf(moving, axis, movingEdge);
		for (const target of targets) {
			for (const targetEdge of ALL_EDGES) {
				const to = lineOf(target, axis, targetEdge);
				const delta = Math.abs(to - from);
				if (delta > threshold) continue;
				if (best && delta >= best.delta - EPSILON) continue;
				best = { offset: to - from, position: to, delta };
			}
		}
	}
	return best ? { offset: best.offset, position: best.position } : null;
}

export interface SnapRequest {
	/** 被拖方的当前矩形（还没吸附）。多选时传包围盒。 */
	moving: SnapRect;
	targets: readonly SnapRect[];
	/** 世界单位的容差，调用方按 屏幕像素 / zoom 换算。 */
	threshold: number;
	/**
	 * 参与吸附的被拖线。改尺寸时只给被拖的那条边（拖右边就只有 `end`），
	 * 空数组表示该轴不吸附。省略即三条线全上。
	 */
	edges?: { x?: readonly SnapEdge[]; y?: readonly SnapEdge[] };
}

export function solveSnap({ moving, targets, threshold, edges }: SnapRequest): SnapSolution {
	if (targets.length === 0) return NO_SNAP;
	const xEdges = edges?.x ?? ALL_EDGES;
	const yEdges = edges?.y ?? ALL_EDGES;
	return {
		x: xEdges.length > 0 ? solveAxis("x", moving, targets, threshold, xEdges) : null,
		y: yEdges.length > 0 ? solveAxis("y", moving, targets, threshold, yEdges) : null,
	};
}

/**
 * 按已经落定的矩形产出引导线与缝隙标注。
 *
 * 一条轴只吸到一个坐标，但可能有好几个 frame 都恰好落在这个坐标上（三个 frame 左边
 * 对齐），它们全都算参与者：引导线两端要盖住它们，才看得出到底在跟谁对齐。缝隙标的是
 * 参与者里离得最近的那个——在另一轴上与被拖方重叠的不标，那种情况没有「缝」可言。
 */
export function describeSnap(
	snapped: SnapRect,
	targets: readonly SnapRect[],
	solution: SnapSolution,
): SnapDecoration {
	const guides: SnapGuide[] = [];
	const gaps: SnapGap[] = [];
	for (const axis of ["x", "y"] as const) {
		const hit = solution[axis];
		if (!hit) continue;
		const cross: Axis = axis === "x" ? "y" : "x";
		const movingStart = startOf(snapped, cross);
		const movingEnd = movingStart + sizeOf(snapped, cross);
		let from = movingStart;
		let to = movingEnd;
		let nearest = Number.POSITIVE_INFINITY;
		let gap: SnapGap | null = null;
		for (const target of targets) {
			if (!ALL_EDGES.some((edge) => Math.abs(lineOf(target, axis, edge) - hit.position) < EPSILON)) continue;
			const targetStart = startOf(target, cross);
			const targetEnd = targetStart + sizeOf(target, cross);
			from = Math.min(from, targetStart);
			to = Math.max(to, targetEnd);
			const after = targetStart - movingEnd;
			const before = movingStart - targetEnd;
			const distance = Math.max(after, before);
			if (distance <= 0 || distance >= nearest) continue;
			nearest = distance;
			gap =
				after > 0
					? { axis: cross, at: hit.position, from: movingEnd, to: targetStart }
					: { axis: cross, at: hit.position, from: targetEnd, to: movingStart };
		}
		guides.push({ axis, position: hit.position, from, to });
		if (gap) gaps.push(gap);
	}
	return { guides, gaps };
}
