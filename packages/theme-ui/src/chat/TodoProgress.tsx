import type { CSSProperties, JSX } from "react";
import { cn } from "@vetta-org/ui";
import { ActivityStatusDot, ActivityStatusDotStyles } from "../shared/ActivityStatusDot";

export interface TodoStatusItem {
	readonly id: number;
	readonly content: string;
	readonly status: "pending" | "in_progress" | "done";
}

export interface TodoStatusSummary {
	readonly total: number;
	readonly done: number;
	readonly allDone: boolean;
	/** 形如 `2/5`，供触发器与面板共用。 */
	readonly progressLabel: string;
	readonly percent: number;
	/** 进行中的条目优先，其次第一条待办；全部完成时为 null。 */
	readonly activeContent: string | null;
}

/** 纯派生：触发器与活动面板共用同一套进度语义。 */
export function selectTodoStatusSummary(items: readonly TodoStatusItem[]): TodoStatusSummary {
	const total = items.length;
	const done = items.filter((item) => item.status === "done").length;
	const active =
		items.find((item) => item.status === "in_progress") ?? items.find((item) => item.status === "pending");
	return {
		total,
		done,
		allDone: total > 0 && done === total,
		progressLabel: `${done}/${total}`,
		percent: total > 0 ? (done / total) * 100 : 0,
		activeContent: active?.content ?? null,
	};
}

export interface TodoTimelineLabels {
	readonly statusDone: string;
	readonly statusInProgress: string;
	readonly statusPending: string;
}

/**
 * 待办专属的动效，全部读 theme-ui styles.css 里的共享步进时钟（--vetta-live-phase /
 * --vetta-live-wave，每 100ms 一步），而不是各自跑 60fps 关键帧——毛玻璃窗口每出一帧都要
 * 整窗重合成，一个任务里同时亮着的标签和转弧各自逐帧插值会把 GPU 顶满。
 * - `todo-label-sheen`：标签的呼吸（只动 opacity；别改回 background-position 扫光，那会每帧重绘文字）
 * - `todo-marker-spin`：进行中条目的转动弧（16 步一圈的步进转动）
 *
 * 元素同时要带 `vetta-live-phase` 类，时钟才会因它们启动。
 * 状态点的呼吸动画不在这里——它和底部面板共用 `ActivityStatusDotStyles`。
 */
export const TODO_PROGRESS_CSS = `
.todo-label-sheen { opacity: calc(1 - 0.4 * var(--vetta-live-wave)); }
.todo-marker-spin { transform: rotate(calc(var(--vetta-live-phase) * 360deg)); }
`;

/** 关键帧注入点：每个待办根节点渲染一次，样式内容相同不会互相干扰。 */
export function TodoProgressStyles(): JSX.Element {
	return (
		<>
			<style>{TODO_PROGRESS_CSS}</style>
			<ActivityStatusDotStyles />
		</>
	);
}

/** 标签呼吸：进行中用主色轻微呼吸；静态时退回纯色，避免完成态还在闪。 */
export function todoLabelSheenStyle(active: boolean): CSSProperties {
	return { color: active ? "var(--primary)" : "var(--muted-foreground)" };
}

/** 与 `todoLabelSheenStyle(true)` 配套的类名：呼吸本身由共享时钟驱动，见 TODO_PROGRESS_CSS。 */
export function todoLabelSheenClassName(active: boolean): string | undefined {
	return active ? "vetta-live-phase todo-label-sheen" : undefined;
}

/**
 * 状态点：未完成时是呼吸的主色点，全部完成时是静止的绿点。
 * 取代了原先的数字徽标。
 */
export function TodoStatusDot({ allDone, className }: { allDone: boolean; className?: string }): JSX.Element {
	return <ActivityStatusDot pulse={!allDone} tone={allDone ? "emerald" : "primary"} className={className} />;
}

/** 细进度条：popover 头部与活动面板头部共用。 */
export function TodoProgressBar({ percent, className }: { percent: number; className?: string }): JSX.Element {
	return (
		<div className={cn("h-1 overflow-hidden rounded-full bg-muted/60", className)}>
			<div
				className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
				style={{ width: `${percent}%` }}
			/>
		</div>
	);
}

function TodoMarker({ status }: { status: TodoStatusItem["status"] }): JSX.Element {
	if (status === "done") {
		return (
			<span className="flex h-[15px] w-[15px] items-center justify-center rounded-full bg-primary text-primary-foreground">
				<span aria-hidden className="icon-[mdi--check] h-2.5 w-2.5" />
			</span>
		);
	}
	if (status === "in_progress") {
		return (
			<span className="relative flex h-[15px] w-[15px] items-center justify-center">
				<span className="absolute inset-0 rounded-full border border-primary/25" />
				<span className="vetta-live-phase todo-marker-spin absolute inset-0 rounded-full border border-transparent border-t-primary border-r-primary" />
				<span className="h-1 w-1 rounded-full bg-primary" />
			</span>
		);
	}
	return <span className="h-[15px] w-[15px] rounded-full border border-muted-foreground/30" />;
}

export interface TodoTimelineProps {
	readonly items: readonly TodoStatusItem[];
	readonly labels: TodoTimelineLabels;
	/** `sm` 用于 popover，`md` 用于活动面板。 */
	readonly size?: "sm" | "md";
	readonly className?: string;
}

/** 待办清单本体：左侧连成一条时间线，进行中条目高亮并带光斑。 */
export function TodoTimeline({ items, labels, size = "sm", className }: TodoTimelineProps): JSX.Element {
	const text = size === "sm" ? "text-[12px]" : "text-[13px]";
	const rowPadding = size === "sm" ? "px-2 py-1.5" : "px-2.5 py-2";
	// 连接线要跨过行间距接上下一个圆点：向下溢出正好一个行内边距。
	const connectorBottom = size === "sm" ? "-6px" : "-8px";
	return (
		<ul className={cn("flex flex-col", className)}>
			{items.map((item, index) => {
				const isDone = item.status === "done";
				const isActive = item.status === "in_progress";
				const statusLabel = isDone
					? labels.statusDone
					: isActive
						? labels.statusInProgress
						: labels.statusPending;
				return (
					<li
						key={item.id}
						className={cn(
							"group relative flex items-start gap-2.5 rounded-lg transition-colors",
							rowPadding,
							isActive ? "bg-primary/[0.06]" : "hover:bg-muted/40",
						)}
					>
						<span className="relative flex w-[15px] shrink-0 flex-col items-center self-stretch">
							<TodoMarker status={item.status} />
							{index < items.length - 1 && (
								<span
									aria-hidden
									className="absolute left-1/2 top-[17px] w-px -translate-x-1/2 bg-border"
									style={{ bottom: connectorBottom }}
								/>
							)}
						</span>
						<span
							className={cn(
								"min-w-0 flex-1 leading-snug transition-colors",
								text,
								isDone && "text-muted-foreground line-through decoration-muted-foreground/40",
								!isDone && !isActive && "text-foreground",
								todoLabelSheenClassName(isActive),
							)}
							style={isActive ? todoLabelSheenStyle(true) : undefined}
							title={item.content}
						>
							{item.content}
						</span>
						<span className="sr-only">{statusLabel}</span>
					</li>
				);
			})}
		</ul>
	);
}
