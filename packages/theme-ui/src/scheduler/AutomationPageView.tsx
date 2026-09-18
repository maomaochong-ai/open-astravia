import type { JSX, ReactNode } from "react";
import { motion } from "motion/react";
import { Button } from "@vetta-org/ui";

const easeOut = [0.22, 1, 0.36, 1] as const;

export interface AutomationRecommendationItem {
	readonly id: string;
	readonly icon: string;
	readonly title: string;
	readonly description: string;
	readonly scheduleLabel: string;
}

export interface AutomationPageViewLabels {
	readonly title: string;
	readonly subtitle: string;
	readonly newTask: string;
	readonly newTaskTitle: string;
	/** @deprecated Empty hero removed; kept optional for host compatibility. */
	readonly emptyTitle?: string;
	readonly emptyDesc?: string;
	readonly emptyAction?: string;
	/** Section heading above recommended templates when the user has no tasks. */
	readonly recommendTitle?: string;
	/** Optional CTA on each recommendation card. */
	readonly recommendUse?: string;
}

export interface AutomationPageViewProps {
	readonly hasTasks: boolean;
	/** Optional trailing header actions (e.g. AI assist), rendered before the primary CTA. */
	readonly headerTrailing?: ReactNode;
	readonly labels: AutomationPageViewLabels;
	readonly onNewTask: () => void;
	/** Host-owned TaskList / empty handled here when hasTasks. */
	readonly taskList: ReactNode;
	readonly historyDrawer: ReactNode;
	readonly taskFormDialog: ReactNode;
	/** Recommended templates shown only when `hasTasks` is false. */
	readonly recommendations?: readonly AutomationRecommendationItem[];
	readonly onSelectRecommendation?: (id: string) => void;
}

export function AutomationPageView({
	hasTasks,
	headerTrailing,
	labels,
	onNewTask,
	taskList,
	historyDrawer,
	taskFormDialog,
	recommendations,
	onSelectRecommendation,
}: AutomationPageViewProps): JSX.Element {
	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<div className="drag-region h-6 shrink-0" />

			<div className="relative shrink-0 px-8 pb-4">
				<div className="flex items-end justify-between gap-4">
					<motion.div
						initial={false}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.5, ease: easeOut }}
					>
						<h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-[26px] font-bold leading-tight tracking-tight text-transparent">
							{labels.title}
						</h1>
						<p className="mt-1 text-[12px] text-muted-foreground/60">{labels.subtitle}</p>
					</motion.div>

					<div className="flex items-center gap-2">
						{headerTrailing}
						<Button type="button" variant="primary" onClick={onNewTask} title={labels.newTaskTitle}>
							<span className="icon-[mdi--plus] text-[15px]" />
							{labels.newTask}
						</Button>
					</div>
				</div>
			</div>

			<div className="flex flex-1 flex-col gap-5 overflow-y-auto px-8 pt-5 pb-6">
				{hasTasks ? (
					taskList
				) : (
					<AutomationRecommendations
						recommendTitle={labels.recommendTitle}
						recommendUse={labels.recommendUse}
						recommendations={recommendations}
						onSelectRecommendation={onSelectRecommendation}
					/>
				)}
			</div>

			{historyDrawer}
			{taskFormDialog}
		</div>
	);
}

function AutomationRecommendations({
	recommendTitle,
	recommendUse,
	recommendations,
	onSelectRecommendation,
}: {
	readonly recommendTitle?: string;
	readonly recommendUse?: string;
	readonly recommendations?: readonly AutomationRecommendationItem[];
	readonly onSelectRecommendation?: (id: string) => void;
}): JSX.Element | null {
	if (!recommendations || recommendations.length === 0) return null;

	return (
		<motion.div
			className="flex w-full flex-col gap-3"
			initial={false}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.5, ease: easeOut }}
		>
			{recommendTitle ? (
				<p className="text-[12px] font-medium tracking-wide text-muted-foreground/70">{recommendTitle}</p>
			) : null}
			<div className="grid grid-cols-3 gap-4">
				{recommendations.map((item, index) => (
					<motion.button
						key={item.id}
						type="button"
						initial={false}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.4, delay: 0.05 * index, ease: easeOut }}
						onClick={() => onSelectRecommendation?.(item.id)}
						className="group flex cursor-pointer flex-col rounded-xl border border-border/50 bg-card/40 p-4 text-left backdrop-blur-sm transition-colors duration-200 hover:border-primary/40 hover:bg-card/60"
					>
						<div className="flex items-start gap-3">
							<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/15">
								<span className={`${item.icon} h-4 w-4 text-primary`} />
							</div>
							<div className="min-w-0 flex-1">
								<p className="truncate text-[13px] font-semibold text-foreground">{item.title}</p>
								<p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">{item.scheduleLabel}</p>
							</div>
						</div>
						<p className="mt-3 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/70">
							{item.description}
						</p>
						{recommendUse && (
							<span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary opacity-80 transition-opacity group-hover:opacity-100">
								{recommendUse}
								<span className="icon-[mdi--arrow-right] h-3.5 w-3.5" />
							</span>
						)}
					</motion.button>
				))}
			</div>
		</motion.div>
	);
}
