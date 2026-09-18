import { Input } from "@vetta-org/ui";
import type { JSX } from "react";

export interface PresetProviderModelRowView {
	readonly contextWindow?: number | null;
	readonly hasReasoning?: boolean;
	readonly hasVision?: boolean;
	readonly id: string;
	readonly name: string;
	readonly price?: string | null;
}

export interface PresetProviderModelsListViewLabels {
	readonly clearSearch: string;
	readonly showLegacyModels: (count: number) => string;
	readonly hideLegacyModels: string;
	readonly listLabel: string;
	readonly noMatchingModels: string;
	readonly noModels: string;
	readonly perMillionTokens: string;
	readonly searchPlaceholder: string;
	readonly thinking: string;
}

export interface PresetProviderModelsListViewProps {
	readonly labels: PresetProviderModelsListViewLabels;
	readonly modelRows: readonly PresetProviderModelRowView[];
	readonly onSearchQueryChange: (value: string) => void;
	readonly searchQuery: string;
	readonly totalModelCount: number;
	/**
	 * 被新一代取代、默认收起的模型数。为 0 时不出现展开入口。
	 * 搜索时调用方会把历史模型一并纳入结果,这里应当传 0——否则用户会以为搜索漏了东西。
	 */
	readonly legacyModelCount?: number;
	readonly legacyExpanded?: boolean;
	readonly onToggleLegacy?: () => void;
}

export function PresetProviderModelsListView({
	labels,
	modelRows,
	onSearchQueryChange,
	searchQuery,
	totalModelCount,
	legacyModelCount = 0,
	legacyExpanded = false,
	onToggleLegacy,
}: PresetProviderModelsListViewProps): JSX.Element {
	return (
		<div className="border-t border-border bg-secondary/30">
			{totalModelCount > 0 && (
				<div className="px-5 py-2 pl-12">
					<div className="relative">
						<span
							aria-hidden="true"
							className="icon-[solar--magnifer-linear] pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60"
						/>
						<Input
							type="search"
							value={searchQuery}
							onChange={(event) => onSearchQueryChange(event.target.value)}
							placeholder={labels.searchPlaceholder}
							aria-label={labels.searchPlaceholder}
							className="h-7 bg-background/40 pl-8 pr-8 text-[11px]"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => onSearchQueryChange("")}
								aria-label={labels.clearSearch}
								className="absolute right-1.5 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<span aria-hidden="true" className="icon-[solar--close-circle-linear] size-3.5" />
							</button>
						)}
					</div>
				</div>
			)}
			<div
				role="region"
				aria-label={labels.listLabel}
				tabIndex={0}
				className="max-h-[min(24rem,50vh)] overflow-y-auto overscroll-contain outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
			>
				{modelRows.length === 0 && (
					<div aria-live="polite" className="px-5 py-4 text-center text-[12px] text-muted-foreground">
						{totalModelCount > 0 ? labels.noMatchingModels : labels.noModels}
					</div>
				)}
				{modelRows.map((model) => (
					<div key={model.id} className="border-b border-border/50 px-5 py-2 pl-12 last:border-b-0">
						<div className="truncate text-[12px] text-foreground">{model.name}</div>
						{model.name !== model.id && (
							<div className="truncate text-[10px] text-muted-foreground/70">{model.id}</div>
						)}
						<div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
							{model.contextWindow != null && <span>{(model.contextWindow / 1024).toFixed(0)}K ctx</span>}
							{model.hasVision && (
								<span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary">vision</span>
							)}
							{model.hasReasoning && (
								<span className="rounded bg-accent px-1 py-0.5 text-[9px] text-muted-foreground">
									{labels.thinking}
								</span>
							)}
						</div>
						{model.price && (
							<div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/80">
								<span>{model.price}</span>
								<span className="rounded bg-accent px-1 py-0.5 text-[9px] text-muted-foreground">
									{labels.perMillionTokens}
								</span>
							</div>
						)}
					</div>
				))}
				{legacyModelCount > 0 && onToggleLegacy && (
					<button
						type="button"
						onClick={onToggleLegacy}
						aria-expanded={legacyExpanded}
						className="flex w-full items-center gap-1 border-border/50 border-t px-5 py-2 pl-12 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<span
							aria-hidden="true"
							className={`size-3.5 ${legacyExpanded ? "icon-[solar--alt-arrow-up-linear]" : "icon-[solar--alt-arrow-down-linear]"}`}
						/>
						{legacyExpanded ? labels.hideLegacyModels : labels.showLegacyModels(legacyModelCount)}
					</button>
				)}
			</div>
		</div>
	);
}
