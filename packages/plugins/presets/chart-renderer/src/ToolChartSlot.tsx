import { type PluginToolCallSlotProps, useTranslation } from "@vetta-org/plugin-sdk";
import { ChartVisual } from "./ChartCard";

type ChartArgs = {
	type?: string;
	data?: Record<string, unknown>;
	options?: Record<string, unknown>;
	title?: string;
	description?: string;
	height?: number;
	charts?: Array<Record<string, unknown>>;
};

export function ToolChartSlot({ toolCall }: PluginToolCallSlotProps) {
	const { t } = useTranslation();
	const args = (toolCall.args && typeof toolCall.args === "object" ? toolCall.args : {}) as ChartArgs;
	const rawCharts = Array.isArray(args.charts) ? args.charts : args.data ? [args] : [];
	const payload =
		rawCharts.length > 0
			? {
					charts: rawCharts.map((chart) => ({
						...chart,
						height: Math.max(180, Math.min(560, Math.round(Number(chart.height ?? 300)))),
					})),
				}
			: undefined;
	const pending = toolCall.status === "pending";
	const cancelled = toolCall.status === "cancelled";
	const failed = toolCall.status === "error" || toolCall.isError;

	if (cancelled)
		return (
			<div className="my-1 rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
				{t("state.cancelled")}
			</div>
		);
	if (failed)
		return (
			<div className="my-1 rounded-xl border border-[var(--destructive,#ef4444)]/30 px-3 py-2 text-xs text-[var(--destructive,#ef4444)]">
				{t("error.invalidArgs")}
			</div>
		);
	if (!payload)
		return (
			<div className="my-1 rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
				{pending ? t("state.preparing") : t("error.unavailable")}
			</div>
		);
	return <ChartVisual payload={payload as never} pending={pending} />;
}
