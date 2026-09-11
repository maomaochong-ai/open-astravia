export type TokenActivityMode = "daily" | "weekly" | "rolling";

export interface UsageSeriesPointLike {
	date: string;
	tokens: number;
}

export interface ActivityColumn {
	key: string;
	date: string;
	endDate: string;
	tokens: number;
	/** Month axis label for first column of each month; null otherwise */
	monthKey: string | null;
	/** Left-side filler when history is shorter than the visible capacity */
	isPad?: boolean;
	/** 滚动窗口的起始日；仅 rolling 模式有值，供提示条展示区间 */
	windowStart?: string;
}

export const TOKEN_ACTIVITY_MAX_ROWS = 10;
/** 滚动窗口跨度（自然日）。 */
export const ROLLING_WINDOW_DAYS = 30;
/** Preferred square size used only to decide how many columns fit the width. */
export const TOKEN_ACTIVITY_TARGET_CELL_PX = 8;
export const TOKEN_ACTIVITY_GAP_PX = 2;

function parseLocalDate(iso: string): Date {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(y!, m! - 1, d!);
}

function formatYmd(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function addDays(iso: string, delta: number): string {
	const d = parseLocalDate(iso);
	d.setDate(d.getDate() + delta);
	return formatYmd(d);
}

/** Monday-start week key (YYYY-MM-DD of week start) */
function weekStartKey(iso: string): string {
	const d = parseLocalDate(iso);
	const day = d.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	d.setDate(d.getDate() + diff);
	return formatYmd(d);
}

function withMonthKeys(columns: ActivityColumn[]): ActivityColumn[] {
	let lastMonth = "";
	return columns.map((c) => {
		if (!c.date) return { ...c, monthKey: null };
		const m = c.date.slice(0, 7);
		const monthKey = m !== lastMonth ? m : null;
		lastMonth = m;
		return { ...c, monthKey };
	});
}

/**
 * 滚动窗口按自然日计量，序列里缺失的日期必须当作 0 参与进出窗，
 * 否则「过去 30 天」会在数据稀疏时退化成「最近 30 个有记录的日子」。
 */
function densifyDaily(points: UsageSeriesPointLike[]): { date: string; tokens: number }[] {
	const totals = new Map<string, number>();
	for (const p of points) totals.set(p.date, (totals.get(p.date) ?? 0) + p.tokens);
	const dates = [...totals.keys()].sort((a, b) => a.localeCompare(b));
	const last = dates[dates.length - 1]!;
	const out: { date: string; tokens: number }[] = [];
	for (let cur = dates[0]!; cur <= last; cur = addDays(cur, 1)) {
		out.push({ date: cur, tokens: totals.get(cur) ?? 0 });
	}
	return out;
}

export function buildActivityColumns(points: UsageSeriesPointLike[], mode: TokenActivityMode): ActivityColumn[] {
	if (points.length === 0) return [];

	let base: { date: string; endDate: string; tokens: number; windowStart?: string }[];

	if (mode === "rolling") {
		const daily = densifyDaily(points);
		let sum = 0;
		base = daily.map((p, i) => {
			sum += p.tokens;
			const expired = i - ROLLING_WINDOW_DAYS;
			if (expired >= 0) sum -= daily[expired]!.tokens;
			return {
				date: p.date,
				endDate: p.date,
				tokens: sum,
				windowStart: daily[Math.max(0, i - ROLLING_WINDOW_DAYS + 1)]!.date,
			};
		});
	} else if (mode === "weekly") {
		const map = new Map<string, { date: string; endDate: string; tokens: number }>();
		for (const p of points) {
			const start = weekStartKey(p.date);
			const existing = map.get(start);
			if (existing) {
				existing.tokens += p.tokens;
				if (p.date > existing.endDate) existing.endDate = p.date;
			} else {
				map.set(start, { date: start, endDate: p.date, tokens: p.tokens });
			}
		}
		base = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
	} else {
		base = points.map((p) => ({ date: p.date, endDate: p.date, tokens: p.tokens }));
	}

	return withMonthKeys(
		base.map((p) => ({
			key: p.date,
			date: p.date,
			endDate: p.endDate,
			tokens: p.tokens,
			monthKey: null,
			...(p.windowStart ? { windowStart: p.windowStart } : {}),
		})),
	);
}

/**
 * Fit columns to a fixed capacity so the chart exactly fills the container:
 * - too many → drop oldest (left)
 * - too few → pad empty columns on the left
 */
export function fitActivityColumns(columns: ActivityColumn[], capacity: number): ActivityColumn[] {
	if (capacity <= 0) return [];
	if (columns.length >= capacity) {
		return withMonthKeys(columns.slice(columns.length - capacity));
	}
	const pad = capacity - columns.length;
	const empties: ActivityColumn[] = Array.from({ length: pad }, (_, i) => ({
		key: `__pad-${i}`,
		date: "",
		endDate: "",
		tokens: 0,
		monthKey: null,
		isPad: true,
	}));
	return withMonthKeys([...empties, ...columns]);
}

export function columnCapacity(
	widthPx: number,
	cellPx = TOKEN_ACTIVITY_TARGET_CELL_PX,
	gapPx = TOKEN_ACTIVITY_GAP_PX,
): number {
	if (widthPx <= 0) return 0;
	return Math.max(1, Math.floor((widthPx + gapPx) / (cellPx + gapPx)));
}

export function activityBlockCount(tokens: number, maxTokens: number, maxRows = TOKEN_ACTIVITY_MAX_ROWS): number {
	if (tokens <= 0 || maxTokens <= 0) return 0;
	return Math.max(1, Math.round((tokens / maxTokens) * maxRows));
}

/** Discrete intensity levels (excluding empty). Higher = more tokens. */
export const TOKEN_ACTIVITY_INTENSITY_LEVELS = 4;

/**
 * Map a token amount to 0..levels (0 = empty, 1 light … levels darkest).
 * Relative to the max in the visible window.
 */
export function activityIntensityLevel(
	tokens: number,
	maxTokens: number,
	levels = TOKEN_ACTIVITY_INTENSITY_LEVELS,
): number {
	if (tokens <= 0 || maxTokens <= 0) return 0;
	return Math.min(levels, Math.max(1, Math.ceil((tokens / maxTokens) * levels)));
}

export function formatTokenCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toLocaleString();
}

/**
 * 曲线只关心「有数据之后」的部分：服务端固定返回一整年，首次请求之前全是 0，
 * 补在左边只会画出一条无信息的平线。保留紧邻的最后一个空档作为 0 基线锚点，
 * 让曲线从底部起笔而不是凭空出现在半空。
 */
export function trimLeadingIdleColumns(columns: ActivityColumn[]): ActivityColumn[] {
	const first = columns.findIndex((c) => !c.isPad && c.tokens > 0);
	if (first < 0) return [];
	return withMonthKeys(columns.slice(Math.max(0, first - 1)));
}

/**
 * 滚动窗口是逐日平滑变化的序列，用方块矩阵只会画成一片高度相近的柱子，
 * 因此改用面积曲线。曲线不需要一天一列，超出容量时按等距采样降采样；
 * 列数少于容量时直接铺满宽度，不像矩阵那样在左侧补空列。
 */
export function fitCurveColumns(columns: ActivityColumn[], capacity: number): ActivityColumn[] {
	if (capacity <= 0) return [];
	if (columns.length <= capacity) return columns;
	if (capacity === 1) return withMonthKeys([columns[columns.length - 1]!]);
	const sampled = Array.from({ length: capacity }, (_, i) => {
		const idx = Math.round((i * (columns.length - 1)) / (capacity - 1));
		return columns[idx]!;
	});
	return withMonthKeys(sampled);
}

export interface AreaGeometryPoint {
	key: string;
	/** 0..100，viewBox 内的水平位置 */
	x: number;
	/** 0..100，viewBox 内的垂直位置，0 在顶部 */
	y: number;
}

export interface AreaGeometry {
	points: AreaGeometryPoint[];
	/** 平滑折线路径；点数不足 2 时为空串 */
	linePath: string;
	/** 闭合到底边的填充路径；点数不足 2 时为空串 */
	areaPath: string;
}

const round = (v: number): string => (Math.round(v * 100) / 100).toFixed(2);

/**
 * Fritsch–Carlson 单调三次插值的切线。普通 Catmull-Rom 会在陡升/陡降段前后过冲，
 * 画出数据里并不存在的假回落或假反弹，这里必须用保单调的版本。
 */
function monotoneTangents(points: AreaGeometryPoint[]): number[] {
	const n = points.length;
	const slopes: number[] = [];
	for (let i = 0; i < n - 1; i++) {
		const dx = points[i + 1]!.x - points[i]!.x;
		slopes.push(dx === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / dx);
	}
	const m = points.map((_, i) => {
		if (i === 0) return slopes[0] ?? 0;
		if (i === n - 1) return slopes[n - 2] ?? 0;
		return ((slopes[i - 1] ?? 0) + (slopes[i] ?? 0)) / 2;
	});
	for (let i = 0; i < n - 1; i++) {
		const d = slopes[i]!;
		if (d === 0) {
			m[i] = 0;
			m[i + 1] = 0;
			continue;
		}
		const a = m[i]! / d;
		const b = m[i + 1]! / d;
		const sum = a * a + b * b;
		if (sum > 9) {
			const t = 3 / Math.sqrt(sum);
			m[i] = t * a * d;
			m[i + 1] = t * b * d;
		}
	}
	return m;
}

/** 把数据点连成保单调的三次贝塞尔路径。 */
export function buildSmoothPath(points: AreaGeometryPoint[]): string {
	if (points.length < 2) return "";
	const m = monotoneTangents(points);
	let d = `M${round(points[0]!.x)} ${round(points[0]!.y)}`;
	for (let i = 0; i < points.length - 1; i++) {
		const p0 = points[i]!;
		const p1 = points[i + 1]!;
		const dx = (p1.x - p0.x) / 3;
		d += ` C${round(p0.x + dx)} ${round(p0.y + m[i]! * dx)} ${round(p1.x - dx)} ${round(p1.y - m[i + 1]! * dx)} ${round(p1.x)} ${round(p1.y)}`;
	}
	return d;
}

/** 悬停命中区：以每个数据点为中心、延伸到与相邻点的中点，保证指针位置和圆点落在同一列。 */
export function buildHoverZones(points: AreaGeometryPoint[]): Array<{ key: string; left: number; width: number }> {
	const n = points.length;
	if (n === 0) return [];
	if (n === 1) return [{ key: points[0]!.key, left: 0, width: 100 }];
	return points.map((p, i) => {
		const left = i === 0 ? 0 : (points[i - 1]!.x + p.x) / 2;
		const right = i === n - 1 ? 100 : (p.x + points[i + 1]!.x) / 2;
		return { key: p.key, left, width: right - left };
	});
}

/** 把列序列映射成 100x100 viewBox 内的面积曲线几何，供 SVG 以 `preserveAspectRatio="none"` 拉伸。 */
export function buildAreaGeometry(columns: ActivityColumn[], maxTokens: number): AreaGeometry {
	const n = columns.length;
	if (n === 0) return { points: [], linePath: "", areaPath: "" };
	const max = maxTokens > 0 ? maxTokens : 1;
	const points = columns.map((col, i) => ({
		key: col.key,
		x: n === 1 ? 0 : (i / (n - 1)) * 100,
		y: 100 - Math.min(100, Math.max(0, (col.tokens / max) * 100)),
	}));
	const linePath = buildSmoothPath(points);
	const areaPath = linePath ? `${linePath} L100.00 100.00 L0.00 100.00 Z` : "";
	return { points, linePath, areaPath };
}

/** 方块矩阵的实际像素高度，曲线模式复用它以避免切换 tab 时高度跳动。 */
export function activityMatrixHeightPx(
	widthPx: number,
	capacity: number,
	gapPx = TOKEN_ACTIVITY_GAP_PX,
	rows = TOKEN_ACTIVITY_MAX_ROWS,
): number {
	if (widthPx <= 0 || capacity <= 0) return 0;
	const cell = (widthPx - (capacity - 1) * gapPx) / capacity;
	if (cell <= 0) return 0;
	return rows * cell + (rows - 1) * gapPx;
}
