import type { JSX } from "react";
import {
	selectTodoStatusSummary,
	TodoProgressBar,
	TodoProgressStyles,
	TodoStatusDot,
	type TodoStatusItem,
	TodoTimeline,
	type TodoTimelineLabels,
} from "../chat/TodoProgress";

export interface TodoTabPanelViewLabels extends TodoTimelineLabels {
	/** 未完成时的头部文案，如「进行中」。 */
	readonly headline: string;
	/** 全部完成时的头部文案。 */
	readonly allDone: string;
	/** 形如「已完成 2 / 5」。 */
	readonly progress: (done: number, total: number) => string;
}

export interface TodoTabPanelViewProps {
	readonly items: readonly TodoStatusItem[];
	readonly emptyLabel: string;
	readonly labels: TodoTabPanelViewLabels;
}

/**
 * 活动面板待办页：顶部是状态点 + 百分比 + 进度条的概览，
 * 下面是与输入栏 popover 同一套视觉的时间线清单。
 */
export function TodoTabPanelView({ items, emptyLabel, labels }: TodoTabPanelViewProps): JSX.Element {
	if (items.length === 0) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
				<span aria-hidden className="icon-[solar--checklist-minimalistic-linear] h-6 w-6 text-muted-foreground/50" />
				<span className="text-sm text-muted-foreground">{emptyLabel}</span>
			</div>
		);
	}

	const summary = selectTodoStatusSummary(items);
	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<TodoProgressStyles />
			<div className="shrink-0 border-b border-border px-4 py-3">
				<div className="mb-2 flex items-center gap-2">
					<TodoStatusDot allDone={summary.allDone} />
					<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
						{summary.allDone ? labels.allDone : labels.headline}
					</span>
					<span className="shrink-0 text-[18px] font-semibold leading-none tabular-nums text-foreground">
						{Math.round(summary.percent)}
						<span className="ml-0.5 text-[11px] font-normal text-muted-foreground">%</span>
					</span>
				</div>
				<TodoProgressBar percent={summary.percent} className="h-1.5" />
				<div className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
					{labels.progress(summary.done, summary.total)}
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				<TodoTimeline items={items} labels={labels} size="md" />
			</div>
		</div>
	);
}
