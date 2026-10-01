/**
 * 多选 frame 的网格整理：从当前摆放反推「用户心里的那张网格」，再按统一间距重排。
 *
 * 画布是自由摆放的，没有布局容器，所以行列关系只能猜：按 y 聚成行、行内按 x 排，
 * 最长的那一行就是列数，间距取相邻缝隙的中位数（中位数而不是平均：一处摆歪了不该
 * 把整体间距带跑）。猜出来的这套东西同时喂给三个入口——自动排列按钮、列数选择、
 * 拖 gap，它们只是在改 {@link GridSpec} 的不同字段，落位都走 {@link layoutGrid}。
 */

import type { SnapRect } from "./snap";

export interface ArrangeItem extends SnapRect {
	id: string;
}

export interface GridSpec {
	/** 行优先的视觉顺序（先上后下、行内从左到右），改列数时顺序不变、只是重新切行。 */
	order: string[];
	columns: number;
	gapX: number;
	gapY: number;
}

export interface Placement {
	x: number;
	y: number;
}

/** 推不出间距时的默认值，与 design-session 里新建 frame 的 FRAME_GAP 对齐。 */
export const DEFAULT_GAP = 80;

function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 按 y 把 items 聚成行。
 *
 * 判据是「顶边落在行首 frame 的上半高之内」：同一行的 frame 高度常常不同（一个 375
 * 高、一个 812 高），用中心点或底边都会把它们判成两行。
 */
function clusterRows(items: readonly ArrangeItem[]): ArrangeItem[][] {
	const sorted = [...items].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
	const rows: ArrangeItem[][] = [];
	let current: ArrangeItem[] = [];
	let anchorY = 0;
	let anchorHeight = 0;
	for (const item of sorted) {
		if (current.length === 0) {
			current = [item];
			anchorY = item.y;
			anchorHeight = item.height;
			continue;
		}
		const tolerance = Math.min(anchorHeight, item.height) / 2;
		if (Math.abs(item.y - anchorY) <= tolerance) current.push(item);
		else {
			rows.push(current);
			current = [item];
			anchorY = item.y;
			anchorHeight = item.height;
		}
	}
	if (current.length > 0) rows.push(current);
	return rows.map((row) => [...row].sort((a, b) => a.x - b.x));
}

/** 从当前摆放反推网格。items 少于 2 个时列数为 items 长度，间距取默认值。 */
export function inferGrid(items: readonly ArrangeItem[]): GridSpec {
	const rows = clusterRows(items);
	const order = rows.flat().map((item) => item.id);
	const columns = Math.max(1, ...rows.map((row) => row.length));

	const horizontal: number[] = [];
	for (const row of rows) {
		for (let index = 1; index < row.length; index += 1) {
			horizontal.push(row[index].x - (row[index - 1].x + row[index - 1].width));
		}
	}
	const vertical: number[] = [];
	for (let index = 1; index < rows.length; index += 1) {
		const previousBottom = Math.max(...rows[index - 1].map((item) => item.y + item.height));
		const currentTop = Math.min(...rows[index].map((item) => item.y));
		vertical.push(currentTop - previousBottom);
	}

	// 中位数为负说明现在是重叠着的，重排时按 0 处理（贴在一起），别把负间距传下去。
	// 只有一行时垂直间距没有样本，拿水平间距顶上，比硬塞默认值更贴近现场。
	const gapX = Math.max(0, Math.round(median(horizontal) ?? DEFAULT_GAP));
	const gapY = Math.max(0, Math.round(median(vertical) ?? median(horizontal) ?? DEFAULT_GAP));
	return { order, columns, gapX, gapY };
}

function chunk<T>(list: readonly T[], size: number): T[][] {
	const rows: T[][] = [];
	for (let index = 0; index < list.length; index += size) rows.push(list.slice(index, index + size));
	return rows;
}

/**
 * 按网格算出每个 frame 的新位置。
 *
 * 列宽取该列最宽的、行高取该行最高的，frame 在单元格里左上对齐（Figma 的 tidy up
 * 也是这样）：尺寸不一时居中会让边缘参差，左上对齐至少保证左边一条线是齐的。
 * 起点固定为原包围盒的左上角——整理不该把整块选区挪走。
 */
export function layoutGrid(items: readonly ArrangeItem[], spec: GridSpec, origin: Placement): Map<string, Placement> {
	const byId = new Map(items.map((item) => [item.id, item]));
	const rows = chunk(
		spec.order.filter((id) => byId.has(id)),
		Math.max(1, spec.columns),
	);
	const columnWidths: number[] = [];
	const rowHeights: number[] = [];
	rows.forEach((row, rowIndex) => {
		row.forEach((id, columnIndex) => {
			const item = byId.get(id);
			if (!item) return;
			columnWidths[columnIndex] = Math.max(columnWidths[columnIndex] ?? 0, item.width);
			rowHeights[rowIndex] = Math.max(rowHeights[rowIndex] ?? 0, item.height);
		});
	});

	const placements = new Map<string, Placement>();
	let y = origin.y;
	rows.forEach((row, rowIndex) => {
		let x = origin.x;
		row.forEach((id, columnIndex) => {
			placements.set(id, { x: Math.round(x), y: Math.round(y) });
			x += (columnWidths[columnIndex] ?? 0) + spec.gapX;
		});
		y += (rowHeights[rowIndex] ?? 0) + spec.gapY;
	});
	return placements;
}

/** 可以拖动的间隙带：`axis:"x"` 是竖直的带（拖它改水平间距）。 */
export interface GapBand {
	axis: "x" | "y";
	/** 第几条缝（列间/行间的序号），只用来做 key。 */
	index: number;
	/** 缝在 axis 方向上的起止。 */
	from: number;
	to: number;
	/** 缝在另一轴上的覆盖范围（取整个选区）。 */
	crossFrom: number;
	crossTo: number;
}

/**
 * 按当前摆放算出所有可拖的间隙带。
 *
 * 列边界取「该列最右」到「下一列最左」，所以只要视觉上分得出列就有带可拖，不要求
 * 已经排整齐过。缝小于等于 0（贴着或重叠）的照样给出来——手柄自己会保证有最小可点
 * 宽度，否则贴在一起的两列就再也拉不开了。
 */
export function gapBands(items: readonly ArrangeItem[]): GapBand[] {
	const rows = clusterRows(items);
	if (items.length < 2) return [];
	const left = Math.min(...items.map((item) => item.x));
	const right = Math.max(...items.map((item) => item.x + item.width));
	const top = Math.min(...items.map((item) => item.y));
	const bottom = Math.max(...items.map((item) => item.y + item.height));

	const bands: GapBand[] = [];
	const columns = Math.max(...rows.map((row) => row.length));
	for (let index = 1; index < columns; index += 1) {
		const before = rows.map((row) => row[index - 1]).filter(Boolean);
		const after = rows.map((row) => row[index]).filter(Boolean);
		if (before.length === 0 || after.length === 0) continue;
		bands.push({
			axis: "x",
			index,
			from: Math.max(...before.map((item) => item.x + item.width)),
			to: Math.min(...after.map((item) => item.x)),
			crossFrom: top,
			crossTo: bottom,
		});
	}
	for (let index = 1; index < rows.length; index += 1) {
		bands.push({
			axis: "y",
			index,
			from: Math.max(...rows[index - 1].map((item) => item.y + item.height)),
			to: Math.min(...rows[index].map((item) => item.y)),
			crossFrom: left,
			crossTo: right,
		});
	}
	return bands;
}
