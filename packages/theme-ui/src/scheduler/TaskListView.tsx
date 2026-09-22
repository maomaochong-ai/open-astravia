import { cn } from "@vetta-org/ui";
import type { JSX } from "react";

/** active 已开启、running 运行中、paused 已暂停、suspended 目标失效而暂停、done 一次性任务已完成。 */
export type TaskListItemTone = "active" | "running" | "paused" | "suspended" | "done";

export interface TaskListItemView {
	readonly id: string;
	readonly name: string;
	/** 第二行，如「每天 9:00 · 下次运行 18 小时后」。 */
	readonly subtitle: string;
	readonly tone: TaskListItemTone;
	readonly isSelected: boolean;
}

export interface TaskListViewProps {
	readonly items: readonly TaskListItemView[];
	/** 筛选或搜索后为空时的提示；无任务时由页面展示推荐模板，传 undefined 即不显示。 */
	readonly emptyLabel?: string;
	readonly onSelectTask: (id: string) => void;
}

const TONE_ICON: Record<TaskListItemTone, string> = {
	active: "icon-[mdi--circle-outline] text-muted-foreground",
	running: "icon-[mdi--progress-clock] text-primary",
	paused: "icon-[mdi--pause-circle-outline] text-muted-foreground/60",
	suspended: "icon-[mdi--alert-circle-outline] text-amber-500",
	done: "icon-[mdi--check-circle-outline] text-muted-foreground/60",
};

/** 单行列表：状态圆点 + 名称 + 计划摘要。只有背景色过渡，没有位移或缩放动画。 */
export function TaskListView({ items, emptyLabel, onSelectTask }: TaskListViewProps): JSX.Element {
	if (items.length === 0) {
		return emptyLabel ? (
			<p className="px-3 py-8 text-center text-[13px] text-muted-foreground/60">{emptyLabel}</p>
		) : (
			<></>
		);
	}
	return (
		<ul className="flex flex-col gap-1">
			{items.map((item) => (
				<li key={item.id}>
					<button
						type="button"
						aria-current={item.isSelected ? "true" : undefined}
						onClick={() => onSelectTask(item.id)}
						className={cn(
							"flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
							item.isSelected ? "bg-accent" : "hover:bg-accent/50",
						)}
					>
						<span aria-hidden="true" className={cn(TONE_ICON[item.tone], "mt-0.5 h-4 w-4 shrink-0")} />
						<span className="min-w-0 flex-1">
							<span
								className={cn(
									"block truncate text-[14px]",
									item.tone === "paused" || item.tone === "done" ? "text-muted-foreground" : "text-foreground",
								)}
							>
								{item.name}
							</span>
							<span className="mt-0.5 block truncate text-[12px] text-muted-foreground/70">{item.subtitle}</span>
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}
