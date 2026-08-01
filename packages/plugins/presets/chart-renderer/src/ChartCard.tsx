import { type PluginCardProps, useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import {
	ArcElement,
	BarElement,
	CategoryScale,
	Chart as ChartJS,
	Filler,
	Legend,
	LinearScale,
	LineElement,
	PointElement,
	RadialLinearScale,
	Tooltip,
} from "chart.js";
import { useRef } from "react";
import { Bar, Bubble, Doughnut, Line, Pie, PolarArea, Radar, Scatter } from "react-chartjs-2";

ChartJS.register(
	ArcElement,
	BarElement,
	CategoryScale,
	Filler,
	Legend,
	LinearScale,
	LineElement,
	PointElement,
	RadialLinearScale,
	Tooltip,
);

type ChartItem = {
	type: "line" | "bar" | "pie" | "doughnut" | "polarArea" | "radar" | "scatter" | "bubble";
	data: Record<string, unknown>;
	options?: Record<string, unknown>;
	title?: string;
	description?: string;
	height: number;
};
type ChartPayload = ChartItem | { charts: ChartItem[] };

const charts = {
	bar: Bar,
	line: Line,
	pie: Pie,
	doughnut: Doughnut,
	polarArea: PolarArea,
	radar: Radar,
	scatter: Scatter,
	bubble: Bubble,
};

function ChartPanel({ item }: { item: ChartItem }) {
	const { t } = useTranslation();
	const ref = useRef<ChartJS | null>(null);
	const Chart = charts[item.type] ?? Bar;
	const options = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: { legend: { display: true, position: "bottom" }, tooltip: { enabled: true } },
		...item.options,
	};
	const download = () => {
		const image = ref.current?.toBase64Image();
		if (!image) return;
		const link = document.createElement("a");
		link.href = image;
		link.download = "chart.png";
		link.click();
	};
	return (
		<section className="group min-w-0 rounded-xl border border-[color-mix(in_srgb,var(--border)_75%,transparent)] bg-[var(--background)] p-3 shadow-sm">
			<header className="mb-2 flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="truncate text-sm font-semibold text-[var(--foreground)]">
						{item.title ?? t("chart.defaultTitle")}
					</h3>
					{item.description && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{item.description}</p>}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={t("action.downloadPng")}
					title={t("action.downloadPng")}
					className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
					onClick={download}
				>
					<svg
						aria-hidden="true"
						className="size-4"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M12 3v12" />
						<path d="m7 10 5 5 5-5" />
						<path d="M5 21h14" />
					</svg>
				</Button>
			</header>
			<div style={{ height: item.height }}>
				<Chart ref={ref as never} data={item.data as never} options={options as never} />
			</div>
		</section>
	);
}

export function ChartVisual({ payload, pending }: { payload?: ChartPayload; pending: boolean }) {
	const { t } = useTranslation();
	if (pending)
		return (
			<div className="my-2 rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]">
				{t("state.preparing")}
			</div>
		);
	if (!payload) return null;
	const items = "charts" in payload ? payload.charts : [payload];
	return (
		<div className="my-2 grid min-w-0 grid-cols-1 gap-3">
			{items.slice(0, 4).map((item, index) => (
				<ChartPanel item={item} key={`${item.title ?? item.type}-${index}`} />
			))}
		</div>
	);
}

export function ChartCard({ descriptor, pending }: PluginCardProps) {
	return <ChartVisual payload={descriptor.payload as ChartPayload | undefined} pending={pending} />;
}
