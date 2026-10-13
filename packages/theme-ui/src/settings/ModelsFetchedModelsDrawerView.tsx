import type { JSX } from "react";
import { Button, Input, cn } from "@vetta-org/ui";

/** 单个候选模型的连通性测试结果。 */
export interface FetchedModelTestView {
	readonly status: "testing" | "ok" | "fail";
	readonly message?: string;
}

/** 候选模型行：接口返回的参数与勾选、测试状态都在这里。 */
export interface FetchedModelRowView {
	readonly id: string;
	readonly name?: string;
	readonly ownedBy?: string;
	readonly contextWindow?: number;
	readonly maxTokens?: number;
	readonly vision?: boolean;
	readonly reasoning?: boolean;
	/** 上游声明的思考档位，跟在「思考」标记后面。 */
	readonly reasoningLevels?: readonly string[];
	readonly selected: boolean;
	readonly alreadyAdded: boolean;
	readonly test?: FetchedModelTestView;
}

export interface ModelsFetchedModelsDrawerViewLabels {
	readonly title: string;
	/** 标题下的 provider 行。 */
	readonly subtitle: string;
	/** 已拉取到的候选数量说明；未就绪时为空串。 */
	readonly hint: string;
	readonly searchPlaceholder: string;
	readonly clearSearch: string;
	readonly listLabel: string;
	readonly emptyList: string;
	readonly emptySearch: string;
	readonly selectAll: string;
	readonly deselectAll: string;
	readonly selectedCount: string;
	readonly alreadyAdded: string;
	readonly vision: string;
	readonly thinking: string;
	readonly testAction: string;
	readonly testing: string;
	readonly testOk: string;
	readonly testFail: string;
	readonly apply: string;
	readonly cancel: string;
	readonly retry: string;
	readonly loading: string;
}

export interface ModelsFetchedModelsDrawerViewProps {
	readonly labels: ModelsFetchedModelsDrawerViewLabels;
	readonly status: "loading" | "ready" | "error";
	readonly error?: string;
	/** 当前可见的行（已按搜索词筛过）。 */
	readonly rows: readonly FetchedModelRowView[];
	/** 接口返回的候选总数，用于区分「没有模型」和「没有匹配」。 */
	readonly totalCount: number;
	readonly selectedCount: number;
	readonly searchQuery: string;
	readonly saving: boolean;
	readonly onSearchQueryChange: (value: string) => void;
	readonly onToggle: (modelId: string) => void;
	readonly onSelectAll: () => void;
	readonly onDeselectAll: () => void;
	readonly onTest: (modelId: string) => void;
	readonly onRetry: () => void;
	readonly onApply: () => void;
	readonly onClose: () => void;
}

/**
 * 「从接口拉取模型」抽屉的展示层：服务商行右侧滑出，列出 `GET {baseUrl}/models`
 * 返回的全部候选模型及其参数，勾选后批量写入。
 *
 * 全选/全不选只作用于 `rows`（当前可见项）——搜索后用户看到什么就选什么，
 * 被筛掉的勾选状态保留在连接层的 `selected` 里。
 */
export function ModelsFetchedModelsDrawerView({
	labels,
	status,
	error,
	rows,
	totalCount,
	selectedCount,
	searchQuery,
	saving,
	onSearchQueryChange,
	onToggle,
	onSelectAll,
	onDeselectAll,
	onTest,
	onRetry,
	onApply,
	onClose,
}: ModelsFetchedModelsDrawerViewProps): JSX.Element {
	const selectableRows = rows.filter((row) => !row.alreadyAdded);
	const canSelectAll = selectableRows.some((row) => !row.selected);
	const canDeselectAll = rows.some((row) => row.selected);

	return (
		<div className="flex h-full flex-col">
			<header className="border-b border-border px-5 py-4">
				<h2 className="truncate text-[15px] font-semibold text-foreground">{labels.title}</h2>
				<p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{labels.subtitle}</p>
			</header>

			{status === "loading" ? (
				<div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
					<span className="icon-[solar--refresh-linear] h-5 w-5 animate-spin" />
					<span className="text-[12px]">{labels.loading}</span>
				</div>
			) : status === "error" ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
					<span className="icon-[solar--danger-triangle-linear] h-8 w-8 text-destructive" />
					<p className="text-[12px] text-destructive">{error}</p>
					<Button variant="outline" size="sm" onClick={onRetry}>
						{labels.retry}
					</Button>
				</div>
			) : (
				<>
					<div className="flex items-center gap-2 border-b border-border/50 px-5 py-2.5">
						<div className="relative min-w-0 flex-1">
							<span
								aria-hidden="true"
								className="icon-[solar--magnifer-linear] pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
							/>
							<Input
								type="search"
								value={searchQuery}
								onChange={(event) => onSearchQueryChange(event.target.value)}
								placeholder={labels.searchPlaceholder}
								aria-label={labels.searchPlaceholder}
								className="h-8 pl-8 pr-8 text-[12px]"
							/>
							{searchQuery && (
								<button
									type="button"
									onClick={() => onSearchQueryChange("")}
									aria-label={labels.clearSearch}
									className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								>
									<span aria-hidden="true" className="icon-[solar--close-circle-linear] h-3.5 w-3.5" />
								</button>
							)}
						</div>
						<Button variant="ghost" size="xs" onClick={onSelectAll} disabled={!canSelectAll}>
							{labels.selectAll}
						</Button>
						<Button variant="ghost" size="xs" onClick={onDeselectAll} disabled={!canDeselectAll}>
							{labels.deselectAll}
						</Button>
					</div>

					<div className="flex items-center justify-between gap-3 px-5 py-2 text-[11px] text-muted-foreground">
						<span className="min-w-0 truncate">{labels.hint}</span>
						<span className="shrink-0">{labels.selectedCount}</span>
					</div>

					<div
						role="region"
						aria-label={labels.listLabel}
						tabIndex={0}
						className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border/50 outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
					>
						{rows.length === 0 && (
							<div className="px-5 py-6 text-center text-[12px] text-muted-foreground">
								{totalCount > 0 ? labels.emptySearch : labels.emptyList}
							</div>
						)}
						{rows.map((row) => (
							<FetchedModelRow key={row.id} row={row} labels={labels} onToggle={onToggle} onTest={onTest} />
						))}
					</div>

					<footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
						<Button size="sm" onClick={onApply} disabled={saving || selectedCount === 0}>
							{labels.apply}
						</Button>
						<Button variant="ghost" size="sm" onClick={onClose}>
							{labels.cancel}
						</Button>
					</footer>
				</>
			)}
		</div>
	);
}

function FetchedModelRow({
	row,
	labels,
	onToggle,
	onTest,
}: {
	readonly row: FetchedModelRowView;
	readonly labels: ModelsFetchedModelsDrawerViewLabels;
	readonly onToggle: (modelId: string) => void;
	readonly onTest: (modelId: string) => void;
}): JSX.Element {
	const subtitle = [row.name, row.ownedBy].filter(Boolean).join(" · ");

	return (
		<div className="flex items-center gap-3 border-b border-border/50 px-5 py-2.5 last:border-b-0 hover:bg-accent/40">
			<button
				type="button"
				aria-pressed={row.selected}
				onClick={() => onToggle(row.id)}
				className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
			>
				<span
					aria-hidden="true"
					className={cn(
						"h-3.5 w-3.5 shrink-0",
						row.selected ? "icon-[mdi--checkbox-marked] text-primary" : "icon-[mdi--checkbox-blank-outline] text-muted-foreground",
					)}
				/>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-2">
						<span className="truncate text-[12px] font-medium text-foreground">{row.id}</span>
						{row.alreadyAdded && (
							<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
								{labels.alreadyAdded}
							</span>
						)}
					</span>
					{subtitle && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/70">{subtitle}</span>}
				</span>
			</button>

			<span className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
				{row.contextWindow != null && <span>{(row.contextWindow / 1024).toFixed(0)}K ctx</span>}
				{row.maxTokens != null && <span>{(row.maxTokens / 1024).toFixed(0)}K max</span>}
				{row.vision && (
					<span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary">{labels.vision}</span>
				)}
				{row.reasoning && (
					<span className="rounded bg-accent px-1 py-0.5 text-[9px] text-muted-foreground">
						{labels.thinking}
						{row.reasoningLevels?.length ? ` · ${row.reasoningLevels.join("/")}` : ""}
					</span>
				)}
			</span>

			<FetchedModelTestControl row={row} labels={labels} onTest={onTest} />
		</div>
	);
}

function FetchedModelTestControl({
	row,
	labels,
	onTest,
}: {
	readonly row: FetchedModelRowView;
	readonly labels: ModelsFetchedModelsDrawerViewLabels;
	readonly onTest: (modelId: string) => void;
}): JSX.Element {
	const test = row.test;
	if (test?.status === "testing") {
		return (
			<Button variant="ghost" size="xs" disabled className="shrink-0">
				<span className="icon-[solar--refresh-linear] h-3 w-3 animate-spin" />
				{labels.testing}
			</Button>
		);
	}
	if (test?.status === "ok" || test?.status === "fail") {
		const ok = test.status === "ok";
		return (
			<Button
				variant="ghost"
				size="xs"
				onClick={() => onTest(row.id)}
				title={test.message}
				className={cn("shrink-0", ok ? "text-emerald-400" : "text-destructive")}
			>
				<span className={cn("h-3 w-3", ok ? "icon-[solar--check-circle-linear]" : "icon-[solar--danger-triangle-linear]")} />
				{ok ? labels.testOk : labels.testFail}
			</Button>
		);
	}
	return (
		<Button variant="ghost" size="xs" onClick={() => onTest(row.id)} title={labels.testAction} className="shrink-0">
			<span className="icon-[solar--plug-circle-linear] h-3 w-3" />
			{labels.testAction}
		</Button>
	);
}
