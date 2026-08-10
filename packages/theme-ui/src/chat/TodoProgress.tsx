import type { CSSProperties, JSX } from "react";
import { cn } from "@vetta/ui";

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
 * 待办视觉基元共用的关键帧：
 * - `todo-dot-halo` / `todo-dot-core`：未完成时的呼吸点
 * - `todo-label-sheen`：标签上扫过的光斑
 * - `todo-marker-spin`：进行中条目的转动弧
 */
export const TODO_PROGRESS_CSS = `
@keyframes todo-dot-halo {
	0% { transform: scale(0.7); opacity: 0.55; }
	70% { transform: scale(2.1); opacity: 0; }
	100% { transform: scale(2.1); opacity: 0; }
}
@keyframes todo-dot-core {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.55; }
}
@keyframes todo-label-sheen { from { background-position: 160% 0; } to { background-position: -160% 0; } }
@keyframes todo-marker-spin { to { transform: rotate(360deg); } }
`;

/** 关键帧注入点：每个待办根节点渲染一次，样式内容相同不会互相干扰。 */
export function TodoProgressStyles(): JSX.Element {
	return <style>{TODO_PROGRESS_CSS}</style>;
}

const SHEEN_BASE = "var(--primary)";
const SHEEN_HIGHLIGHT = "color-mix(in srgb, var(--primary) 35%, white)";

/** 标签光斑：以主色为底、高光横向扫过；静态时退回纯色，避免完成态还在闪。 */
export function todoLabelSheenStyle(active: boolean): CSSProperties {
	if (!active) return { color: "var(--muted-foreground)" };
	return {
		backgroundImage: `linear-gradient(90deg, ${SHEEN_BASE} 0%, ${SHEEN_BASE} 38%, ${SHEEN_HIGHLIGHT} 50%, ${SHEEN_BASE} 62%, ${SHEEN_BASE} 100%)`,
		backgroundSize: "160% 100%",
		WebkitBackgroundClip: "text",
		backgroundClip: "text",
		color: "transparent",
		animation: "todo-label-sheen 2.6s linear infinite",
	};
}

/**
 * 状态点：未完成时是呼吸的主色点，全部完成时是静止的绿点。
 * 取代了原先的数字徽标。
 */
export function TodoStatusDot({ allDone, className }: { allDone: boolean; className?: string }): JSX.Element {
	return (
		<span aria-hidden className={cn("relative flex h-2 w-2 shrink-0 items-center justify-center", className)}>
			{allDone ? (
				<span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-emerald-500)_18%,transparent)]" />
			) : (
				<>
					<span
						className="absolute h-1.5 w-1.5 rounded-full bg-primary"
						style={{ animation: "todo-dot-halo 2.2s ease-out infinite" }}
					/>
					<span
						className="relative h-1.5 w-1.5 rounded-full bg-primary"
						style={{ animation: "todo-dot-core 2.2s ease-in-out infinite" }}
					/>
				</>
			)}
		</span>
	);
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
				<span
					className="absolute inset-0 rounded-full border border-transparent border-t-primary border-r-primary"
					style={{ animation: "todo-marker-spin 1.1s linear infinite" }}
				/>
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
