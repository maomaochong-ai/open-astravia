/**
 * 风格库宫格的纯几何：多少列、行多高、当前该渲染哪一段。
 *
 * 抽出来是因为这几个数字全是「差一行就错位」的算术：列数随宽度跳变、行高由列数反推、
 * 窗口又建立在行高之上，任何一处取整取错都表现为滚动时卡片错列或闪空，而这在浏览器里
 * 极难复现。留在组件里就只能靠肉眼滚动去验。
 */
import { galleryColumnCount } from "../gallery/gallery-layout";

/** 与 `gap-3` 一致。 */
export const STYLE_GRID_GAP = 12;
/** 卡片宽高比，与 `aspect-[4/3]` 一致。 */
const ASPECT = 4 / 3;
/** 再窄就看不清 demo 里的版式了，宁可少一列。 */
const MIN_CARD_WIDTH = 240;
/** 列数上限：卡片再小，这一屏的作用就只剩「花」而不是「看清楚」。 */
export const STYLE_GRID_MAX_COLUMNS = 3;
/** 视口上下各多渲染一行。 */
const OVERSCAN = 1;

export interface StyleGridMetrics {
	readonly columns: number;
	/** 一整行占的高度（卡片高 + 行距）；宽度未知时为 0，调用方据此退回「全量渲染」。 */
	readonly rowHeight: number;
}

export function styleGridMetrics(width: number): StyleGridMetrics {
	if (!Number.isFinite(width) || width <= 0) return { columns: STYLE_GRID_MAX_COLUMNS, rowHeight: 0 };
	const columns = Math.min(STYLE_GRID_MAX_COLUMNS, galleryColumnCount(width, MIN_CARD_WIDTH, STYLE_GRID_GAP));
	const card = (width - STYLE_GRID_GAP * (columns - 1)) / columns;
	return { columns, rowHeight: card / ASPECT + STYLE_GRID_GAP };
}

export interface StyleGridWindow {
	readonly start: number;
	readonly end: number;
}

/**
 * 当前该渲染的条目区间（左闭右开）。
 *
 * `scrolledPast` 是宫格顶已经滚出视口上沿的距离（未滚到时为 0）。
 */
export function styleGridWindow(input: {
	readonly scrolledPast: number;
	readonly viewportHeight: number;
	readonly metrics: StyleGridMetrics;
	readonly total: number;
}): StyleGridWindow {
	const { columns, rowHeight } = input.metrics;
	if (rowHeight <= 0) return { start: 0, end: input.total };
	const startRow = Math.max(0, Math.floor(Math.max(0, input.scrolledPast) / rowHeight) - OVERSCAN);
	const visibleRows = Math.ceil(input.viewportHeight / rowHeight) + OVERSCAN * 2;
	return {
		start: Math.min(startRow * columns, input.total),
		end: Math.min(input.total, (startRow + visibleRows) * columns),
	};
}
