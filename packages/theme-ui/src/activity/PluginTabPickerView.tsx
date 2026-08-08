import { useState, type JSX, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@vetta/ui";

export const DEFAULT_PLUGIN_TAB_ICON = "icon-[solar--widget-5-linear]";

function TabIcon({ icon, className }: { icon: ReactNode; className?: string }): JSX.Element {
	if (typeof icon === "string") {
		return <span className={cn(icon, "h-4 w-4 shrink-0", className)} />;
	}
	return (
		<span
			className={cn(
				"flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full",
				className,
			)}
		>
			{icon}
		</span>
	);
}

/** "+"下拉中可恢复显示的已隐藏内置/动态 tab。 */
export interface HiddenTabEntryView {
	readonly key: string;
	readonly label: string;
	readonly icon?: ReactNode;
	/** 可选副标题（如插件显示名）。 */
	readonly subtitle?: string;
}

export interface PluginTabPickerViewLabels {
	readonly menu: string;
	readonly moreTabs: string;
	readonly hiddenPanels: string;
	readonly availablePlugins: string;
}

export interface PluginTabPickerViewProps {
	/** 当前被隐藏、可点击恢复的 tab（内置/动态） */
	readonly hiddenTabs: readonly HiddenTabEntryView[];
	/** 恢复（取消隐藏）某个 tab */
	readonly onRestore: (key: string) => void;
	/** 因宽度不足被响应式收纳、未显示在标签栏上的页签（点击激活并自动让其挤回栏内） */
	readonly overflowTabs: readonly HiddenTabEntryView[];
	/** 激活某个被收纳的页签 */
	readonly onSelectOverflow: (key: string) => void;
	/** 已注册但未 attach 的插件 tab（可添加池） */
	readonly availablePluginTabs?: readonly HiddenTabEntryView[];
	/** 从可添加池 attach 并激活 */
	readonly onAttachPlugin?: (key: string) => void;
	readonly labels: PluginTabPickerViewLabels;
}

/**
 * 活动面板 tab 栏右侧的下拉按钮：可添加池插件 tab、宽度收纳页签、被手动隐藏的页签。
 * 有收纳项或可添加项时常显，否则 hover tab 栏才浮现。
 */
export function PluginTabPickerView({
	hiddenTabs,
	onRestore,
	overflowTabs,
	onSelectOverflow,
	availablePluginTabs = [],
	onAttachPlugin,
	labels,
}: PluginTabPickerViewProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const hasOverflow = overflowTabs.length > 0;
	const hasAvailable = availablePluginTabs.length > 0;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					title={labels.menu}
					aria-label={labels.menu}
					className="mb-0.5 mr-2 flex h-7 min-w-7 shrink-0 items-center justify-center gap-0.5 rounded-md px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					{hasOverflow && (
						<span className="text-[10px] font-semibold tabular-nums leading-none">
							{overflowTabs.length}
						</span>
					)}
					<span
						className={
							hasAvailable
								? "icon-[solar--add-circle-linear] h-4 w-4"
								: "icon-[solar--alt-arrow-down-linear] h-4 w-4"
						}
					/>
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" sideOffset={6} className="w-60 gap-0 p-1.5">
				{availablePluginTabs.length > 0 && onAttachPlugin && (
					<>
						<div className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-muted-foreground">
							{labels.availablePlugins}
						</div>
						{availablePluginTabs.map((tab) => (
							<button
								key={tab.key}
								type="button"
								onClick={() => {
									onAttachPlugin(tab.key);
									setOpen(false);
								}}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
							>
								<TabIcon
									icon={tab.icon ?? DEFAULT_PLUGIN_TAB_ICON}
									className="text-muted-foreground"
								/>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[13px] leading-tight text-foreground">
										{tab.label}
									</span>
									{tab.subtitle && tab.subtitle !== tab.label ? (
										<span className="mt-0.5 block truncate text-[11px] leading-tight text-muted-foreground/70">
											{tab.subtitle}
										</span>
									) : null}
								</span>
								<span className="icon-[solar--add-circle-linear] h-4 w-4 shrink-0 text-muted-foreground" />
							</button>
						))}
					</>
				)}
				{overflowTabs.length > 0 && (
					<>
						<div className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-muted-foreground">
							{labels.moreTabs}
						</div>
						{overflowTabs.map((tab) => (
							<button
								key={tab.key}
								type="button"
								onClick={() => {
									onSelectOverflow(tab.key);
									setOpen(false);
								}}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
							>
								<TabIcon
									icon={tab.icon ?? DEFAULT_PLUGIN_TAB_ICON}
									className="text-muted-foreground"
								/>
								<span className="min-w-0 flex-1 truncate text-[13px] leading-tight text-foreground">
									{tab.label}
								</span>
							</button>
						))}
					</>
				)}
				{hiddenTabs.length > 0 && (
					<>
						<div className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-muted-foreground">
							{labels.hiddenPanels}
						</div>
						{hiddenTabs.map((tab) => (
							<button
								key={tab.key}
								type="button"
								onClick={() => onRestore(tab.key)}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
							>
								<TabIcon
									icon={tab.icon ?? DEFAULT_PLUGIN_TAB_ICON}
									className="text-muted-foreground"
								/>
								<span className="min-w-0 flex-1 truncate text-[13px] leading-tight text-foreground">
									{tab.label}
								</span>
								<span className="icon-[solar--add-circle-linear] h-4 w-4 shrink-0 text-muted-foreground" />
							</button>
						))}
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}
