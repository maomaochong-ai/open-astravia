import { AnimatePresence, motion } from "motion/react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MultiplierTag } from "@shared/components/ModelSelect/MultiplierTag";
import { ProviderIcon } from "@shared/components/provider-icon";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@vetta/ui";
import { cn } from "@shared/lib/utils";
import { ThemeSurface } from "@vetta/theme-ui/appearance";
import type { ModelSelectorViewProps } from "./types";

const MODEL_ITEM_SELECTOR = "[data-model-key]";

/** 紧凑行：覆盖 @vetta/ui 默认的 px-3 py-2 text-[13px]，让模型多时列表不至于过长。 */
const COMPACT_ITEM_CLASS = "gap-1.5 rounded-md px-2 py-1 text-xs";
const COMPACT_LABEL_CLASS = "px-2 pb-0.5 pt-1 text-[10px]";

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
	className,
	classNames,
	onModelSelect,
	onReasoningSelect,
}: ModelSelectorViewProps): JSX.Element {
	const [open, setOpen] = useState(false);
	const [reasoningOpen, setReasoningOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const searchInputRef = useRef<HTMLInputElement>(null);
	const modelListRef = useRef<HTMLDivElement>(null);

	const filteredGroups = useMemo(() => {
		const query = normalizeSearchValue(searchQuery);
		if (!query) return groups;

		return groups.flatMap((group) => {
			const models = group.models.filter((model) =>
				[
					model.displayName,
					model.modelId,
					model.provider,
					group.label,
					...(model.tags ?? []),
				].some((value) => normalizeSearchValue(value).includes(query)),
			);
			return models.length > 0 ? [{ ...group, models }] : [];
		});
	}, [groups, searchQuery]);

	const handleOpenChange = useCallback((nextOpen: boolean) => {
		setOpen(nextOpen);
		if (!nextOpen) {
			setReasoningOpen(false);
			setSearchQuery("");
		}
	}, []);

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

	const handleModelSelect = (key: string) => {
		onModelSelect(key);
		setSearchQuery("");
	};

	return (
		<DropdownMenu open={open} onOpenChange={handleOpenChange}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					title={selectedOption?.displayName ?? labels.placeholder}
					className={cn(
						// 输入卡 @container：窄宽缩短模型名、藏推理档，避免工具栏换行
						"flex min-w-0 max-w-[5.5rem] items-center gap-1 rounded-full border border-transparent px-1.5 py-0.5 text-[11px] text-foreground transition-colors focus:outline-none focus-visible:outline-none data-[state=open]:bg-accent/60 data-[state=open]:text-foreground @[22rem]:max-w-[9rem] @[28rem]:max-w-[13rem]",
						className,
						classNames?.trigger,
					)}
				>
					{selectedOption && (
						<ProviderIcon
							symbol={groups.find((g) => g.provider === selectedOption.provider)?.icon}
							className="h-3 w-3 shrink-0"
						/>
					)}
					<span className="min-w-0 flex-1 truncate text-left">
						{selectedOption?.displayName ?? labels.placeholder}
					</span>
					{currentLevel && (
						<span className="hidden shrink-0 rounded bg-muted/70 px-1 text-[9px] leading-[14px] text-muted-foreground @[28rem]:inline">
							{labels.levelLabel(currentLevel)}
						</span>
					)}
					<span className="icon-[solar--alt-arrow-down-linear] h-2.5 w-2.5 shrink-0" />
				</button>
			</DropdownMenuTrigger>
			<AnimatePresence>
				{open && (
					<DropdownMenuContent
						forceMount
						asChild
						align="start"
						className={cn(
							// 底色跟搜索框走同一个变量：搜索行去掉底色后要和面板融成一块
						"w-[min(16rem,calc(100vw-2rem))] min-w-[180px] max-w-[16rem] overflow-visible bg-background p-0",
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
											<input
												ref={searchInputRef}
												type="search"
												value={searchQuery}
												onChange={handleSearchChange}
												onClick={handleSearchClick}
												placeholder={labels.searchPlaceholder}
												aria-label={labels.searchPlaceholder}
												className="h-7 w-full rounded-md pl-7 pr-7 text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
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
									{menuLevels.length > 0 && (
										<>
											<DropdownMenuSub open={reasoningOpen} onOpenChange={setReasoningOpen}>
												<DropdownMenuSubTrigger className={COMPACT_ITEM_CLASS}>
													<span className="min-w-0 flex-1 truncate">{labels.reasoningHeader}</span>
													{currentLevel && (
														<span className="shrink-0 text-[11px] text-muted-foreground">
															{labels.levelLabel(currentLevel)}
														</span>
													)}
												</DropdownMenuSubTrigger>
												<AnimatePresence>
													{reasoningOpen && (
														<DropdownMenuSubContent
															forceMount
															asChild
															className="min-w-[130px] overflow-visible bg-background p-0"
															style={{ animation: "none" }}
														>
															<motion.div
																initial={{ opacity: 0, scale: 0.96, x: -6 }}
																animate={{ opacity: 1, scale: 1, x: 0 }}
																exit={{ opacity: 0, scale: 0.96, x: -6 }}
																transition={{ duration: 0.1, ease: [0.16, 1, 0.3, 1] }}
															>
																<div className="relative overflow-visible rounded-[inherit]">
																	<ThemeSurface slot="chat.modelSelectorReasoningMenu" />
																	<div className="relative z-10 overflow-hidden rounded-[inherit] p-1">
																		<DropdownMenuLabel className={COMPACT_LABEL_CLASS}>
																			{labels.reasoningHeader}
																		</DropdownMenuLabel>
																		{menuLevels.map((level) => (
																			<DropdownMenuItem
																				key={level}
																				className={COMPACT_ITEM_CLASS}
																				onSelect={() => onReasoningSelect(level)}
																			>
																				<span className="min-w-0 flex-1 truncate">
																					{labels.levelLabel(level)}
																				</span>
																				{level === currentLevel && (
																					<span className="icon-[solar--check-circle-linear] h-3 w-3 shrink-0" />
																				)}
																			</DropdownMenuItem>
																		))}
																	</div>
																</div>
															</motion.div>
														</DropdownMenuSubContent>
													)}
												</AnimatePresence>
											</DropdownMenuSub>
											<DropdownMenuSeparator />
										</>
									)}
									<div ref={modelListRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
										<DropdownMenuLabel className={COMPACT_LABEL_CLASS}>{labels.modelHeader}</DropdownMenuLabel>
										{filteredGroups.map((group) => (
										<div key={group.provider}>
											<div
												className={cn(
													"flex items-center gap-1 px-2 pb-0.5 pt-1 text-[10px] font-medium text-muted-foreground/50",
													classNames?.providerHeader,
												)}
											>
												<ProviderIcon symbol={group.icon} className="h-2.5 w-2.5" />
												<span className="min-w-0 truncate">{group.label}</span>
												{group.models[0]?.remote && (
													<span className="shrink-0 rounded-full bg-primary/15 px-1 text-[9px] font-medium text-primary">
														{labels.cloudOnly}
													</span>
												)}
											</div>
											{group.models.map((model) => (
												<DropdownMenuItem
													key={model.key}
													data-model-key={model.key}
													aria-current={model.key === selectedModel ? "true" : undefined}
													className={cn(
														COMPACT_ITEM_CLASS,
														model.key === selectedModel && "bg-accent text-accent-foreground",
														classNames?.item,
													)}
													onSelect={() => handleModelSelect(model.key)}
												>
													<span className="min-w-0 flex-1 truncate">{model.displayName}</span>
													<MultiplierTag multiplier={model.multiplier} />
													{model.supportsImage && (
														<span
															aria-label={labels.visionBadge}
															title={labels.visionBadge}
															className="icon-[solar--gallery-linear] size-3 shrink-0 text-primary"
														/>
													)}
													{model.key === defaultKey && (
														<span className="shrink-0 rounded-full bg-primary/15 px-1 text-[9px] font-medium text-primary">
															{labels.defaultBadge}
														</span>
													)}
													{model.key === selectedModel && (
														<span className="icon-[solar--check-circle-linear] h-3 w-3 shrink-0" />
													)}
												</DropdownMenuItem>
											))}
										</div>
										))}
										{filteredGroups.length === 0 && (
											<div className="flex min-h-24 flex-col items-center justify-center px-4 py-6 text-center">
												<span aria-hidden="true" className="icon-[solar--magnifer-linear] mb-1.5 size-4 text-muted-foreground" />
												<p className="text-xs font-medium text-foreground">{labels.noResults}</p>
												<p className="mt-0.5 text-[11px] text-muted-foreground">{labels.noResultsHint}</p>
											</div>
										)}
									</div>
								</div>
							</div>
						</motion.div>
					</DropdownMenuContent>
				)}
			</AnimatePresence>
		</DropdownMenu>
	);
}
