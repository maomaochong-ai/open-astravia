import { cn } from "@astravia-org/ui/utils";
import type { JSX } from "react";
import { useMemo, useRef, useState } from "react";
import type { ModelSelectorLabels, ModelSelectorOptionView, ModelSelectorProviderGroup } from "./ModelSelectorView";
import {
	buildModelColumns,
	computeVirtualRange,
	FAVORITES_COLUMN_ID,
} from "./model-selector-columns";
import { MultiplierTag } from "../shared/MultiplierTag";
import { ProviderIcon } from "../shared/provider-icon";

/**
 * 模型选择菜单的三栏内容：服务商｜模型｜思考强度（有档位时）。
 *
 * 与单列长列表的区别不只是排布：单列里「换服务商」等于滚动，三栏里等于点左边一格，
 * 中间栏的内容随之整列替换——用户找模型的动作从「滚动 + 读」变成「点 + 读」。
 *
 * 收藏栏是服务商栏的第一格（不是独立区域）：收藏的模型跨服务商，放进服务商栏才能
 * 与「当前看哪个服务商」共用一个选中位。
 */
export interface ModelSelectorMenuPanelProps {
	readonly groups: readonly ModelSelectorProviderGroup[];
	readonly selectedModel?: string;
	readonly currentLevel?: string;
	readonly menuLevels: readonly string[];
	readonly defaultKey?: string;
	readonly labels: ModelSelectorLabels;
	readonly favoriteKeys: readonly string[];
	readonly searchQuery: string;
	readonly emptyOption?: { readonly label: string; readonly onSelect: () => void };
	readonly classNames?: {
		readonly providerHeader?: string;
		readonly item?: string;
	};
	/** 行高与可视高度参与虚拟滚动；默认值对应紧凑行。 */
	readonly rowHeight?: number;
	readonly viewportHeight?: number;
	readonly onSelectModel: (key: string) => void;
	readonly onSelectReasoning: (level: string) => void;
	readonly onToggleFavorite: (key: string) => void;
}

const PROVIDER_COLUMN_WIDTH = 116;
const LEVEL_COLUMN_WIDTH = 104;

function ModelRow({
	model,
	providerLabel,
	selected,
	isDefault,
	favorited,
	labels,
	showProvider,
	className,
	onSelect,
	onToggleFavorite,
}: {
	readonly model: ModelSelectorOptionView;
	readonly providerLabel: string;
	readonly selected: boolean;
	readonly isDefault: boolean;
	readonly favorited: boolean;
	readonly labels: ModelSelectorLabels;
	readonly showProvider: boolean;
	readonly className?: string;
	readonly onSelect: () => void;
	readonly onToggleFavorite: () => void;
}): JSX.Element {
	const multiplier = labels.multiplierLabel?.(model);
	return (
		<div
			data-model-key={model.key}
			aria-current={selected ? "true" : undefined}
			className={cn(
				"group/model relative flex h-7 items-center gap-1.5 rounded-md pl-2 pr-1 text-xs",
				selected ? "bg-accent text-accent-foreground" : "text-foreground",
				className,
			)}
		>
			<button
				type="button"
				onClick={onSelect}
				title={showProvider ? `${model.displayName} · ${providerLabel}` : model.displayName}
				className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
			>
				<span className="min-w-0 flex-1 truncate">{model.displayName}</span>
				{showProvider && (
					<span className="shrink-0 text-[10px] text-muted-foreground/60">{providerLabel}</span>
				)}
				{multiplier ? <MultiplierTag text={multiplier} /> : null}
				{model.supportsImage && (
					<span
						aria-label={labels.visionBadge}
						title={labels.visionBadge}
						className="icon-[solar--gallery-linear] size-3 shrink-0 text-primary"
					/>
				)}
				{isDefault && (
					<span className="shrink-0 rounded-full bg-primary/15 px-1 text-[9px] font-medium text-primary">
						{labels.defaultBadge}
					</span>
				)}
				{selected && <span className="icon-[solar--check-circle-linear] h-3 w-3 shrink-0" />}
			</button>
			{/*
			 * 星标只在悬停或已收藏时显示：常显会让每行多一个可点区域，
			 * 误点收藏比找不到收藏更烦。
			 */}
			<button
				type="button"
				onClick={onToggleFavorite}
				title={favorited ? labels.unfavorite : labels.favorite}
				aria-label={`${favorited ? labels.unfavorite : labels.favorite}：${model.displayName}`}
				aria-pressed={favorited}
				className={cn(
					"icon-[solar--star-linear] size-3 shrink-0 transition-opacity",
					favorited
						? "text-primary opacity-100"
						: "text-muted-foreground opacity-0 group-hover/model:opacity-100 group-focus-within/model:opacity-100",
				)}
			/>
		</div>
	);
}

export function ModelSelectorMenuPanel({
	groups,
	selectedModel,
	currentLevel,
	menuLevels,
	defaultKey,
	labels,
	favoriteKeys,
	searchQuery,
	emptyOption,
	classNames,
	rowHeight = 28,
	viewportHeight = 280,
	onSelectModel,
	onSelectReasoning,
	onToggleFavorite,
}: ModelSelectorMenuPanelProps): JSX.Element {
	const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
	const [scrollTop, setScrollTop] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	const columns = useMemo(
		() => buildModelColumns(groups, { favorites: favoriteKeys, query: searchQuery, activeProviderId }),
		[groups, favoriteKeys, searchQuery, activeProviderId],
	);

	const range = computeVirtualRange({
		scrollTop,
		viewportHeight,
		rowHeight,
		count: columns.models.length,
	});
	const visibleModels = columns.models.slice(range.start, range.end);
	const hasLevels = menuLevels.length > 0;

	return (
		<div className="flex min-h-0 flex-1 overflow-hidden">
			{/* 第一栏：服务商（含收藏） */}
			<div
				role="group"
				aria-label={labels.providerHeader}
				className="no-scrollbar flex shrink-0 flex-col overflow-y-auto border-r border-border/50 p-1"
				style={{ width: PROVIDER_COLUMN_WIDTH }}
			>
				{columns.providers.map((column) => {
					const active = !columns.searching && column.id === columns.activeProviderId;
					return (
						<button
							key={column.id}
							type="button"
							aria-pressed={active}
							onClick={() => {
								setActiveProviderId(column.id);
								setScrollTop(0);
								if (typeof listRef.current?.scrollTo === "function") listRef.current.scrollTo({ top: 0 });
							}}
							className={cn(
								"flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-[11px]",
								active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-foreground/5",
							)}
						>
							{column.isFavorites ? (
								<span className="icon-[solar--star-linear] size-3 shrink-0 text-primary" aria-hidden="true" />
							) : (
								<ProviderIcon symbol={column.icon} className="size-3 shrink-0" />
							)}
							<span className="min-w-0 flex-1 truncate">
								{column.isFavorites ? labels.favoritesHeader : column.label}
							</span>
							<span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/60">{column.count}</span>
						</button>
					);
				})}
				{columns.providers.length === 0 && (
					<p className="px-1.5 py-2 text-[11px] text-muted-foreground">{labels.noResults}</p>
				)}
			</div>

			{/* 第二栏：模型（虚拟滚动） */}
			<div
				ref={listRef}
				role="listbox"
				aria-label={labels.modelHeader}
				onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
				className="no-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto p-1"
				style={{ maxHeight: viewportHeight }}
			>
				{columns.searching && columns.models.length > 0 && (
					<p className={cn("px-2 pb-0.5 pt-0.5 text-[10px] text-muted-foreground/60", classNames?.providerHeader)}>
						{labels.searchResultsHeader}
					</p>
				)}
				{emptyOption && !columns.searching && (
					<button
						type="button"
						onClick={emptyOption.onSelect}
						aria-current={!selectedModel ? "true" : undefined}
						className={cn(
							"mb-0.5 flex h-7 w-full items-center rounded-md px-2 text-left text-xs",
							!selectedModel ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-foreground/5",
						)}
					>
						<span className="min-w-0 flex-1 truncate">{emptyOption.label}</span>
						{!selectedModel && <span className="icon-[solar--check-circle-linear] h-3 w-3 shrink-0" />}
					</button>
				)}
				{range.paddingTop > 0 && <div style={{ height: range.paddingTop }} aria-hidden="true" />}
				{visibleModels.map((entry) => (
					<ModelRow
						key={entry.model.key}
						model={entry.model}
						providerLabel={entry.providerLabel}
						selected={entry.model.key === selectedModel}
						isDefault={entry.model.key === defaultKey}
						favorited={favoriteKeys.includes(entry.model.key)}
						labels={labels}
						showProvider={columns.searching}
						className={classNames?.item}
						onSelect={() => onSelectModel(entry.model.key)}
						onToggleFavorite={() => onToggleFavorite(entry.model.key)}
					/>
				))}
				{range.paddingBottom > 0 && <div style={{ height: range.paddingBottom }} aria-hidden="true" />}
				{columns.models.length === 0 && (
					<div className="flex min-h-24 flex-col items-center justify-center px-4 py-6 text-center">
						<span aria-hidden="true" className="icon-[solar--magnifer-linear] mb-1.5 size-4 text-muted-foreground" />
						<p className="text-xs font-medium text-foreground">{labels.noResults}</p>
						<p className="mt-0.5 text-[11px] text-muted-foreground">{labels.noResultsHint}</p>
					</div>
				)}
			</div>

			{/* 第三栏：思考强度（没有档位时整栏不渲染） */}
			{hasLevels && (
				<div
					role="group"
					aria-label={labels.reasoningHeader}
					className="no-scrollbar flex shrink-0 flex-col overflow-y-auto border-l border-border/50 p-1"
					style={{ width: LEVEL_COLUMN_WIDTH }}
				>
					{menuLevels.map((level) => (
						<button
							key={level}
							type="button"
							aria-pressed={level === currentLevel}
							onClick={() => onSelectReasoning(level)}
							className={cn(
								"flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-[11px]",
								level === currentLevel
									? "bg-accent text-accent-foreground"
									: "text-muted-foreground hover:bg-foreground/5",
							)}
						>
							<span className="min-w-0 flex-1 truncate">{labels.levelLabel(level)}</span>
							{level === currentLevel && (
								<span className="icon-[solar--check-circle-linear] h-3 w-3 shrink-0" />
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export { FAVORITES_COLUMN_ID };
