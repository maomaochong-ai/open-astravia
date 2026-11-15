import { cn } from "@astravia-org/ui/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@astravia-org/ui/popover";
import type { JSX, ReactNode } from "react";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
	/** 搜索框由宿主渲染（它掌握焦点、过滤与键盘联动），面板只负责摆在中栏顶部。 */
	readonly searchSlot?: ReactNode;
	/** 菜单打开时默认停在的栏；宿主用它把「当前模型已收藏」的情况默认落在收藏栏。 */
	readonly initialProviderId?: string | null;
	/**
	 * 打开时「对齐到顶部」的模型 key。
	 *
	 * 三栏中间栏是窗口化渲染，目标行在视口外时根本没挂载，外部拿不到它的 DOM；
	 * 因此由外部给出 key，面板按行高与行下标自己算滚动量，不向外传 ref。
	 */
	readonly revealModelKey?: string | null;
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

/** 搜索框的方向键落到列表上时，面板能做的事：把焦点移到首/尾模型行。 */
export interface ModelSelectorMenuPanelHandle {
	/** 有可选模型时聚焦第一行并返回 `true`；没有结果返回 `false`，调用方不应吞掉按键。 */
	focusFirstModel: () => boolean;
	focusLastModel: () => boolean;
}

/** 服务商栏超过这个行数就折叠，留一格「更多」；几十个服务商时左栏会把模型栏挤没。 */
const MAX_PROVIDER_ROWS = 7;

/** 服务商没有图标时，第一栏用名称的第一个字符做头像。 */
function providerInitial(label: string): string {
	return Array.from(label.trim())[0] ?? "?";
}

/** 详情浮层里的一行：标签在上、值在下，值可以选中复制。 */
function InfoRow({ label, children }: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
	return (
		<div className="flex min-w-0 flex-col gap-px">
			<dt className="text-[10px] leading-none text-muted-foreground/70">{label}</dt>
			<dd className="min-w-0 break-words text-[11px] leading-snug text-foreground">{children}</dd>
		</div>
	);
}

/**
 * 行尾的详情入口：识图 / 倍率 / 默认 / 思考档位都收进这里，行上只留名字与星标。
 *
 * 常显会让每行多出第二个可点区域；悬停或行聚焦时才出现，打开期间保持显示，
 * 否则指针移进浮层后触发器消失、浮层失去锚点。
 */
function ModelInfoButton({
	model,
	providerLabel,
	isDefault,
	multiplier,
	labels,
}: {
	readonly model: ModelSelectorOptionView;
	readonly providerLabel: string;
	readonly isDefault: boolean;
	readonly multiplier?: string;
	readonly labels: ModelSelectorLabels;
}): JSX.Element | null {
	if (!labels.infoButton) return null;
	const rows: { label: string; value: string }[] = [{ label: labels.infoProvider ?? "", value: providerLabel }];
	const visionLabel = labels.infoVision;
	if (visionLabel) {
		rows.push({ label: visionLabel, value: (model.supportsImage ? labels.infoYes : labels.infoNo) ?? "" });
	}
	if (multiplier && labels.infoMultiplier) rows.push({ label: labels.infoMultiplier, value: multiplier });
	if (isDefault && labels.infoDefault) rows.push({ label: labels.infoDefault, value: labels.defaultBadge });
	if (labels.infoId) rows.push({ label: labels.infoId, value: model.modelId });

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					tabIndex={-1}
					title={labels.infoButton}
					aria-label={`${labels.infoButton}：${model.displayName}`}
					onClick={(event) => event.stopPropagation()}
					className="hidden size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted group-hover/model:inline-flex group-focus-within/model:inline-flex data-[state=open]:inline-flex"
				>
					<span aria-hidden="true" className="icon-[solar--info-circle-linear] size-3" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				side="right"
				align="start"
				sideOffset={8}
				collisionPadding={16}
				// 浮层挂在 body 上，事件仍会冒泡回所在的行：不拦就会被当成「选中该模型」。
				onClick={(event) => event.stopPropagation()}
				onPointerDown={(event) => event.stopPropagation()}
				onPointerMove={(event) => event.stopPropagation()}
				// 应用默认不可选中文字；详情里的模型 ID 常要复制，整块放开选择。
				className="w-64 cursor-text select-text gap-3 border-border/60 bg-background/70 p-3 backdrop-blur-xl backdrop-saturate-150"
			>
				<p className="mb-2 min-w-0 break-words text-[13px] font-medium leading-snug text-foreground">
					{model.displayName}
				</p>
				<dl className="flex flex-col gap-2">
					{[...rows].map((row) => (
						<InfoRow key={row.label} label={row.label}>
							{row.value}
						</InfoRow>
					))}
				</dl>
			</PopoverContent>
		</Popover>
	);
}

const ModelRow = memo(function ModelRowInner({
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
	readonly onSelect: (key: string) => void;
	readonly onToggleFavorite: (key: string) => void;
}): JSX.Element {
	// 回调只传 key：宿主给的是稳定引用时，未变化的行可以整行跳过重渲。
	const handleSelect = useCallback(() => onSelect(model.key), [onSelect, model.key]);
	const handleToggleFavorite = useCallback(() => onToggleFavorite(model.key), [onToggleFavorite, model.key]);
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
				onClick={handleSelect}
				title={showProvider ? `${model.displayName} · ${providerLabel}` : model.displayName}
				className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
			>
				<span className="min-w-0 flex-1 truncate">{model.displayName}</span>
				{showProvider && (
					<span className="shrink-0 text-[10px] text-muted-foreground/60">{providerLabel}</span>
				)}
				{/*
				 * 宿主给了详情入口时，识图/倍率/默认都收进浮层；没给时保持旧行为直接排在行内，
				 * 否则插件复用本视图会看不到这些标识。
				 */}
				{!labels.infoButton && (
					<>
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
					</>
				)}
			</button>
			<ModelInfoButton
				model={model}
				providerLabel={providerLabel}
				isDefault={isDefault}
				multiplier={multiplier}
				labels={labels}
			/>
			{/*
			 * 星标常驻：收藏是「我这台机器常用的模型」，和“选中”一样是行的一等状态，
			 * 不该藏着。已收藏的用实心金星，未收藏的用浅色空星，悬停时加深。
			 */}
			<button
				type="button"
				onClick={handleToggleFavorite}
				title={favorited ? labels.unfavorite : labels.favorite}
				aria-label={`${favorited ? labels.unfavorite : labels.favorite}：${model.displayName}`}
				aria-pressed={favorited}
				className={cn(
					"inline-flex size-5 shrink-0 items-center justify-center rounded hover:bg-muted",
					favorited ? "text-amber-500" : "text-muted-foreground hover:text-foreground",
				)}
			>
				<span
					aria-hidden="true"
					className={cn("size-3", favorited ? "icon-[solar--star-bold]" : "icon-[solar--star-linear]")}
				/>
			</button>
		</div>
	);
});

export const ModelSelectorMenuPanel = forwardRef<ModelSelectorMenuPanelHandle, ModelSelectorMenuPanelProps>(
	function ModelSelectorMenuPanel({
		groups,
		selectedModel,
		currentLevel,
		menuLevels,
		defaultKey,
		labels,
		favoriteKeys,
		searchQuery,
		searchSlot,
			initialProviderId,
			revealModelKey,
		emptyOption,
		classNames,
		rowHeight = 28,
		viewportHeight = 280,
		onSelectModel,
		onSelectReasoning,
		onToggleFavorite,
	}: ModelSelectorMenuPanelProps, ref): JSX.Element {
	const [activeProviderId, setActiveProviderId] = useState<string | null>(initialProviderId ?? null);
	const [scrollTop, setScrollTop] = useState(0);
	const [providerExpanded, setProviderExpanded] = useState(false);
	const listRef = useRef<HTMLDivElement>(null);
	const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
	// 面板高度固定后，列表的实际可视高度仍取决于搜索框与底栏：实测一次，虚拟窗口才准。
	// jsdom 里量不到尺寸（恒为 0），沿用宿主给的兜底值。
	useEffect(() => {
		const node = listRef.current;
		if (!node || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			const next = node.clientHeight;
			if (next > 0) setMeasuredHeight(next);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	const effectiveViewportHeight = measuredHeight ?? viewportHeight;

	const columns = useMemo(
		() => buildModelColumns(groups, { favorites: favoriteKeys, query: searchQuery, activeProviderId }),
		[groups, favoriteKeys, searchQuery, activeProviderId],
	);

	const range = computeVirtualRange({
		scrollTop,
		viewportHeight: effectiveViewportHeight,
		rowHeight,
		count: columns.models.length,
	});
	const visibleModels = columns.models.slice(range.start, range.end);

	/** 滚动量上限：最后一行贴底时列表不该再往下走。 */
	const maxScrollTop = Math.max(0, columns.models.length * rowHeight - effectiveViewportHeight);

	/**
	 * 按行下标直接定位滚动位置。窗口化后目标行不一定已挂载，
	 * 拿 DOM 去 `querySelector` 两条路都走不通，只能从下标反推 scrollTop。
	 */
	const scrollToIndex = useCallback(
		(index: number) => {
			const next = Math.max(0, Math.min(index * rowHeight, maxScrollTop));
			setScrollTop(next);
			if (listRef.current) listRef.current.scrollTop = next;
		},
		[maxScrollTop, rowHeight],
	);

	// 打开时把当前模型对齐到顶部：长列表里它常落在视口中间，上下都是无关项。
	// 只在 key 变化时对齐一次：换服务商、敲搜索词不该把列表又拉回去。
	const revealedKeyRef = useRef<string | null>(null);
	useEffect(() => {
		if (!revealModelKey) {
			revealedKeyRef.current = null;
			return;
		}
		if (revealedKeyRef.current === revealModelKey) return;
		const index = columns.models.findIndex((entry) => entry.model.key === revealModelKey);
		// 搜索词把它筛掉了：等用户清空搜索；此刻强行滚动只会打断输入。
		if (index < 0) return;
		revealedKeyRef.current = revealModelKey;
		scrollToIndex(index);
	}, [columns.models, revealModelKey, scrollToIndex]);

	// 方向键从搜索框落到列表：先定位到那一行所在区间，渲染后再聚焦它。
	const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
	const focusIndex = useCallback(
		(index: number): boolean => {
			if (index < 0 || index >= columns.models.length) return false;
			scrollToIndex(index);
			setPendingFocusIndex(index);
			return true;
		},
		[columns.models.length, scrollToIndex],
	);
	useImperativeHandle(
		ref,
		() => ({
			focusFirstModel: () => focusIndex(0),
			focusLastModel: () => focusIndex(columns.models.length - 1),
		}),
		[columns.models.length, focusIndex],
	);
	useEffect(() => {
		if (pendingFocusIndex === null) return;
		const key = columns.models[pendingFocusIndex]?.model.key;
		setPendingFocusIndex(null);
		if (!key || !listRef.current) return;
		const row = Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-model-key]")).find(
			(element) => element.dataset.modelKey === key,
		);
		row?.querySelector<HTMLButtonElement>("button")?.focus();
	}, [columns.models, pendingFocusIndex]);
	const hasLevels = menuLevels.length > 0;
	// 中栏顶部的小标题：搜索时是「搜索结果」，否则是当前服务商（或收藏）的名字。
	// 三栏里「第一栏点了哪个」必须能一眼对应到第二栏，否则列与列之间没有关系。
	const activeColumn = columns.searching
		? undefined
		: columns.providers.find((column) => column.id === columns.activeProviderId);
	const activeColumnLabel =
		activeColumn === undefined ? null : activeColumn.isFavorites ? labels.favoritesHeader : activeColumn.label;

	// 服务商太多时左栏折叠：几十个服务商时它会占满整个面板的高度。
	const canFoldProviders = columns.providers.length > MAX_PROVIDER_ROWS + 1;
	const foldedAt = canFoldProviders && !providerExpanded ? MAX_PROVIDER_ROWS : columns.providers.length;
	const visibleProviders = columns.providers.slice(0, foldedAt);
	const hiddenProviderCount = columns.providers.length - visibleProviders.length;

	const selectProvider = useCallback((id: string) => {
		setActiveProviderId(id);
		setScrollTop(0);
		if (typeof listRef.current?.scrollTo === "function") listRef.current.scrollTo({ top: 0 });
	}, []);

	return (
		<div className="flex h-[min(340px,60vh)] min-h-0">
			{/* 第一栏：服务商（含收藏）。图标竖排，宽度固定 44px——名字放不下，悬停与无障碍名称补齐。 */}
			<div
				role="group"
				aria-label={labels.providerHeader}
				className="no-scrollbar flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden border-r border-border/40 p-1"
			>
				{visibleProviders.map((column) => {
					const active = !columns.searching && column.id === columns.activeProviderId;
					const label = column.isFavorites ? labels.favoritesHeader : column.label;
					return (
						<button
							key={column.id}
							type="button"
							title={label}
							aria-label={label}
							aria-pressed={active}
							onClick={() => selectProvider(column.id)}
							className={cn(
								"flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground",
								active && "bg-accent text-accent-foreground",
							)}
						>
							{column.isFavorites ? (
								<span aria-hidden="true" className="icon-[solar--star-bold] size-4" />
							) : column.icon ? (
								<ProviderIcon symbol={column.icon} className="size-4" />
							) : (
								<span aria-hidden="true" className="text-[12px] font-semibold uppercase leading-none">
									{providerInitial(column.label)}
								</span>
							)}
						</button>
					);
				})}
				{canFoldProviders && (
					<button
						type="button"
						title={providerExpanded ? (labels.fewerProviders ?? "") : `+${hiddenProviderCount}`}
						aria-label={providerExpanded ? (labels.fewerProviders ?? "") : `+${hiddenProviderCount}`}
						onClick={() => setProviderExpanded((value) => !value)}
						className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/5"
					>
						{providerExpanded ? (
							<span aria-hidden="true" className="icon-[solar--alt-arrow-up-linear] size-4" />
						) : (
							<span aria-hidden="true" className="text-[10px] font-medium tabular-nums">
								+{hiddenProviderCount}
							</span>
						)}
					</button>
				)}
			</div>

			{/* 第二栏：搜索 + 模型列表。宽度固定 256px，与第一、三栏一起构成不变的面板宽度。 */}
			<div className="flex w-64 min-w-0 shrink flex-col p-1">
				{searchSlot && <div className="shrink-0 p-0.5">{searchSlot}</div>}
				<div
					ref={listRef}
					role="listbox"
					aria-label={labels.modelHeader}
					onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
					className="no-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%-10px),transparent)]"
				>
					{columns.searching && columns.models.length > 0 ? (
						<p className={cn("px-2 pb-0.5 pt-1 text-[10px] text-muted-foreground/60", classNames?.providerHeader)}>
							{labels.searchResultsHeader}
						</p>
					) : activeColumnLabel ? (
						<p className={cn("px-2 pb-0.5 pt-1 text-[10px] text-muted-foreground/60", classNames?.providerHeader)}>
							{activeColumnLabel}
						</p>
					) : null}
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
							onSelect={onSelectModel}
							onToggleFavorite={onToggleFavorite}
						/>
					))}
					{range.paddingBottom > 0 && <div style={{ height: range.paddingBottom }} aria-hidden="true" />}
					{columns.models.length === 0 &&
						(columns.activeProviderId === FAVORITES_COLUMN_ID && labels.favoritesEmpty ? (
							<div className="flex min-h-24 flex-col items-center justify-center px-4 py-6 text-center">
								<span aria-hidden="true" className="icon-[solar--star-bold] mb-1.5 size-6 text-amber-500/80" />
								<p className="text-xs font-medium text-foreground">{labels.favoritesEmpty}</p>
							</div>
						) : (
							<div className="flex min-h-24 flex-col items-center justify-center px-4 py-6 text-center">
								<span aria-hidden="true" className="icon-[solar--magnifer-linear] mb-1.5 size-4 text-muted-foreground" />
								<p className="text-xs font-medium text-foreground">{labels.noResults}</p>
								<p className="mt-0.5 text-[11px] text-muted-foreground">{labels.noResultsHint}</p>
							</div>
						))}
				</div>
			</div>

			{/* 第三栏：思考强度（没有档位时整栏不渲染）。 */}
			{hasLevels && (
				<div className="relative flex w-32 shrink-0 flex-col overflow-hidden border-l border-border/40">
					<div
						role="group"
						aria-label={labels.reasoningHeader}
						className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto p-1"
					>
						<p className="px-2 pb-0.5 pt-1 text-[10px] text-muted-foreground/60">{labels.reasoningHeader}</p>
						{menuLevels.map((level) => (
							<button
								key={level}
								type="button"
								aria-pressed={level === currentLevel}
								onClick={() => onSelectReasoning(level)}
								className={cn(
									"flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-left text-xs",
									level === currentLevel
										? "bg-accent text-accent-foreground"
										: "text-foreground hover:bg-foreground/5",
								)}
							>
								<span className="min-w-0 flex-1 truncate">{labels.levelLabel(level)}</span>
								{level === currentLevel && (
									<span className="icon-[solar--check-circle-linear] h-3 w-3 shrink-0" />
								)}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
	},
);

export { FAVORITES_COLUMN_ID };
