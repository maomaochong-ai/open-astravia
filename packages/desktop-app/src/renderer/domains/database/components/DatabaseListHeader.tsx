import type { JSX, ReactNode } from "react";
import { cn } from "@astravia/ui";
import { DatabaseBadge } from "./DatabaseBadge";
import { DatabaseSectionLabel } from "./DatabaseSectionLabel";

interface DatabaseListHeaderProps {
	/** 列表/树标题（如「连接」）。 */
	label: string;
	/** 计数徽章；不传或为 0 时不显示。 */
	count?: number;
	/** 头部右侧动作（如浮层抽屉的折叠按钮）。 */
	action?: ReactNode;
	/** 形态：default=小节标题（宽松），toolbar=dbx 式紧凑工具条（h-9 px-3 border-b）。 */
	variant?: "default" | "toolbar";
	className?: string;
}

/**
 * 连接列表/连接树头部唯一定义（B2.6-U U2 列表/树头部收敛）：
 * section label + 计数徽章 + 可选动作，设置页列表、标签页树与浮层抽屉共用。
 */
export function DatabaseListHeader({
	label,
	count,
	action,
	variant = "default",
	className,
}: DatabaseListHeaderProps): JSX.Element {
	if (variant === "toolbar") {
		// 对齐 dbx AppSidebar 顶栏（h-9 px-3 gap-px border-b bg-muted/20 text-xs）：
		// 左标题纯文字、中间弹性空隙、右按钮组，常态不显示计数徽章。
		return (
			<div
				className={cn(
					"flex h-9 shrink-0 items-center gap-px border-b bg-muted/20 px-3 text-xs font-medium text-muted-foreground",
					className,
				)}
			>
				<span className="min-w-0 truncate">{label}</span>
				<span className="flex-1" />
				{action}
			</div>
		);
	}
	return (
		<div className={cn("flex items-center justify-between px-4 pt-3.5 pb-2", className)}>
			<DatabaseSectionLabel>{label}</DatabaseSectionLabel>
			<div className="flex shrink-0 items-center gap-1.5">
				{count !== undefined && count > 0 ? <DatabaseBadge variant="count">{count}</DatabaseBadge> : null}
				{action}
			</div>
		</div>
	);
}
