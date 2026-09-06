import type { JSX } from "react";
import { cn } from "@astravia/ui";
import type { DatabaseConnectionTestStatus } from "../hooks/useDatabaseWorkspaceModel";

/**
 * 连接状态视觉的唯一定义：列表圆点、详情胶囊、结果提示共用同一份色板，
 * 避免相似组件各自声明状态样式。
 */
export const DATABASE_STATUS_STYLES: Readonly<
	Record<DatabaseConnectionTestStatus, { dot: string; pill: string }>
> = {
	ok: {
		dot: "bg-emerald-500",
		pill: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
	},
	failed: {
		dot: "bg-destructive",
		pill: "bg-destructive/12 text-destructive",
	},
	testing: {
		dot: "animate-pulse bg-amber-400",
		pill: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
	},
	untested: {
		dot: "bg-muted-foreground/40",
		pill: "bg-muted text-muted-foreground",
	},
};

export function DatabaseStatusDot({
	status,
	className,
	title,
}: {
	status: DatabaseConnectionTestStatus;
	className?: string;
	/** 悬浮提示（如最近测试时间与详情），缺省无提示。 */
	title?: string;
}): JSX.Element {
	return (
		<span
			className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DATABASE_STATUS_STYLES[status].dot, className)}
			title={title}
		/>
	);
}

/** 无边框软填充状态胶囊。 */
export function DatabaseStatusPill({
	status,
	label,
}: {
	status: DatabaseConnectionTestStatus;
	label: string;
}): JSX.Element {
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
				DATABASE_STATUS_STYLES[status].pill,
			)}
		>
			<DatabaseStatusDot status={status} />
			{label}
		</span>
	);
}
