import {
	Button,
	cn,
	DatePicker,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@vetta/ui";
import type { JSX } from "react";
import { useId, useRef } from "react";
import type { SidebarSessionSearchViewFilterOption, SidebarSessionSearchViewProps } from "./SidebarSessionSearchView";

type SearchControlsProps = Pick<
	SidebarSessionSearchViewProps,
	| "autoFocus"
	| "labels"
	| "query"
	| "onQueryChange"
	| "filtersExpanded"
	| "onToggleFilters"
	| "activeFilters"
	| "onResetFilters"
	| "selectedType"
	| "typeOptions"
	| "onTypeChange"
	| "selectedProject"
	| "projectOptions"
	| "onProjectChange"
	| "timeFilter"
>;

export function SidebarSessionSearchControls(props: SearchControlsProps): JSX.Element {
	const { labels, query, onQueryChange, activeFilters, filtersExpanded } = props;
	const input = useRef<HTMLInputElement>(null);
	const filtersId = useId();
	const timeHintId = useId();
	const timeErrorId = useId();
	const { timeFilter } = props;
	const filterLabel = activeFilters.length > 0 ? labels.filtersActive : labels.filters;
	const changeAndFocus = (change: () => void) => {
		change();
		input.current?.focus();
	};
	return (
		<>
			<div className="flex items-center gap-1.5">
				<div className="relative min-w-0 flex-1">
					<span
						aria-hidden="true"
						className="icon-[solar--magnifer-linear] pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						ref={input}
						autoFocus={props.autoFocus}
						aria-label={labels.placeholder}
						className="h-9 pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
						onChange={(event) => onQueryChange(event.target.value)}
						placeholder={labels.placeholder}
						maxLength={200}
						type="search"
						value={query}
					/>
					{query ? (
						<Button
							aria-label={labels.clear}
							title={labels.clear}
							className="absolute right-1.5 top-1/2 -translate-y-1/2"
							onClick={() => changeAndFocus(() => onQueryChange(""))}
							size="icon-xs"
							variant="ghost"
						>
							<span aria-hidden="true" className="icon-[solar--close-circle-linear] size-3.5" />
						</Button>
					) : null}
				</div>
				<Button
					aria-label={filterLabel}
					title={filterLabel}
					aria-expanded={filtersExpanded}
					aria-controls={filtersId}
					onClick={props.onToggleFilters}
					size="icon-lg"
					variant="ghost"
					className={cn("relative", (filtersExpanded || activeFilters.length > 0) && "bg-primary/10 text-primary")}
				>
					<span aria-hidden="true" className="icon-[solar--filter-linear] size-4" />
					{activeFilters.length > 0 ? (
						<span
							aria-hidden="true"
							className="absolute right-0 top-0 flex size-3.5 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground"
						>
							{activeFilters.length}
						</span>
					) : null}
				</Button>
			</div>
			<div id={filtersId} hidden={!filtersExpanded}>
				<div className="mt-2.5 flex flex-wrap gap-2.5 rounded-lg border border-border/50 bg-muted/20 p-2.5">
					<SearchFilter
						label={labels.type}
						value={props.selectedType}
						options={props.typeOptions}
						onChange={props.onTypeChange}
					/>
					<SearchFilter
						label={labels.project}
						value={props.selectedProject}
						options={props.projectOptions}
						onChange={props.onProjectChange}
					/>
					<SearchFilter
						label={labels.time}
						value={timeFilter.value}
						options={timeFilter.options}
						onChange={timeFilter.onValueChange}
					/>
					{timeFilter.value === "custom" ? (
						<div className="flex w-full flex-wrap gap-2.5">
							<div className="min-w-0 flex-1 basis-40 text-[10px] text-muted-foreground">
								{labels.startDate}
								<DatePicker
									{...timeFilter.datePicker}
									label={labels.startDate}
									className="mt-1"
									value={timeFilter.startDate}
									maxDate={timeFilter.endDate}
									aria-invalid={Boolean(timeFilter.error)}
									aria-describedby={timeFilter.error ? timeErrorId : timeHintId}
									onChange={timeFilter.onStartDateChange}
								/>
							</div>
							<div className="min-w-0 flex-1 basis-40 text-[10px] text-muted-foreground">
								{labels.endDate}
								<DatePicker
									{...timeFilter.datePicker}
									label={labels.endDate}
									className="mt-1"
									value={timeFilter.endDate}
									minDate={timeFilter.startDate}
									aria-invalid={Boolean(timeFilter.error)}
									aria-describedby={timeFilter.error ? timeErrorId : timeHintId}
									onChange={timeFilter.onEndDateChange}
								/>
							</div>
						</div>
					) : null}
					<p id={timeHintId} className="w-full text-[10px] text-muted-foreground">
						{labels.timeHint}
					</p>
				</div>
			</div>
			{timeFilter.error ? (
				<p id={timeErrorId} role="alert" className="mt-2 text-[11px] text-destructive">
					{timeFilter.error}
				</p>
			) : null}
			{activeFilters.length > 0 ? (
				<div className="mt-2 flex flex-wrap items-center gap-1.5">
					{activeFilters.map((filter) => (
						<Button
							key={filter.key}
							aria-label={filter.removeLabel}
							title={filter.removeLabel}
							onClick={() => changeAndFocus(filter.onRemove)}
							size="xs"
							variant="ghost"
							className="min-w-0 max-w-full rounded-full border-primary/15 bg-primary/5 text-[11px] text-primary"
						>
							<span className="truncate">{filter.label}</span>
							<span aria-hidden="true" className="icon-[solar--close-circle-linear] size-3 shrink-0" />
						</Button>
					))}
					<Button
						onClick={() => changeAndFocus(props.onResetFilters)}
						size="xs"
						variant="ghost"
						className="text-[11px]"
					>
						{labels.resetFilters}
					</Button>
				</div>
			) : null}
		</>
	);
}

function SearchFilter({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: readonly SidebarSessionSearchViewFilterOption[];
	onChange: (value: string) => void;
}): JSX.Element {
	return (
		<div className="min-w-0 flex-1 basis-40">
			<p className="mb-1 text-[10px] text-muted-foreground">{label}</p>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger aria-label={label} className="h-8 w-full text-[12px]">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.key} value={option.key}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
