import type { JSX } from "react";
import { formatTokenCount } from "./token-activity";

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export type UsageStatsRange = "7d" | "30d" | "all";

export const USAGE_STATS_RANGES: UsageStatsRange[] = ["7d", "30d", "all"];

/** 可按区间下钻的指标：单位跟在数值后，卡片下方只留区间切换。 */
export interface UsageStatsMetric {
	onRangeChange: (range: UsageStatsRange) => void;
	range: UsageStatsRange;
	total: number;
	unit: string;
}

export interface UsageStatsViewProps {
	loading?: boolean;
	requests: UsageStatsMetric;
	/** 连续使用天数与区间无关。 */
	streakDays: number;
	tokens: UsageStatsMetric;
	labels: {
		days: (count: number) => string;
		range: (range: UsageStatsRange) => string;
		streak: string;
	};
}

function StatTile({
	children,
	unit,
	value,
}: {
	children: JSX.Element;
	unit?: string;
	value: string;
}): JSX.Element {
	return (
		<div className="min-w-0 rounded-lg border border-border/50 bg-background/40 px-3 py-2.5 text-center">
			<div className="truncate text-[18px] font-semibold tabular-nums text-foreground">
				{value}
				{unit && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{unit}</span>}
			</div>
			<div className="mt-1 flex items-center justify-center gap-2 text-[10px]">{children}</div>
		</div>
	);
}

function MetricTile({
	metric,
	rangeLabel,
}: {
	metric: UsageStatsMetric;
	rangeLabel: (range: UsageStatsRange) => string;
}): JSX.Element {
	return (
		<StatTile unit={metric.unit} value={formatTokenCount(metric.total)}>
			<>
				{USAGE_STATS_RANGES.map((item) => (
					<button
						key={item}
						type="button"
						onClick={() => metric.onRangeChange(item)}
						className={cn(
							"whitespace-nowrap transition-colors",
							metric.range === item
								? "font-medium text-primary"
								: "text-muted-foreground/60 hover:text-foreground",
						)}
					>
						{rangeLabel(item)}
					</button>
				))}
			</>
		</StatTile>
	);
}

export function UsageStatsView({
	loading,
	requests,
	streakDays,
	tokens,
	labels,
}: UsageStatsViewProps): JSX.Element {
	if (loading) return <div className="h-[70px] animate-pulse rounded-lg bg-muted/40" />;

	return (
		<div className="grid grid-cols-3 gap-3">
			<MetricTile metric={tokens} rangeLabel={labels.range} />
			<MetricTile metric={requests} rangeLabel={labels.range} />
			<StatTile value={labels.days(streakDays)}>
				<span className="text-muted-foreground">{labels.streak}</span>
			</StatTile>
		</div>
	);
}
