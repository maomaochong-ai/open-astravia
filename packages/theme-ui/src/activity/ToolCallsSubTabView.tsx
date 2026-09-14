import { cn } from "@vetta-org/ui";
import type { JSX } from "react";

export type ToolCallFilterValue = "all" | "success" | "error";

export interface ToolCallFilterOption {
	value: ToolCallFilterValue;
	label: string;
}

export interface ToolCallViewItem {
	id: string;
	toolName: string;
	timeLabel: string;
	isError: boolean;
	/** True when a result payload exists (success or error). */
	hasResult: boolean;
	argsText: string;
	resultText: string | null;
}

export interface ToolCallsSubTabViewLabels {
	noSession: string;
	searchPlaceholder: string;
	statusText: string;
	refresh: string;
	empty: string;
	noMatch: string;
	args: string;
	result: string;
}

export interface ToolCallsSubTabViewProps {
	hasSession: boolean;
	search: string;
	filter: ToolCallFilterValue;
	filterOptions: readonly ToolCallFilterOption[];
	loading: boolean;
	/** True when unfiltered records are empty (drives empty vs noMatch copy). */
	hasAnyRecords: boolean;
	items: readonly ToolCallViewItem[];
	expandedId: string | null;
	labels: ToolCallsSubTabViewLabels;
	onSearchChange: (value: string) => void;
	onFilterChange: (value: ToolCallFilterValue) => void;
	onToggleExpand: (id: string) => void;
	onRefresh: () => void;
}

export function ToolCallsSubTabView({
	hasSession,
	search,
	filter,
	filterOptions,
	loading,
	hasAnyRecords,
	items,
	expandedId,
	labels,
	onSearchChange,
	onFilterChange,
	onToggleExpand,
	onRefresh,
}: ToolCallsSubTabViewProps): JSX.Element {
	if (!hasSession) {
		return (
			<div className="flex flex-1 items-center justify-center p-4 text-[12px] text-muted-foreground">
				{labels.noSession}
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* Search + Filter bar */}
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
				<div className="relative flex-1">
					<span className="icon-[mdi--magnify] absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						type="text"
						value={search}
						onChange={(e) => onSearchChange(e.target.value)}
						placeholder={labels.searchPlaceholder}
						className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
					/>
				</div>
				<div className="flex shrink-0 items-center gap-0.5 rounded-md border border-input bg-background p-0.5">
					{filterOptions.map((opt) => (
						<button
							key={opt.value}
							type="button"
							onClick={() => onFilterChange(opt.value)}
							className={cn(
								"rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
								filter === opt.value
									? "bg-secondary text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{opt.label}
						</button>
					))}
				</div>
			</div>

			{/* Refresh */}
			<div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1">
				<span className="text-[11px] text-muted-foreground">{labels.statusText}</span>
				<button
					type="button"
					onClick={onRefresh}
					className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
					title={labels.refresh}
				>
					<span className="icon-[mdi--refresh] h-3.5 w-3.5" />
				</button>
			</div>

			{/* Timeline list */}
			<div className="flex-1 overflow-y-auto">
				{items.length === 0 && !loading && (
					<div className="p-4 text-center text-[12px] text-muted-foreground">
						{!hasAnyRecords ? labels.empty : labels.noMatch}
					</div>
				)}
				{items.map((record) => {
					const isExpanded = expandedId === record.id;
					return (
						<div
							key={record.id}
							className={cn("border-b border-border", record.isError && "border-l-2 border-l-destructive")}
						>
							<button
								type="button"
								onClick={() => onToggleExpand(record.id)}
								className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-secondary/50"
							>
								<span
									className={cn(
										"h-3.5 w-3.5 shrink-0",
										isExpanded ? "icon-[mdi--chevron-down]" : "icon-[mdi--chevron-right]",
										"text-muted-foreground",
									)}
								/>
								<span className="flex-1 truncate text-[12px] font-medium text-foreground">
									{record.toolName}
								</span>
								<span className="shrink-0 text-[11px] text-muted-foreground">{record.timeLabel}</span>
								<span
									className={cn(
										"h-3.5 w-3.5 shrink-0",
										record.isError
											? "icon-[mdi--close-circle] text-destructive"
											: record.hasResult
												? "icon-[mdi--check-circle] text-green-500"
												: "icon-[mdi--clock-outline] text-muted-foreground",
									)}
								/>
							</button>
							{isExpanded && (
								<div className="border-t border-border bg-muted/30 px-3 py-2">
									<div className="mb-1 text-[11px] font-medium text-muted-foreground">{labels.args}</div>
									<pre className="mb-2 max-h-[200px] overflow-auto rounded-md bg-background p-2 text-[11px] text-foreground">
										{record.argsText}
									</pre>
									{record.resultText !== null && (
										<>
											<div className="mb-1 text-[11px] font-medium text-muted-foreground">
												{labels.result}
											</div>
											<pre className="max-h-[300px] overflow-auto rounded-md bg-background p-2 text-[11px] text-foreground">
												{record.resultText}
											</pre>
										</>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
