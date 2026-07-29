import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
	activityBlockCount,
	activityIntensityLevel,
	buildActivityColumns,
	columnCapacity,
	fitActivityColumns,
	formatTokenCount,
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
	const columns = useMemo(
		() => fitActivityColumns(rawColumns, capacity),
		[rawColumns, capacity],
	);
	const maxTokens = useMemo(() => {
		const values = columns.filter((c) => !c.isPad).map((c) => c.tokens);
		return Math.max(1, ...values, 0);
	}, [columns]);
	const hoverCol = hoverKey ? columns.find((c) => c.key === hoverKey && !c.isPad) : null;

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
																isFilled ? fillClass : "bg-muted/50",
															)}
														/>
													);
												})}
											</div>
										);
									})}
								</div>

								<div className="relative mt-0.5 h-4">
									{columns.map((col, i) =>
										col.monthKey ? (
											<span
												key={col.key}
												className="absolute text-[10px] text-muted-foreground"
												style={{
													left: `${(i / Math.max(columns.length, 1)) * 100}%`,
												}}
											>
												{labels.month(col.monthKey)}
											</span>
										) : null,
									)}
								</div>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
