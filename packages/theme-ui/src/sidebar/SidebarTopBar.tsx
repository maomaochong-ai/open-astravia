import type { JSX, ReactNode } from "react";
import { cn } from "@vetta/ui";
import { isMac } from "../utils/platform";

export interface SidebarTopBarClassNames {
	actions?: string;
	brand?: string;
	clawButton?: string;
	collapseButton?: string;
}

export interface SidebarTopBarLabels {
	clawConnected?: string;
	hide: string;
}

export interface SidebarTopBarProps {
	/** 顶栏 actions 区插槽（如工作模式徽章 popover）。渲染在折叠按钮之前。 */
	agentModeSlot?: ReactNode;
	/** Optional host-provided brand icon; omit for text-only brand. */
	brandIcon?: ReactNode;
	/** Host-provided brand trailing content (e.g. connected SidebarUpdateButton). */
	brandTrailing?: ReactNode;
	className?: string;
	classNames?: SidebarTopBarClassNames;
	floating: boolean;
	imOnline?: boolean;
	labels: SidebarTopBarLabels;
	onCollapse?: () => void;
	onOpenClawSettings?: () => void;
}

export function SidebarTopBar({
	agentModeSlot,
	brandIcon,
	brandTrailing,
	className,
	classNames,
	floating,
	imOnline,
	labels,
	onCollapse,
	onOpenClawSettings,
}: SidebarTopBarProps): JSX.Element {
	return (
		<div
			className={cn(
				"flex h-11 min-w-0 shrink-0 items-center justify-between gap-1",
				!floating && "drag-region",
				className,
			)}
			style={{ paddingLeft: isMac ? 78 : 16, paddingRight: 6 }}
		>
			{/* brand 只占内容宽；Mac 常为空，避免 flex-1 吃掉 actions 的测量空间 */}
			{isMac ? (
				<div className={cn("flex min-w-0 shrink items-center overflow-hidden", classNames?.brand)}>
					{brandTrailing}
				</div>
			) : (
				<div className={cn("flex min-w-0 shrink items-center gap-2 overflow-hidden", classNames?.brand)}>
					{brandIcon}
					<span className="truncate text-[13px] font-semibold text-foreground">Vetta</span>
					{brandTrailing}
				</div>
			)}
			{/*
			 * flex-1：actions 始终吃掉剩余宽度。
			 * 这样 badge 收成 icon 后父级宽度仍随侧栏拉宽而变大，才能恢复全文案。
			 */}
			<div className={cn("flex min-w-0 flex-1 items-center justify-end gap-1", classNames?.actions)}>
				{agentModeSlot}
				{imOnline && (
					<button
						type="button"
						onClick={onOpenClawSettings}
						title={labels.clawConnected}
						className={cn(
							"no-drag relative flex h-5 shrink-0 items-center gap-1 rounded-full bg-secondary px-1.5 text-[10px] font-medium text-secondary-foreground transition-colors hover:bg-secondary/80",
							classNames?.clawButton,
						)}
					>
						<span className="relative flex h-1 w-1">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-secondary-foreground opacity-70" />
							<span className="relative inline-flex h-1 w-1 rounded-full bg-secondary-foreground" />
						</span>
						Claw
					</button>
				)}
				{onCollapse && (
					<button
						type="button"
						onClick={onCollapse}
						title={labels.hide}
						className={cn(
							"no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
							classNames?.collapseButton,
						)}
					>
						<span className="icon-[solar--sidebar-minimalistic-linear] h-4 w-4" />
					</button>
				)}
			</div>
		</div>
	);
}
