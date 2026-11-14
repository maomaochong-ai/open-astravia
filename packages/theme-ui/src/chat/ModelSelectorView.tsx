import { AnimatePresence, motion } from "motion/react";
import type { ChangeEvent, JSX, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@astravia-org/ui/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@astravia-org/ui/popover";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { MultiplierTag } from "../shared/MultiplierTag";
import { ProviderIcon } from "../shared/provider-icon";
import {
	MODEL_FAVORITES_STORAGE_KEY,
	parseModelFavorites,
	serializeModelFavorites,
	toggleModelFavorite,
} from "./model-selector-columns";
import { ModelSelectorMenuPanel } from "./ModelSelectorMenuPanel";
import { ModelSelectorTrigger } from "./ModelSelectorTrigger";

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
	/** 可选的空值项，例如“不固定模型”或“跟随会话默认”。 */
	emptyOption?: {
		readonly label: string;
		readonly onSelect: () => void;
	};
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
}

const MODEL_ITEM_SELECTOR = "[data-model-key]";

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
	emptyOption,
	className,
	classNames,
	onModelSelect,
	onReasoningSelect,
	onOpenChange,
}: ModelSelectorViewProps): JSX.Element {
	const [open, setOpen] = useState(false);
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
	const modelListRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const portalContainer = open
		? (triggerRef.current?.closest<HTMLElement>('[data-slot="drawer-content"], [data-slot="dialog-content"]') ??
			undefined)
		: undefined;

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			setOpen(nextOpen);
			if (!nextOpen) {
				setSearchQuery("");
			}
			onOpenChange?.(nextOpen);
		},
		[onOpenChange],
	);

	useEffect(() => {
		if (!open) return;

		const frame = requestAnimationFrame(() => {
			searchInputRef.current?.focus();
			if (!selectedModel) return;
			const selectedItem = Array.from(
				modelListRef.current?.querySelectorAll<HTMLElement>(MODEL_ITEM_SELECTOR) ?? [],
			).find((item) => item.dataset.modelKey === selectedModel);
			selectedItem?.scrollIntoView({ block: "nearest" });
		});

		return () => cancelAnimationFrame(frame);
	}, [open, selectedModel]);

	const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
		setSearchQuery(event.target.value);
	};

	const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Escape") return;
		event.stopPropagation();

		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const items = Array.from(modelListRef.current?.querySelectorAll<HTMLElement>(MODEL_ITEM_SELECTOR) ?? []);
		const target = event.key === "ArrowDown" ? items[0] : items[items.length - 1];
		if (!target) return;
		event.preventDefault();
		target.focus();
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

	const handleModelSelect = (key: string) => {
		onModelSelect(key);
		setSearchQuery("");
		// 有思考档位时保持打开：用户接下来还要在同一面板里选强度（右栏）。
		// 没有档位就关掉——此时选中即完成，留着面板只会挡视线。
		if (menuLevels.length === 0) setOpen(false);
	};

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
					<PopoverContent
						forceMount
						asChild
						portalContainer={portalContainer}
						align="start"
						// 菜单贴窗口右缘时会被推到边上：留出边距让它整体往左收。
						collisionPadding={16}
						className={cn(
							// 底色跟搜索框走同一个变量：搜索行去掉底色后要和面板融成一块
							"w-[min(34rem,calc(100vw-2rem))] min-w-[20rem] max-w-[34rem] overflow-visible bg-background p-0",
							classNames?.content,
						)}
						style={{ animation: "none" }}
					>
						<motion.div
							initial={{ opacity: 0, scale: 0.96, y: 8 }}
							animate={{ opacity: 1, scale: 1, y: 0 }}
							exit={{ opacity: 0, scale: 0.96, y: 8 }}
							transition={{ duration: 0.1, ease: [0.16, 1, 0.3, 1] }}
						>
							<div className="relative overflow-visible rounded-[inherit]">
								<ThemeSurface slot="chat.modelSelectorMenu" />
								<div
									className={cn(
										"relative z-10 flex max-h-[min(360px,60vh)] flex-col overflow-hidden rounded-[inherit] p-1",
										classNames?.contentInner,
									)}
								>
									<div className="shrink-0 p-0.5">
										<div className="relative" onKeyDown={handleSearchKeyDown}>
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
									</div>
									<ModelSelectorMenuPanel
										groups={groups}
										selectedModel={selectedModel}
										currentLevel={currentLevel}
										menuLevels={menuLevels}
										defaultKey={defaultKey}
										labels={labels}
										favoriteKeys={favorites}
										searchQuery={searchQuery}
										emptyOption={
											emptyOption
												? {
														label: emptyOption.label,
														onSelect: () => {
															emptyOption.onSelect();
															setOpen(false);
														},
													}
												: undefined
										}
										classNames={{
											...(classNames?.providerHeader ? { providerHeader: classNames.providerHeader } : {}),
											...(classNames?.item ? { item: classNames.item } : {}),
										}}
										onSelectModel={handleModelSelect}
										onSelectReasoning={(level) => {
											onReasoningSelect(level);
										}}
										onToggleFavorite={handleToggleFavorite}
									/>
								</div>
							</div>
						</motion.div>
					</PopoverContent>
				)}
			</AnimatePresence>
		</Popover>
	);
}

function ModelMultiplier({ label }: { label?: string }): JSX.Element | null {
	return label ? <MultiplierTag text={label} /> : null;
}
