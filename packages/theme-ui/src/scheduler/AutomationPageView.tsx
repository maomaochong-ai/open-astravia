import { Button, cn } from "@vetta-org/ui";
import type { JSX, ReactNode } from "react";
import { SegmentedControl } from "../shared/SegmentedControl";

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
	readonly title: string;
	readonly subtitle: string;
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
	/** Task list (or its empty state). */
	readonly list: ReactNode;
	/** Recommended templates shown under the list when the user has no tasks. */
	readonly recommendations?: readonly AutomationRecommendationItem[];
	readonly onSelectRecommendation?: (id: string) => void;
	/** Right split pane (edit / create / history). The list narrows while it is open. */
	readonly detailPane?: ReactNode;
}

/**
 * 自动化页：与能力页同样的大标题与说明；下方左列是可筛选、可搜索的任务列表，
 * 右侧是编辑与执行历史的分屏。刻意不用入场动画、毛玻璃与模糊，控制合成开销。
 */
export function AutomationPageView<FilterKey extends string>({
	labels,
	filters,
	activeFilter,
	onFilterChange,
	searchValue,
	onSearchChange,
	onCreate,
	list,
	recommendations,
	onSelectRecommendation,
	detailPane,
}: AutomationPageViewProps<FilterKey>): JSX.Element {
	const paneOpen = Boolean(detailPane);
	return (
		<div className="flex h-full w-full flex-1 flex-col overflow-hidden">
			<div className="drag-region h-6 shrink-0" />
			<header className="flex shrink-0 items-end justify-between gap-4 px-8 pb-4">
				<div className="min-w-0">
					<h1 className="text-[26px] font-bold leading-tight tracking-tight text-foreground">{labels.title}</h1>
					<p className="mt-1 text-[12px] text-muted-foreground/60">{labels.subtitle}</p>
				</div>
				<Button type="button" variant="primary" size="sm" onClick={onCreate}>
					<span className="icon-[mdi--plus] h-3.5 w-3.5" />
					{labels.create}
				</Button>
			</header>

			<div className="flex min-h-0 flex-1 border-t border-border/60">
				<section
					className={cn(
						"flex min-w-0 flex-col pt-4",
						paneOpen ? "w-[400px] shrink-0 border-r border-border/60" : "flex-1",
					)}
				>
					<div className={cn("flex w-full flex-col gap-3 px-8", paneOpen && "px-5", !paneOpen && "mx-auto max-w-4xl")}>
						<SegmentedControl
							className="self-start"
							items={filters.map((filter) => ({ key: filter.key, label: filter.label }))}
							value={activeFilter}
							onChange={onFilterChange}
							suppressLayoutAnimation
						/>
						<label className="relative block">
							<span className="icon-[solar--magnifer-linear] absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
							<input
								type="search"
								value={searchValue}
								onChange={(event) => onSearchChange(event.target.value)}
								placeholder={labels.searchPlaceholder}
								className="h-8 w-full rounded-lg bg-secondary pl-8 pr-3 text-[12px] text-foreground placeholder:text-muted-foreground/40 transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
							/>
						</label>
					</div>
					<div
						className={cn(
							"mt-3 min-h-0 w-full flex-1 overflow-y-auto px-8 pb-6",
							paneOpen && "px-5",
							!paneOpen && "mx-auto max-w-4xl",
						)}
					>
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
					className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-primary/5"
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
