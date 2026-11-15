import { Input, cn } from "@astravia-org/ui";
import type { JSX } from "react";

export interface PresetProviderModelRowView {
	readonly contextWindow?: number | null;
	readonly hasReasoning?: boolean;
	readonly hasVision?: boolean;
	readonly id: string;
	readonly name: string;
	readonly price?: string | null;
	/** 上游声明的思考档位；有值时在行内列出来。 */
	readonly reasoningLevels?: readonly string[];
	/** 连通测试状态；宿主不提供测试时留空，整颗按钮不渲染。 */
	readonly test?: PresetProviderModelTestState;
}

export type PresetProviderModelTestState =
	| { readonly status: "testing" }
	| { readonly status: "ok"; readonly message?: string }
	| { readonly status: "fail"; readonly message?: string };

export interface PresetProviderModelsListViewLabels {
	readonly clearSearch: string;
	readonly listLabel: string;
	readonly noMatchingModels: string;
	readonly noModels: string;
	readonly testModel: (model: string) => string;
	readonly testOk: string;
	readonly testFailed: string;
	readonly perMillionTokens: string;
	readonly searchPlaceholder: string;
	readonly thinking: string;
}

export interface PresetProviderModelsListViewProps {
	readonly labels: PresetProviderModelsListViewLabels;
	readonly modelRows: readonly PresetProviderModelRowView[];
	readonly onSearchQueryChange: (value: string) => void;
	/** 逐行测试连通；缺省时不渲染测试按钮（服务商未采纳，无从探测）。 */
	readonly onTestModel?: (model: string) => void;
	readonly searchQuery: string;
	readonly totalModelCount: number;
}

export function PresetProviderModelsListView({
	labels,
	modelRows,
	onSearchQueryChange,
	onTestModel,
	searchQuery,
	totalModelCount,
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
					<div
						key={model.id}
						className="flex items-start gap-2 border-b border-border/50 px-5 py-2 pl-12 last:border-b-0"
					>
						<div className="min-w-0 flex-1">
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
						{model.reasoningLevels && model.reasoningLevels.length > 0 && (
							<div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">
								{labels.thinking} · {model.reasoningLevels.join(" / ")}
							</div>
						)}
						{model.price && (
							<div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/80">
								<span>{model.price}</span>
								<span className="rounded bg-accent px-1 py-0.5 text-[9px] text-muted-foreground">
									{labels.perMillionTokens}
								</span>
							</div>
						)}
						</div>
						{onTestModel && (
							<ModelTestButton
								labels={labels}
								model={model}
								onTest={onTestModel}
							/>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

/** 三态连通测试：转圈 / 绿勾 / 红三角，失败时把原因放进 title。 */
function ModelTestButton({
	labels,
	model,
	onTest,
}: {
	readonly labels: PresetProviderModelsListViewLabels;
	readonly model: PresetProviderModelRowView;
	readonly onTest: (model: string) => void;
}): JSX.Element {
	const state = model.test;
	const testing = state?.status === "testing";
	const title =
		state?.status === "fail"
			? (state.message ?? labels.testFailed)
			: state?.status === "ok"
				? (state.message ?? labels.testOk)
				: labels.testModel(model.name);
	return (
		<button
			type="button"
			onClick={() => onTest(model.id)}
			disabled={testing}
			title={title}
			aria-label={title}
			aria-busy={testing}
			className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
		>
			{state?.status === "ok" ? (
				<span aria-hidden="true" className="icon-[mdi--check-circle] size-3.5 text-emerald-500" />
			) : state?.status === "fail" ? (
				<span aria-hidden="true" className="icon-[mdi--alert-triangle] size-3.5 text-amber-500" />
			) : (
				<span
					aria-hidden="true"
					className={cn("icon-[mdi--access-point] size-3.5", testing && "animate-pulse")}
				/>
			)}
		</button>
	);
}
