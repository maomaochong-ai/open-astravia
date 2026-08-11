/**
 * 画廊首页与全部列表页的布局/分页纯逻辑。
 *
 * 首页的「最多 3 行」不能用 CSS 裁切：宫格是 auto-fill 响应式的，每行几张卡取决于
 * 容器宽度，裁切会把第 4 行露出半截。这里按与 CSS 完全相同的公式算出列数，
 * 由渲染层只取前 3 行的卡。列宽/间距常量必须与 {@link PROJECT_GRID_CLASS} 保持一致。
 */

/** 项目宫格的 CSS：改这里必须同步下面的两个常量。 */
export const PROJECT_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3";
export const PROJECT_CARD_MIN_WIDTH = 220;
/** gap-3 = 12px。 */
export const PROJECT_GRID_GAP = 12;

/** 首页用户资产最多铺几行，超出的收进「全部设计」列表页。 */
export const HOME_MAX_ROWS = 3;

/** 列表页每次滚到底部追加多少张卡。 */
export const PROJECTS_PAGE_SIZE = 24;

/**
 * auto-fill + minmax(min, 1fr) 的列数：n 列成立当且仅当 n*min + (n-1)*gap <= width。
 * 容器还没量出来（宽度 0）时按 1 列算，宁可少显示也不多显示。
 */
export function galleryColumnCount(
	containerWidth: number,
	minWidth: number = PROJECT_CARD_MIN_WIDTH,
	gap: number = PROJECT_GRID_GAP,
): number {
	if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 1;
	return Math.max(1, Math.floor((containerWidth + gap) / (minWidth + gap)));
}

/** 首页展示多少张卡：最多 maxRows 行，不足时全放。 */
export function homeVisibleCount(total: number, columns: number, maxRows: number = HOME_MAX_ROWS): number {
	const cap = Math.max(1, columns) * Math.max(1, maxRows);
	return Math.min(Math.max(0, total), cap);
}

/** 是否需要「查看全部」入口。 */
export function hasMoreProjects(total: number, columns: number, maxRows: number = HOME_MAX_ROWS): boolean {
	return total > homeVisibleCount(total, columns, maxRows);
}

/** 列表页首屏渲染多少张。 */
export function initialVisibleCount(total: number, page: number = PROJECTS_PAGE_SIZE): number {
	return Math.min(Math.max(0, total), Math.max(1, page));
}

/** 滚动到底部后追加一页；封顶到总数。 */
export function growVisibleCount(current: number, total: number, page: number = PROJECTS_PAGE_SIZE): number {
	return Math.min(Math.max(0, total), Math.max(0, current) + Math.max(1, page));
}
