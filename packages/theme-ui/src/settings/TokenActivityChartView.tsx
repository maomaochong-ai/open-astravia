import { useEffect, useId, useMemo, useRef, useState, type JSX } from "react";
import {
	activityBlockCount,
	activityIntensityLevel,
	activityMatrixHeightPx,
	buildActivityColumns,
	buildAreaGeometry,
	buildHoverZones,
	columnCapacity,
	fitActivityColumns,
	fitCumulativeColumns,
	formatTokenCount,
	trimLeadingIdleColumns,
	TOKEN_ACTIVITY_GAP_PX,
	TOKEN_ACTIVITY_MAX_ROWS,
	type TokenActivityMode,
	type UsageSeriesPointLike,
} from "./token-activity";

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export interface TokenActivityChartViewProps {
	points: UsageSeriesPointLike[];
	loading?: boolean;
	/** When true, omit outer card chrome (for nesting inside another panel). */
	embedded?: boolean;
	labels: {
		title: string;
		daily: string;
		weekly: string;
		cumulative: string;
		empty: string;
		tokens: (count: string) => string;
		month: (yearMonth: string) => string;
	};
}

const MODES: TokenActivityMode[] = ["daily", "weekly", "cumulative"];

/** 相邻月份刻度的最小水平间距（px），小于此值只保留前一个刻度。 */
const MONTH_TICK_MIN_GAP_PX = 34;

/** 1..4 light → dark; index 0 unused. Alpha values from DESIGN token whitelist. */
const FILLED_CLASS: Record<number, string> = {
	1: "bg-primary/25",
	2: "bg-primary/40",
	3: "bg-primary/60",
	4: "bg-primary/80",
};
const FILLED_ACTIVE_CLASS: Record<number, string> = {
	1: "bg-primary/40",
	2: "bg-primary/60",
	3: "bg-primary/80",
	4: "bg-primary",
};

export function TokenActivityChartView({
	points,
	loading,
	embedded,
	labels,
}: TokenActivityChartViewProps): JSX.Element {
	const [mode, setMode] = useState<TokenActivityMode>("cumulative");
	const [hoverKey, setHoverKey] = useState<string | null>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const gradientId = useId();
	const [width, setWidth] = useState(0);

	useEffect(() => {
		const el = trackRef.current;
		if (!el) return;
		const measure = () => setWidth(el.clientWidth);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [loading]);

	const rawColumns = useMemo(() => buildActivityColumns(points, mode), [points, mode]);
	const capacity = useMemo(() => columnCapacity(width), [width]);
	const isCurve = mode === "cumulative";
	const columns = useMemo(
		() =>
			isCurve
				? fitCumulativeColumns(trimLeadingIdleColumns(rawColumns), capacity)
				: fitActivityColumns(rawColumns, capacity),
		[rawColumns, capacity, isCurve],
	);
	const maxTokens = useMemo(() => {
		const values = columns.filter((c) => !c.isPad).map((c) => c.tokens);
		return Math.max(1, ...values, 0);
	}, [columns]);
	const hoverCol = hoverKey ? columns.find((c) => c.key === hoverKey && !c.isPad) : null;
	const geometry = useMemo(
		// 顶部留 8% 余量，否则最高点正好压在 viewBox 边缘、描边会被裁掉一半
		() => (isCurve ? buildAreaGeometry(columns, maxTokens * 1.08) : null),
		[isCurve, columns, maxTokens],
	);
	const curveHeight = useMemo(() => activityMatrixHeightPx(width, capacity), [width, capacity]);
	const hoverPoint = hoverCol ? geometry?.points.find((p) => p.key === hoverCol.key) : undefined;
	const hoverZones = useMemo(() => (geometry ? buildHoverZones(geometry.points) : []), [geometry]);
	/** 月份刻度按列下标定位，相邻月份起始列可能只差一两列 —— 太近就跳过，避免文字叠在一起。 */
	const monthTicks = useMemo(() => {
		const ticks: Array<{ key: string; leftPercent: number; monthKey: string }> = [];
		let lastLeftPx = Number.NEGATIVE_INFINITY;
		columns.forEach((col, i) => {
			if (!col.monthKey) return;
			const ratio = isCurve
				? (geometry?.points[i]?.x ?? 0) / 100
				: i / Math.max(columns.length, 1);
			if (width > 0 && width * ratio - lastLeftPx < MONTH_TICK_MIN_GAP_PX) return;
			lastLeftPx = width * ratio;
			ticks.push({ key: col.key, leftPercent: ratio * 100, monthKey: col.monthKey });
		});
		return ticks;
	}, [columns, width, isCurve, geometry]);

	const modeLabel = (m: TokenActivityMode): string => {
		if (m === "daily") return labels.daily;
		if (m === "weekly") return labels.weekly;
		return labels.cumulative;
	};

	return (
		<div
			className={
				embedded
					? undefined
					: "rounded-xl border border-border/50 bg-card/40 p-4 backdrop-blur-sm"
			}
		>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-[13px] font-semibold text-foreground">{labels.title}</h3>
				<div className="flex rounded-lg border border-border/50 bg-muted/30 p-0.5">
					{MODES.map((m) => (
						<button
							key={m}
							type="button"
							onClick={() => setMode(m)}
							className={cn(
								"rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
								mode === m
									? "bg-background text-foreground ring-1 ring-inset ring-border/60"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{modeLabel(m)}
						</button>
					))}
				</div>
			</div>

			{loading ? (
				<div className="h-[132px] animate-pulse rounded-lg bg-muted/40" />
			) : (
				<div className="relative">
					{hoverCol && (
						<div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-0.5 rounded-lg border border-border/60 bg-popover/95 px-2.5 py-1 text-[11px] text-popover-foreground">
							<span className="text-muted-foreground">
								{hoverCol.date === hoverCol.endDate
									? hoverCol.date
									: `${hoverCol.date} → ${hoverCol.endDate}`}
							</span>
							{" · "}
							{labels.tokens(formatTokenCount(hoverCol.tokens))}
						</div>
					)}

					<div ref={trackRef} className="w-full overflow-hidden pt-5" onMouseLeave={() => setHoverKey(null)}>
						{capacity > 0 && (
							<div className="flex w-full flex-col gap-1.5">
								{isCurve && geometry ? (
									<div
										className="relative w-full text-primary"
										style={{ height: curveHeight || undefined }}
									>
										<svg
											className="absolute inset-0 h-full w-full"
											viewBox="0 0 100 100"
											preserveAspectRatio="none"
											aria-hidden="true"
											focusable="false"
										>
											<defs>
												<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
													<stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
													<stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
												</linearGradient>
											</defs>
											{geometry.areaPath && <path d={geometry.areaPath} fill={`url(#${gradientId})`} />}
											{geometry.linePath && (
												<path
													d={geometry.linePath}
													fill="none"
													stroke="currentColor"
													strokeWidth={1.5}
													strokeLinecap="round"
													strokeLinejoin="round"
													vectorEffect="non-scaling-stroke"
												/>
											)}
										</svg>
										{hoverPoint && (
											<>
												<span
													className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/30"
													style={{ left: `${hoverPoint.x}%` }}
												/>
												<span
													className="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
													style={{ left: `${hoverPoint.x}%`, top: `${hoverPoint.y}%` }}
												/>
											</>
										)}
										{/* 曲线本身不可命中，用覆盖在数据点上的透明分区复用矩阵那套悬停逻辑 */}
										{hoverZones.map((zone) => (
											<div
												key={zone.key}
												className="absolute top-0 bottom-0"
												style={{ left: `${zone.left}%`, width: `${zone.width}%` }}
												onMouseEnter={() => setHoverKey(zone.key)}
											/>
										))}
									</div>
								) : (
									<div className="flex w-full items-end" style={{ gap: TOKEN_ACTIVITY_GAP_PX }}>
										{columns.map((col) => {
											const filled = activityBlockCount(col.tokens, maxTokens);
											const level = activityIntensityLevel(col.tokens, maxTokens);
											const active = hoverKey === col.key;
											const fillClass =
												level > 0
													? active
														? FILLED_ACTIVE_CLASS[level]
														: FILLED_CLASS[level]
													: undefined;
											return (
												<div
													key={col.key}
													className="flex min-w-0 flex-1 flex-col-reverse"
													style={{ gap: TOKEN_ACTIVITY_GAP_PX }}
													onMouseEnter={() => {
														if (!col.isPad) setHoverKey(col.key);
													}}
												>
													{Array.from({ length: TOKEN_ACTIVITY_MAX_ROWS }, (_, row) => {
														const isFilled = row < filled;
														return (
															<div
																key={row}
																className={cn(
																	"aspect-square w-full rounded-[2px] transition-colors",
																	isFilled ? fillClass : "bg-muted",
																)}
															/>
														);
													})}
												</div>
											);
										})}
									</div>
								)}

								<div className="relative mt-0.5 h-4">
									{monthTicks.map((tick) => (
										<span
											key={tick.key}
											className="absolute whitespace-nowrap text-[10px] text-muted-foreground"
											style={{ left: `${tick.leftPercent}%` }}
										>
											{labels.month(tick.monthKey)}
										</span>
									))}
								</div>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
