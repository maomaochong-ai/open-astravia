import { motion } from "motion/react";
import type { JSX, ReactNode } from "react";
import type { BatchTasksPageLabels, BatchTasksPageStatsView } from "./types";

const easeOut = [0.22, 1, 0.36, 1] as const;

export interface BatchTasksPageViewProps {
	/** Dialog host node (BatchProjectDialog). */
	dialog: ReactNode;
	/** Optional trailing header actions (e.g. AI assist), rendered before the primary CTA. */
	headerTrailing?: ReactNode;
	labels: BatchTasksPageLabels;
	/** Task list when projects exist; ignored when empty. */
	list: ReactNode;
	onNewProject: () => void;
	projectCount: number;
	stats: BatchTasksPageStatsView;
}

export function BatchTasksPageView({
	dialog,
	headerTrailing,
	labels,
	list,
	onNewProject,
	projectCount,
	stats,
}: BatchTasksPageViewProps): JSX.Element {
	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<div className="drag-region h-6 shrink-0" />

			<div className="relative shrink-0 px-8 pb-4">
				<div className="flex items-end justify-between gap-4">
					<motion.div
						initial={{ opacity: 0, y: -8 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.5, ease: easeOut }}
					>
						<h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-[26px] font-bold leading-tight tracking-tight text-transparent">
							{labels.title}
						</h1>
						<p className="mt-1 text-[12px] text-muted-foreground/60">{labels.subtitle}</p>
					</motion.div>

					<div className="flex items-center gap-2">
						{stats.total > 0 && <CompactStats labels={labels} stats={stats} />}
						{headerTrailing}
						<button
							type="button"
							onClick={onNewProject}
							className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary px-2.5 text-sm font-medium whitespace-nowrap text-primary-foreground transition-all outline-none select-none hover:bg-primary/90 focus-visible:border-ring"
						>
							<span className="icon-[solar--add-circle-linear] text-[15px]" />
							{labels.newProject}
						</button>
					</div>
				</div>
			</div>

			<div className="flex flex-1 flex-col gap-6 overflow-y-auto px-8 pt-5 pb-6">
				{projectCount === 0 ? <EmptyState labels={labels} onNew={onNewProject} /> : list}
			</div>

			{dialog}
		</div>
	);
}

function CompactStats({
	labels,
	stats,
}: {
	labels: BatchTasksPageLabels;
	stats: BatchTasksPageStatsView;
}): JSX.Element {
	const items: { label: string; value: number; tone: string }[] = [
		{ label: labels.statsTotal, value: stats.total, tone: "text-muted-foreground" },
		{ label: labels.statsRunning, value: stats.running, tone: "text-emerald-400" },
		{ label: labels.statsCompleted, value: stats.completed, tone: "text-emerald-400" },
		{ label: labels.statsFailed, value: stats.failed, tone: "text-destructive" },
	];
	return (
		<motion.div
			initial={{ opacity: 0, y: -4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.35, ease: easeOut, delay: 0.05 }}
			className="hidden items-center gap-3 rounded-full border border-border/40 bg-card/30 px-3 py-1.5 text-[11px] backdrop-blur-sm sm:flex"
		>
			{items.map((item, index) => (
				<div key={item.label} className="flex items-center gap-1.5">
					{index > 0 && <span className="h-3 w-px bg-border/50" />}
					<span className="text-muted-foreground/60">{item.label}</span>
					<span className={`tabular-nums text-[12px] font-semibold leading-none ${item.tone}`}>{item.value}</span>
				</div>
			))}
		</motion.div>
	);
}

function EmptyState({ labels, onNew }: { labels: BatchTasksPageLabels; onNew: () => void }): JSX.Element {
	return (
		<motion.div
			className="flex flex-1 flex-col items-center justify-center gap-5 text-center"
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.5, ease: easeOut }}
		>
			<div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-primary/20">
				<span className="icon-[solar--list-check-linear] relative text-4xl text-primary/80" />
			</div>
			<div className="space-y-1.5">
				<p className="text-[15px] font-semibold text-foreground">{labels.emptyTitle}</p>
				<p className="max-w-xs text-[12px] text-muted-foreground/60">{labels.emptyDesc}</p>
			</div>
			<button
				type="button"
				onClick={onNew}
				className="mt-2 inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary px-2.5 text-sm font-medium whitespace-nowrap text-primary-foreground transition-all outline-none select-none hover:bg-primary/90 focus-visible:border-ring"
			>
				<span className="icon-[solar--add-circle-linear] text-[15px]" />
				{labels.emptyAction}
			</button>
		</motion.div>
	);
}
