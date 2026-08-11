import { AnimatePresence, motion } from "motion/react";
import { type JSX, useState } from "react";
import { cn, Popover, PopoverContent, PopoverTrigger } from "@vetta/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";
import {
	selectTodoStatusSummary,
	TodoProgressBar,
	TodoProgressStyles,
	TodoStatusDot,
	type TodoStatusItem,
	TodoTimeline,
	type TodoTimelineLabels,
	todoLabelSheenStyle,
} from "./TodoProgress";

export interface TodoStatusBarLabels extends TodoTimelineLabels {
	/** 触发器的无障碍名称。 */
	readonly trigger: string;
	/** 全部完成时替代当前条目的文案。 */
	readonly allDone: string;
	/** popover 头部标题。 */
	readonly panelTitle: string;
	/** 跳转到活动面板待办页。 */
	readonly openPanel: string;
}

export interface TodoStatusBarViewProps {
	readonly items: readonly TodoStatusItem[];
	readonly labels: TodoStatusBarLabels;
	/** 提供时在 popover 底部给出「在面板中打开」入口。 */
	readonly onOpenPanel?: () => void;
	readonly className?: string;
	readonly classNames?: {
		readonly trigger?: string;
		readonly content?: string;
	};
}

/**
 * 输入框外部下方的待办条：状态点 + 进度 + 当前条目（光斑标签）。
 * 点击展开 popover，里面是完整清单；不再使用抽屉与数字徽标。
 */
export function TodoStatusBarView({
	items,
	labels,
	onOpenPanel,
	className,
	classNames,
}: TodoStatusBarViewProps): JSX.Element | null {
	const [open, setOpen] = useState(false);
	if (items.length === 0) return null;

	const summary = selectTodoStatusSummary(items);
	const label = summary.allDone ? labels.allDone : (summary.activeContent ?? labels.allDone);

	return (
		<div className={cn("flex justify-start px-1 pt-1.5", className)}>
			<TodoProgressStyles />
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={labels.trigger}
						title={label}
						className={cn(
							"group flex min-w-0 max-w-full items-center gap-2 rounded-full px-2 py-1 text-[11px] transition-colors",
							open ? "bg-accent/60" : "hover:bg-accent/50",
							classNames?.trigger,
						)}
					>
						<TodoStatusDot allDone={summary.allDone} />
						<span className="shrink-0 tabular-nums text-muted-foreground">{summary.progressLabel}</span>
						<span
							className="min-w-0 flex-1 truncate text-left font-medium"
							style={todoLabelSheenStyle(!summary.allDone)}
						>
							{label}
						</span>
					</button>
				</PopoverTrigger>
				<AnimatePresence>
					{open && (
						<PopoverContent
							forceMount
							asChild
							side="top"
							align="start"
							sideOffset={8}
							className={cn(
								"w-[min(22rem,calc(100vw-2rem))] overflow-visible rounded-xl border border-border p-0",
								classNames?.content,
							)}
							style={{ animation: "none" }}
						>
							<motion.div
								initial={{ opacity: 0, scale: 0.97, y: 6 }}
								animate={{ opacity: 1, scale: 1, y: 0 }}
								exit={{ opacity: 0, scale: 0.97, y: 6 }}
								transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
								className="relative overflow-visible rounded-[inherit]"
							>
								<ThemeSurface slot="chat.todoPanel" />
								<div className="relative z-10 flex max-h-[min(22rem,55vh)] flex-col overflow-hidden rounded-[inherit]">
									<div className="shrink-0 px-3 pb-2 pt-2.5">
										<div className="mb-1.5 flex items-center gap-2">
											<TodoStatusDot allDone={summary.allDone} />
											<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
												{labels.panelTitle}
											</span>
											<span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
												{summary.progressLabel}
											</span>
										</div>
										<TodoProgressBar percent={summary.percent} />
									</div>
									<div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
										<TodoTimeline items={items} labels={labels} size="sm" />
									</div>
									{onOpenPanel && (
										<button
											type="button"
											onClick={() => {
												setOpen(false);
												onOpenPanel();
											}}
											className="flex shrink-0 items-center justify-center gap-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
										>
											<span aria-hidden className="icon-[solar--arrow-right-up-linear] h-3 w-3" />
											{labels.openPanel}
										</button>
									)}
								</div>
							</motion.div>
						</PopoverContent>
					)}
				</AnimatePresence>
			</Popover>
		</div>
	);
}
