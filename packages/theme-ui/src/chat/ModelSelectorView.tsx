import { AnimatePresence } from "motion/react";
import type {
	ChangeEvent,
	JSX,
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
	ReactNode,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@astravia-org/ui/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@astravia-org/ui/popover";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { MultiplierTag } from "../shared/MultiplierTag";
import { ProviderIcon } from "../shared/provider-icon";
import {
	FAVORITES_COLUMN_ID,
	MODEL_FAVORITES_STORAGE_KEY,
	parseModelFavorites,
	serializeModelFavorites,
	toggleModelFavorite,
} from "./model-selector-columns";
import { ModelSelectorMenuPanel, type ModelSelectorMenuPanelHandle } from "./ModelSelectorMenuPanel";
import { ModelSelectorTrigger, type ModelSelectorTriggerVariant } from "./ModelSelectorTrigger";

export type { ModelSelectorTriggerVariant } from "./ModelSelectorTrigger";

/**
 * 模型选择器的视图层：搜索、按 provider 分组、推理档位子菜单、云端/默认/视觉徽章。
 *
 * 纯展示——模型从哪来、选中后写到哪、文案怎么翻译，全部由调用方通过 props 决定。
 * 宿主的输入栏用它，插件（看板等）经 `@astravia-org/theme-ui/plugin-ui` 用的也是同一个，
 * 两边因此不会长成两副样子。
 */

/** 选择器需要的模型字段；宿主的 ModelOption 结构上即满足它。 */
export interface ModelSelectorOptionView {
	/** `provider/modelId`。 */
	readonly key: string;
	readonly provider: string;
	readonly modelId: string;
	readonly displayName: string;
	/** 参与搜索匹配的附加标签。 */
	readonly tags?: readonly string[];
	/** 来自远程目录（云端）；分组头会打上 `labels.cloudOnly` 徽章。 */
	readonly remote?: boolean;
	readonly supportsImage?: boolean;
}

export interface ModelSelectorLabels {
	placeholder: string;
	searchPlaceholder: string;
	clearSearch: string;
	noResults: string;
	noResultsHint: string;
	reasoningHeader: string;
	modelHeader: string;
	cloudOnly: string;
	/** 三栏模式：收藏栏标题、星标标题、搜索命中标题。 */
	favoritesHeader: string;
	/** 收藏为空时第二栏的提示；不给时回落到搜索空态。 */
	favoritesEmpty?: string;
	/**
	 * 服务商栏的无障碍名称（三栅左栏）。插件自备文案，因此可缺省；
	 * 缺省时该分组没有名字，与之前行为一致。
	 */
	providerHeader?: string;
	favorite: string;
	unfavorite: string;
	searchResultsHeader: string;
	visionBadge: string;
	defaultBadge: string;
	levelLabel: (value: string) => string;
	/**
	 * 计费倍率标（如「2×」「免费」）。返回空/undefined 则不渲染——倍率含义与文案属于
	 * 宿主的计费口径，视图不猜。
	 */
	multiplierLabel?: (option: ModelSelectorOptionView) => string | undefined;
	/**
	 * 行尾详情入口的标题。提供后，识图 / 倍率 / 默认这些标识就收进浮层，行上只留名字与星标。
	 * 不给时保持旧行为（标识直接排在行里），插件复用本视图时不会凭空多出一个按钮。
	 */
	infoButton?: string;
	infoProvider?: string;
	infoId?: string;
	infoVision?: string;
	infoMultiplier?: string;
	infoDefault?: string;
	infoYes?: string;
	infoNo?: string;
	/** 服务商栏折叠后的「收起」文案；不给时只在展开态显示一个箭头。 */
	fewerProviders?: string;
}

export interface ModelSelectorProviderGroup {
	provider: string;
	label: string;
	icon?: string;
	models: readonly ModelSelectorOptionView[];
}

export interface ModelSelectorViewProps {
	selectedModel?: string;
	selectedOption: ModelSelectorOptionView | null;
	currentLevel?: string;
	menuLevels: string[];
	groups: readonly ModelSelectorProviderGroup[];
	defaultKey?: string;
	labels: ModelSelectorLabels;
	ariaLabel?: string;
	disabled?: boolean;
	/** 触发器形态：输入栏胶囊（默认）或表单选择框。 */
	triggerVariant?: ModelSelectorTriggerVariant;
	/** 可选的空值项，例如“不固定模型”或“跟随会话默认”。 */
	emptyOption?: {
		readonly label: string;
		readonly onSelect: () => void;
	};
	/** 面板底栏：左侧放权限/模式这类低频入口，右侧放辅助动作。 */
	footerStart?: ReactNode;
	footerEnd?: ReactNode;
	className?: string;
	classNames?: {
		trigger?: string;
		content?: string;
		contentInner?: string;
		providerHeader?: string;
		item?: string;
	};
	onModelSelect: (key: string) => void;
	onReasoningSelect: (value: string) => void;
	/** 菜单开合回调，宿主可借此在打开时刷新模型目录 */
	onOpenChange?: (open: boolean) => void;
	/** 搜索框右侧的刷新按钮：重拉服务商的模型列表。不传就不显示。 */
	refresh?: { onRefresh: () => void; refreshing: boolean; label: string };
	/** 受控开合：宿主用自己的快捷键（Cmd/Ctrl+P）打开同一面板时传这个。 */
	open?: boolean;
}

/** 紧凑行：覆盖 @astravia-org/ui 默认的 px-3 py-2 text-[13px]，让模型多时列表不至于过长。 */
const COMPACT_ITEM_CLASS = "gap-1.5 rounded-md px-2 py-1 text-xs";

function normalizeSearchValue(value: string): string {
	return value.trim().toLocaleLowerCase();
}

export function ModelSelectorView({
	selectedModel,
	selectedOption,
	currentLevel,
	menuLevels,
	groups,
	defaultKey,
	labels,
	ariaLabel,
	disabled = false,
	triggerVariant = "inline",
	emptyOption,
	footerStart,
	footerEnd,
	className,
	classNames,
	onModelSelect,
	onReasoningSelect,
	onOpenChange,
	refresh,
	open: controlledOpen,
}: ModelSelectorViewProps): JSX.Element {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const open = controlledOpen ?? uncontrolledOpen;
	const [searchQuery, setSearchQuery] = useState("");
	/**
	 * 收藏只存本机：它是「我这台机器常用的模型」，跨设备同步反而会让别人的目录影响
	 * 自己的菜单。存储不可用时退化为本次会话内有效。
	 */
	const [favorites, setFavorites] = useState<string[]>(() => {
		if (typeof localStorage === "undefined") return [];
		try {
			return parseModelFavorites(localStorage.getItem(MODEL_FAVORITES_STORAGE_KEY) ?? undefined);
		} catch {
			return [];
		}
	});
	const searchInputRef = useRef<HTMLInputElement>(null);
	const panelRef = useRef<ModelSelectorMenuPanelHandle>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const portalContainer = open
		? (triggerRef.current?.closest<HTMLElement>('[data-slot="drawer-content"], [data-slot="dialog-content"]') ??
			undefined)
		: undefined;
	// 打开时停在哪一列决定了 reveal 能否按 key 定位到当前模型。只有「收藏栏」或「选中模型所在
	// 的服务商」两列里找得到它——若 fallback 到第一个服务商，而当前模型在别的服务商，reveal 按
	// key 找不到就放弃定位，列表停在无关的列里（「再打开不对焦到当前模型」的根因）。
	const initialProviderId = selectedModel
		? favorites.includes(selectedModel)
			? FAVORITES_COLUMN_ID
			: (groups.find((group) => group.models.some((model) => model.key === selectedModel))?.provider ??
					undefined)
		: undefined;

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			setUncontrolledOpen(nextOpen);
			if (!nextOpen) {
				setSearchQuery("");
			}
			onOpenChange?.(nextOpen);
		},
		[onOpenChange],
	);

	useEffect(() => {
		if (!open) return;

		// 只负责把焦点放进搜索框；当前模型的定位由面板按 key + 行下标自己算，
		// 窗口化后目标行常常还没挂载，从这里查 DOM 永远查不到。
		const frame = requestAnimationFrame(() => {
			searchInputRef.current?.focus();
		});

		return () => cancelAnimationFrame(frame);
	}, [open]);

	const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
		setSearchQuery(event.target.value);
	};

	const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") return;
		event.stopPropagation();

		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		// 列表是窗口化渲染的：按下方向键先让面板按行下标定位并聚焦首/尾行。
		const moved =
			event.key === "ArrowDown" ? panelRef.current?.focusFirstModel() : panelRef.current?.focusLastModel();
		// 没有可选项时不要吞掉按键：按下去什么也不发生比没有快捷键更糟。
		if (!moved) return;
		event.preventDefault();
	};

	const handleSearchClick = (event: ReactMouseEvent<HTMLInputElement | HTMLButtonElement>) => {
		event.stopPropagation();
	};

	const handleClearSearch = (event: ReactMouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		setSearchQuery("");
		searchInputRef.current?.focus();
	};

	const handleToggleFavorite = useCallback((key: string) => {
		setFavorites((previous) => {
			const next = toggleModelFavorite(previous, key);
			try {
				localStorage.setItem(MODEL_FAVORITES_STORAGE_KEY, serializeModelFavorites(next));
			} catch {
				// 存储不可用（隐私模式、配额满）：本次会话内仍然生效。
			}
			return next;
		});
	}, []);

	// 面板 props 的对象字面量同理：每次渲染都换新引用会让 memo 的行全部失效。
	const panelClassNames = useMemo(
		() => ({
			...(classNames?.providerHeader ? { providerHeader: classNames.providerHeader } : {}),
			...(classNames?.item ? { item: classNames.item } : {}),
		}),
		[classNames?.item, classNames?.providerHeader],
	);

	// 稳定引用：面板里的行是 memo 的，回调每次换新会让所有行跟着重渲。
	const handleModelSelect = useCallback(
		(key: string) => {
			onModelSelect(key);
			setSearchQuery("");
			// 有思考档位时保持打开：用户接下来还要在同一面板里选强度（右栏）。
			// 没有档位就关掉——此时选中即完成，留着面板只会挡视线。
			if (menuLevels.length === 0) handleOpenChange(false);
		},
		[menuLevels.length, onModelSelect],
	);

	/**
	 * 搜索框：在三栏面板的中栏顶部。宿主掌握焦点、过滤与「↓ 跳进列表」的按键联动，
	 * 面板只负责把它摆进中栏——搜索与列表同宽，横向层级才对得上。
	 */
	const searchField = (
		<div className="flex items-center gap-0.5">
			<div className="relative min-w-0 flex-1" onKeyDown={handleSearchKeyDown}>
			<span
				aria-hidden="true"
				className="icon-[solar--magnifer-linear] pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
			/>
			{/* type=search 在 WebKit 里自带清除按钮，会与下面自绘的那个同时出现 */}
			<input
				ref={searchInputRef}
				type="search"
				value={searchQuery}
				onChange={handleSearchChange}
				onClick={handleSearchClick}
				placeholder={labels.searchPlaceholder}
				aria-label={labels.searchPlaceholder}
				className="h-7 w-full rounded-md pl-7 pr-7 text-[11px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
			/>
			{searchQuery && (
				<button
					type="button"
					onClick={handleClearSearch}
					aria-label={labels.clearSearch}
					className="absolute right-1 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<span aria-hidden="true" className="icon-[solar--close-circle-linear] size-3" />
				</button>
				)}
			</div>
			{refresh && (
				<button
					type="button"
					onClick={refresh.onRefresh}
					disabled={refresh.refreshing}
					aria-label={refresh.label}
					title={refresh.label}
					className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
				>
					<span
						aria-hidden="true"
						className={cn("icon-[solar--refresh-linear] size-3.5", refresh.refreshing && "animate-spin")}
					/>
				</button>
			)}
		</div>
	);

	return (
		/*
		 * 容器用 Popover 而不是 DropdownMenu：内容已经是一个三栏面板（服务商列表、
		 * 可滚动的模型列表、思考档位列，加搜索框与星标按钮），不是一串 role="menuitem"。
		 * 放进 role="menu" 里既不合 ARIA（菜单只能包含 menuitem），也会让 Radix 的
		 * 方向键导航把焦点困在「菜单项」之间。Popover 的语义是「一个带交互的附属面板」，
		 * 正好对应它，且同样支持 Esc 与点击外部关闭。
		 */
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild disabled={disabled}>
				<ModelSelectorTrigger
					ref={triggerRef}
					aria-label={ariaLabel}
					disabled={disabled}
					variant={triggerVariant}
					label={selectedOption?.displayName ?? labels.placeholder}
					icon={
						selectedOption ? groups.find((group) => group.provider === selectedOption.provider)?.icon : undefined
					}
					reasoningLabel={currentLevel ? labels.levelLabel(currentLevel) : undefined}
					className={cn(className, classNames?.trigger)}
				/>
			</PopoverTrigger>
			<AnimatePresence>
				{open && (
					/*
					 * 不要 `asChild`：那会把 `FLOATING_SURFACE_CLASS` 的 `rounded-2xl` 一起拼到内层
					 * `rounded-[inherit]` 所在的同一个元素上（Radix 的 Slot 只是拼接 className，
					 * 不经 tailwind-merge 去重），`inherit` 于是从 portal 容器继承到 0，面板就变成直角。
					 * 让 Popover 自己出那层带圆角的面，内层再 `rounded-[inherit]` 才是真正的圆角卡片。
					 */
					<PopoverContent
						forceMount
						portalContainer={portalContainer}
						align="start"
						// 菜单贴窗口右缘时会被推到边上：留出边距让它整体往左收。
						collisionPadding={16}
						className={cn(
							// 玻璃只由真正的半透明与背景模糊构成：不叠描边、高光或额外投影去「假装」透明。
							// 深色下的边界交给基础浮层的极淡描边，这里再加一圈会变成两条边。
							"w-auto min-w-[180px] max-w-[calc(100vw-2rem)] overflow-visible bg-background/40 p-0 backdrop-blur-2xl backdrop-saturate-150 dark:bg-background/75 dark:backdrop-brightness-50",
							// 深色下背后若是大块白色内容，透出来会很刺眼：抬高底色不透明度并压暗背景亮度。
							classNames?.content,
						)}
						// 开合交给 CSS：三栏面板每次弹出都跑一遍 spring，滚动时看着像卡了一下。
						style={{ animation: "model-selector-in 110ms cubic-bezier(0.16, 1, 0.3, 1)" }}
					>
							<div className="relative overflow-visible rounded-[inherit]">
								<ThemeSurface slot="chat.modelSelectorMenu" />
								<div
									className={cn(
										"relative z-10 flex flex-col overflow-hidden rounded-[inherit]",
										classNames?.contentInner,
									)}
								>
									<ModelSelectorMenuPanel
										ref={panelRef}
										searchSlot={searchField}
										groups={groups}
										selectedModel={selectedModel}
										revealModelKey={open ? selectedModel : null}
										currentLevel={currentLevel}
										menuLevels={menuLevels}
										defaultKey={defaultKey}
										labels={labels}
										favoriteKeys={favorites}
										searchQuery={searchQuery}
										{...(initialProviderId ? { initialProviderId } : {})}
										emptyOption={
											emptyOption
												? {
														label: emptyOption.label,
														onSelect: () => {
															emptyOption.onSelect();
															handleOpenChange(false);
														},
													}
												: undefined
										}
										classNames={panelClassNames}
										onSelectModel={handleModelSelect}
										onSelectReasoning={(level) => {
											onReasoningSelect(level);
										}}
										onToggleFavorite={handleToggleFavorite}
									/>
									{(footerStart || footerEnd) && (
										<div
											data-model-selector-footer="true"
											className="flex h-9 shrink-0 items-center justify-between gap-2 border-t border-border/40 px-2"
										>
											<div className="flex min-w-0 items-center">{footerStart}</div>
											<div className="flex min-w-0 shrink-0 items-center">{footerEnd}</div>
										</div>
									)}
								</div>
							</div>
					</PopoverContent>
				)}
			</AnimatePresence>
		</Popover>
	);
}

function ModelMultiplier({ label }: { label?: string }): JSX.Element | null {
	return label ? <MultiplierTag text={label} /> : null;
}
