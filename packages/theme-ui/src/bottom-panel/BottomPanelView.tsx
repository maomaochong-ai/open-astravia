import { cn } from "@vetta-org/ui";
import type { ComponentPropsWithoutRef, JSX, ReactNode } from "react";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { ActivityStatusDot, ActivityStatusDotStyles } from "../shared/ActivityStatusDot";

/** 空闲是静止灰点，活动是脉冲绿点；tab 与折叠 pill 用同一套状态。 */
export type BottomPanelTabStatus = "idle" | "active";

export interface BottomPanelTabViewModel {
	readonly tabId: string;
	readonly label: string;
	/** iconify 类名或 React 节点，与活动面板 tab 的约定一致。 */
	readonly icon?: ReactNode;
	readonly status: BottomPanelTabStatus;
	readonly closable?: boolean;
}

function TabIcon({ icon, className }: { icon: ReactNode; className?: string }): JSX.Element | null {
	if (!icon) return null;
	if (typeof icon === "string") return <span aria-hidden className={cn(icon, "h-3.5 w-3.5 shrink-0", className)} />;
	return (
		<span
			aria-hidden
			className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full", className)}
		>
			{icon}
		</span>
	);
}

export interface BottomPanelFrameProps extends ComponentPropsWithoutRef<"div"> {
	readonly children: ReactNode;
}

/**
 * 面板外框：只负责分层与主题面，边框和圆角由消费方按当前形态给。
 *
 * 面板有两种形态：铺到窗口边缘时只需要一条上边框当分界，收成卡片时才画整圈边框和圆角。
 * 两者写死在这里就得多一个布尔参数，而调用方本来就知道自己是哪一种。
 */
export function BottomPanelFrame({ children, className, ...props }: BottomPanelFrameProps): JSX.Element {
	return (
		<div
			className={cn("relative flex min-h-0 w-full flex-col overflow-hidden bg-background", className)}
			data-theme-surface-root="bottomPanel.panel"
			{...props}
		>
			<ThemeSurface slot="bottomPanel.panel" />
			<ActivityStatusDotStyles />
			<div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">{children}</div>
		</div>
	);
}

export interface BottomPanelTabStripLabels {
	readonly tablist: string;
	readonly close: string;
}

export interface BottomPanelTabStripViewProps {
	readonly tabs: readonly BottomPanelTabViewModel[];
	readonly activeTabId: string | null;
	readonly onSelect: (tabId: string) => void;
	readonly onClose: (tabId: string) => void;
	readonly labels: BottomPanelTabStripLabels;
	/** 右侧工具区（新建 / 分屏 / 收起），由消费方组装具体按钮。 */
	readonly actions?: ReactNode;
	readonly className?: string;
}

export function BottomPanelTabStripView({
	tabs,
	activeTabId,
	onSelect,
	onClose,
	labels,
	actions,
	className,
}: BottomPanelTabStripViewProps): JSX.Element {
	// tab 条与内容之间不画分割线：同一个格子内部再分层会把一格看成两块。
	return (
		<div className={cn("flex h-9 shrink-0 items-center gap-1 px-1.5", className)}>
			{/* 包一层 presentation：tab 与关闭键是两个按钮，嵌套 button 是非法结构。 */}
			<div role="tablist" aria-label={labels.tablist} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
				{tabs.map((tab) => {
					const selected = tab.tabId === activeTabId;
					return (
						<div
							role="presentation"
							key={tab.tabId}
							className={cn(
								"group flex shrink-0 items-center rounded-lg transition-colors",
								selected ? "bg-accent/60" : "hover:bg-accent/40",
							)}
						>
							<button
								type="button"
								role="tab"
								aria-selected={selected}
								onClick={() => onSelect(tab.tabId)}
								className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px]"
							>
								<ActivityStatusDot pulse={tab.status === "active"} tone={tab.status === "active" ? "emerald" : "muted"} />
								<TabIcon icon={tab.icon} />
								<span
									className={cn("max-w-[160px] truncate", selected ? "text-foreground" : "text-muted-foreground")}
								>
									{tab.label}
								</span>
							</button>
							{tab.closable === false ? null : (
								<button
									type="button"
									aria-label={`${labels.close}: ${tab.label}`}
									onClick={() => onClose(tab.tabId)}
									className="mr-1 flex h-4 w-4 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
								>
									<span aria-hidden className="icon-[solar--close-circle-linear] h-3 w-3" />
								</button>
							)}
						</div>
					);
				})}
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
		</div>
	);
}

export interface BottomPanelPillsViewProps {
	readonly pills: readonly BottomPanelTabViewModel[];
	readonly onSelect: (tabId: string) => void;
	readonly labels: { readonly group: string };
	readonly className?: string;
}

/**
 * 面板缩起时的 pill 横排，接在输入框下方待办条右侧。
 * 视觉与待办 pill 同一套（`rounded-full` + 同字号 + 同 hover），保证一行里不出现两种药丸。
 */
export function BottomPanelPillsView({ pills, onSelect, labels, className }: BottomPanelPillsViewProps): JSX.Element {
	return (
		<div aria-label={labels.group} className={cn("flex min-w-0 items-center gap-1", className)}>
			<ActivityStatusDotStyles />
			{pills.map((pill) => (
				<button
					key={pill.tabId}
					type="button"
					title={pill.label}
					onClick={() => onSelect(pill.tabId)}
					className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-[11px] transition-colors hover:bg-accent/50"
				>
					<ActivityStatusDot pulse={pill.status === "active"} tone={pill.status === "active" ? "emerald" : "muted"} />
					<TabIcon icon={pill.icon} className="h-3 w-3" />
					<span className="max-w-[120px] truncate font-medium text-muted-foreground">{pill.label}</span>
				</button>
			))}
		</div>
	);
}

export interface BottomPanelEmptyStateProps {
	readonly title: string;
	readonly description?: string;
	readonly action?: ReactNode;
}

export function BottomPanelEmptyState({ title, description, action }: BottomPanelEmptyStateProps): JSX.Element {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center">
			<span aria-hidden className="icon-[solar--window-frame-linear] h-8 w-8 text-muted-foreground/60" />
			<p className="text-[13px] text-foreground">{title}</p>
			{description ? <p className="text-[12px] text-muted-foreground">{description}</p> : null}
			{action}
		</div>
	);
}

export interface BottomPanelEmptyChoice {
	readonly id: string;
	readonly label: string;
	readonly icon?: ReactNode;
	/** 插件来源名，显示在标签右侧当副标题。 */
	readonly hint?: string;
	readonly disabled?: boolean;
	readonly disabledReason?: string;
}

export interface BottomPanelEmptyPickerProps {
	readonly choices: readonly BottomPanelEmptyChoice[];
	readonly onPick: (id: string) => void;
	readonly label: string;
	readonly className?: string;
}

/**
 * 空屏时把能添加的面板直接摊平成一排可点的项。
 *
 * 空面板里唯一能做的事就是添加第一个 tab，再让用户先点开一层「+」菜单纯属多余。
 */
export function BottomPanelEmptyPicker({
	choices,
	onPick,
	label,
	className,
}: BottomPanelEmptyPickerProps): JSX.Element {
	return (
		<div aria-label={label} className={cn("flex max-w-full flex-wrap items-center justify-center gap-1.5", className)}>
			{choices.map((choice) => (
				<button
					key={choice.id}
					type="button"
					disabled={choice.disabled}
					title={choice.disabled ? choice.disabledReason : undefined}
					onClick={() => onPick(choice.id)}
					className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[12px] transition-colors hover:border-border hover:bg-accent/50 disabled:opacity-40 disabled:hover:border-border/60 disabled:hover:bg-transparent"
				>
					<TabIcon icon={choice.icon} />
					<span className="max-w-[160px] truncate text-foreground">{choice.label}</span>
					{choice.hint ? <span className="shrink-0 text-[11px] text-muted-foreground">{choice.hint}</span> : null}
				</button>
			))}
		</div>
	);
}
