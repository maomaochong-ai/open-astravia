import { cn } from "@vetta-org/ui";
import type { JSX, ReactNode } from "react";

export interface AutomationRecommendationItem {
	readonly id: string;
	readonly icon: string;
	readonly title: string;
	readonly description: string;
	readonly scheduleLabel: string;
}

export interface AutomationFilterTab<Key extends string = string> {
	readonly key: Key;
	readonly label: string;
}

export interface AutomationPageViewLabels {
	readonly create: string;
	readonly searchPlaceholder: string;
	/** Section heading above recommended templates when the user has no tasks. */
	readonly recommendTitle?: string;
}

export interface AutomationPageViewProps<FilterKey extends string = string> {
	readonly labels: AutomationPageViewLabels;
	readonly filters: readonly AutomationFilterTab<FilterKey>[];
	readonly activeFilter: FilterKey;
	readonly onFilterChange: (key: FilterKey) => void;
	readonly searchValue: string;
	readonly onSearchChange: (value: string) => void;
	readonly onCreate: () => void;
	/** Optional secondary action (e.g. AI assist), rendered beside the search box. */
	readonly headerTrailing?: ReactNode;
	/** Task list (or its empty state). */
	readonly list: ReactNode;
	/** Recommended templates shown under the list when the user has no tasks. */
	readonly recommendations?: readonly AutomationRecommendationItem[];
	readonly onSelectRecommendation?: (id: string) => void;
	/** Right split pane (edit / create / history). The list narrows while it is open. */
	readonly detailPane?: ReactNode;
}

/**
 * 自动化页：左列是可筛选、可搜索的任务列表，右侧是编辑与执行历史的分屏。
 * 刻意不用入场动画、毛玻璃与模糊：这一页常驻在侧边栏入口里，每一帧的合成代价都要算。
 */
export function AutomationPageView<FilterKey extends string>({
	labels,
	filters,
	activeFilter,
	onFilterChange,
	searchValue,
	onSearchChange,
	onCreate,
	headerTrailing,
	list,
	recommendations,
	onSelectRecommendation,
	detailPane,
}: AutomationPageViewProps<FilterKey>): JSX.Element {
	const paneOpen = Boolean(detailPane);
	return (
		<div className="flex h-full w-full flex-1 overflow-hidden">
			<section
				className={cn(
					"flex min-w-0 flex-col",
					paneOpen ? "w-[400px] shrink-0 border-r border-border/60" : "flex-1",
				)}
			>
				<div className="drag-region h-6 shrink-0" />
				<div className={cn("flex w-full flex-col px-5", !paneOpen && "mx-auto max-w-3xl")}>
					<div className="flex items-center gap-1">
						<div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
							{filters.map((filter) => (
								<button
									key={filter.key}
									type="button"
									role="tab"
									aria-selected={filter.key === activeFilter}
									onClick={() => onFilterChange(filter.key)}
									className={cn(
										"h-7 shrink-0 rounded-md px-2.5 text-[13px] transition-colors",
										filter.key === activeFilter
											? "bg-accent font-medium text-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{filter.label}
								</button>
							))}
						</div>
						<button
							type="button"
							onClick={onCreate}
							className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-foreground px-2.5 text-[13px] font-medium text-background transition-opacity hover:opacity-90"
						>
							<span className="icon-[mdi--plus] h-3.5 w-3.5" />
							{labels.create}
						</button>
					</div>
					<div className="mt-3 flex items-center gap-2">
					<label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3">
						<span className="icon-[mdi--magnify] h-4 w-4 shrink-0 text-muted-foreground/60" />
						<input
							type="search"
							value={searchValue}
							onChange={(event) => onSearchChange(event.target.value)}
							placeholder={labels.searchPlaceholder}
							className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
						/>
					</label>
					{/* 次要入口放在搜索框旁：分屏打开时左列变窄，放进标签行会压住标签。 */}
					{headerTrailing ? <div className="shrink-0">{headerTrailing}</div> : null}
					</div>
				</div>
				<div className={cn("mt-3 min-h-0 w-full flex-1 overflow-y-auto px-5 pb-6", !paneOpen && "mx-auto max-w-3xl")}>
					{list}
					{recommendations && recommendations.length > 0 ? (
						<AutomationRecommendations
							title={labels.recommendTitle}
							recommendations={recommendations}
							onSelect={onSelectRecommendation}
						/>
					) : null}
				</div>
			</section>
			{detailPane ? <section className="flex min-w-0 flex-1 flex-col">{detailPane}</section> : null}
		</div>
	);
}

function AutomationRecommendations({
	title,
	recommendations,
	onSelect,
}: {
	readonly title?: string;
	readonly recommendations: readonly AutomationRecommendationItem[];
	readonly onSelect?: (id: string) => void;
}): JSX.Element {
	return (
		<div className="mt-6 flex flex-col gap-2">
			{title ? <p className="px-1 text-[12px] text-muted-foreground/70">{title}</p> : null}
			{recommendations.map((item) => (
				<button
					key={item.id}
					type="button"
					onClick={() => onSelect?.(item.id)}
					className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/60"
				>
					<span className={cn(item.icon, "mt-0.5 h-4 w-4 shrink-0 text-primary")} />
					<span className="min-w-0 flex-1">
						<span className="block truncate text-[13px] text-foreground">{item.title}</span>
						<span className="mt-0.5 block truncate text-[12px] text-muted-foreground/70">
							{item.scheduleLabel} · {item.description}
						</span>
					</span>
				</button>
			))}
		</div>
	);
}
