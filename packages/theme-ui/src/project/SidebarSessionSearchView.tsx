import { Button, cn } from "@vetta/ui";
import type { DatePickerProps } from "@vetta/ui";
import type { JSX } from "react";
import { SidebarSessionSearchControls } from "./SidebarSessionSearchControls";
import { SidebarSessionSearchResult } from "./SidebarSessionSearchResult";

interface SearchHighlightRange {
	start: number;
	end: number;
}

export interface SidebarSessionSearchViewItem {
	key: string;
	title: string;
	titleHighlights: readonly SearchHighlightRange[];
	sourceLabel: string;
	timeLabel: string;
	timeTitle: string;
	timeDateTime?: string;
	snippet: string;
	snippetHighlights: readonly SearchHighlightRange[];
	pinned: boolean;
	onOpen: () => void;
	onTogglePin: () => void;
}

export interface SidebarSessionSearchViewFilterOption {
	key: string;
	label: string;
}

export interface SidebarSessionSearchViewActiveFilter {
	key: string;
	label: string;
	removeLabel: string;
	onRemove: () => void;
}

export interface SidebarSessionSearchViewTimeFilter {
	value: string;
	options: readonly SidebarSessionSearchViewFilterOption[];
	startDate?: Date;
	endDate?: Date;
	datePicker: Pick<DatePickerProps, "locale" | "labels">;
	error?: string;
	onValueChange: (value: string) => void;
	onStartDateChange: (value: Date | undefined) => void;
	onEndDateChange: (value: Date | undefined) => void;
}

export interface SidebarSessionSearchViewLabels {
	title: string;
	subtitle: string;
	close: string;
	clear: string;
	emptyQuery: string;
	error: string;
	loading: string;
	loadingDescription: string;
	loadingMore: string;
	pin: string;
	placeholder: string;
	project: string;
	type: string;
	unpin: string;
	status: string;
	partial: string;
	noResults: string;
	filters: string;
	filtersActive: string;
	resetFilters: string;
	time: string;
	startDate: string;
	endDate: string;
	timeHint: string;
	newestFirst: string;
	invalidFilters: string;
}

export interface SidebarSessionSearchViewProps {
	autoFocus?: boolean;
	error: boolean;
	items: readonly SidebarSessionSearchViewItem[];
	projectOptions: readonly SidebarSessionSearchViewFilterOption[];
	typeOptions: readonly SidebarSessionSearchViewFilterOption[];
	activeFilters: readonly SidebarSessionSearchViewActiveFilter[];
	filtersExpanded: boolean;
	timeFilter: SidebarSessionSearchViewTimeFilter;
	onToggleFilters: () => void;
	onResetFilters: () => void;
	labels: SidebarSessionSearchViewLabels;
	loading: boolean;
	onClose: () => void;
	onQueryChange: (query: string) => void;
	query: string;
	selectedProject: string;
	selectedType: string;
	onProjectChange: (value: string) => void;
	onTypeChange: (value: string) => void;
}

export function SidebarSessionSearchView(props: SidebarSessionSearchViewProps): JSX.Element {
	const { error, items, labels, loading, onClose, query } = props;
	const hasQuery = Boolean(query.trim());
	const invalidFilters = Boolean(props.timeFilter.error);
	return (
		<section className="flex h-[min(560px,75vh,var(--radix-popover-content-available-height,560px))] min-h-0 flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground">
			<div className="max-h-[60%] shrink-0 overflow-y-auto border-b border-border/50 p-3">
				<div className="mb-2.5 flex items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="text-[15px] font-medium">{labels.title}</h2>
						<p className="mt-1 text-[11px] text-muted-foreground">{labels.subtitle}</p>
					</div>
					<Button aria-label={labels.close} title={labels.close} onClick={onClose} size="icon-xs" variant="ghost">
						<span aria-hidden="true" className="icon-[solar--close-circle-linear] size-3.5" />
					</Button>
				</div>
				<SidebarSessionSearchControls {...props} />
			</div>
			<div role="region" aria-label={labels.title} className="flex min-h-0 flex-1 flex-col">
				{hasQuery && !invalidFilters && loading && items.length > 0 ? <SearchProgress labels={labels} compact /> : null}
				<div className="min-h-0 flex-1 overflow-y-auto p-2">
					{invalidFilters ? <SearchState label={labels.invalidFilters} /> : null}
					{!invalidFilters && !hasQuery && !error ? <SearchState label={labels.emptyQuery} /> : null}
					{!invalidFilters && hasQuery && loading && !error && items.length === 0 ? (
						<SearchProgress labels={labels} />
					) : null}
					{!invalidFilters && hasQuery && !loading && !error && items.length === 0 ? (
						<SearchState label={labels.noResults} />
					) : null}
					{error ? (
						<p
							role="alert"
							className="m-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-3 text-[12px] text-destructive"
						>
							{labels.error}
						</p>
					) : null}
					{!invalidFilters && hasQuery && items.length > 0 ? (
						<ul aria-label={labels.title} className="space-y-1">
							{items.map((item) => (
								<SidebarSessionSearchResult key={item.key} item={item} labels={labels} />
							))}
						</ul>
					) : null}
				</div>
			</div>
			{!invalidFilters && (hasQuery || labels.partial) ? (
				<div
					role="status"
					aria-live={loading ? "off" : "polite"}
					className="shrink-0 border-t border-border/50 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground"
				>
					{hasQuery ? (
						<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
							<p>{labels.status}</p>
							<p>{labels.newestFirst}</p>
						</div>
					) : null}
					{labels.partial ? <p className="mt-1">{labels.partial}</p> : null}
				</div>
			) : null}
		</section>
	);
}

function SearchProgress({
	labels,
	compact = false,
}: {
	labels: SidebarSessionSearchViewLabels;
	compact?: boolean;
}): JSX.Element {
	return (
		<div
			role="status"
			className={cn(
				compact
					? "flex shrink-0 items-center gap-2 border-b border-primary/15 bg-primary/5 px-3 py-2 text-[12px] text-primary"
					: "flex h-full min-h-32 flex-col items-center justify-center gap-3 px-6 py-8 text-center",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"icon-[solar--refresh-linear] shrink-0 animate-spin motion-reduce:animate-none text-primary",
					compact ? "size-3.5" : "size-8",
				)}
			/>
			<p className={cn("font-medium", !compact && "text-[13px]")}>{compact ? labels.loadingMore : labels.loading}</p>
			{!compact ? (
				<p className="max-w-72 text-[12px] leading-5 text-muted-foreground">{labels.loadingDescription}</p>
			) : null}
		</div>
	);
}

function SearchState({ label }: { label: string }): JSX.Element {
	return (
		<div className="flex h-full min-h-24 flex-col items-center justify-center gap-3 px-6 py-8 text-center text-muted-foreground">
			<span aria-hidden="true" className="icon-[solar--magnifer-linear] size-8 opacity-60" />
			<p className="max-w-72 text-[12px] leading-5">{label}</p>
		</div>
	);
}
