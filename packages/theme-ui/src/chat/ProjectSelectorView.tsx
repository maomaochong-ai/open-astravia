import { AnimatePresence, motion } from "motion/react";
import type { JSX, KeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@vetta/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface ProjectSelectorOptionView {
	readonly cwd: string;
	readonly name: string;
	readonly selected: boolean;
}

export interface ProjectSelectorViewLabels {
	/** 未选中态的 trigger 文案。 */
	readonly placeholder: string;
	/** 列表顶部那条「回到未选中」的条目。 */
	readonly clear: string;
	readonly searchPlaceholder: string;
	readonly empty: string;
	readonly newProject: string;
	readonly openProject: string;
	/** 待创建项目名后缀，例如「待创建」。 */
	readonly pendingHint: string;
	/** 点发送后、项目正在落盘时替换 trigger 的文案。 */
	readonly creating: string;
	readonly triggerTitle: string;
}

export interface ProjectSelectorViewProps {
	readonly open: boolean;
	readonly options: readonly ProjectSelectorOptionView[];
	readonly labels: ProjectSelectorViewLabels;
	/** 当前选中的项目名；未选中时为 null。 */
	readonly selectedName: string | null;
	/** 选中的是尚未落盘的新项目。 */
	readonly pendingCreate: boolean;
	/** 发送流程正在创建项目：trigger 换文案并禁用交互。 */
	readonly creating: boolean;
	readonly searchVisible: boolean;
	readonly query: string;
	readonly highlightIndex: number;
	readonly className?: string;
	readonly classNames?: {
		readonly root?: string;
		readonly trigger?: string;
		readonly content?: string;
		readonly contentInner?: string;
		readonly item?: string;
	};
	readonly onOpenChange: (open: boolean) => void;
	readonly onQueryChange: (query: string) => void;
	readonly onHighlightMove: (delta: number) => void;
	/** 选中某个项目；传 null 表示「不指定项目」。 */
	readonly onSelect: (cwd: string | null) => void;
	/** 搜索框里回车：由宿主决定落到当前高亮项。 */
	readonly onCommitHighlight: () => void;
	readonly onCreateProject: () => void;
	readonly onOpenProject: () => void;
}

/**
 * 新会话页 hero 与输入框之间的项目选择器。
 *
 * 与输入框内的执行模式 / 模型选择器同构：Popover + 一条 0.12s 的 opacity 过渡，
 * 不做位移与缩放——这一行的三个 popover 必须看起来是同一套东西。
 */
export function ProjectSelectorView({
	open,
	options,
	labels,
	selectedName,
	pendingCreate,
	creating,
	searchVisible,
	query,
	highlightIndex,
	className,
	classNames,
	onOpenChange,
	onQueryChange,
	onHighlightMove,
	onSelect,
	onCommitHighlight,
	onCreateProject,
	onOpenProject,
}: ProjectSelectorViewProps): JSX.Element {
	const searchRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open && searchVisible) searchRef.current?.focus();
	}, [open, searchVisible]);

	const triggerLabel = creating ? labels.creating : (selectedName ?? labels.placeholder);
	const triggerIcon = pendingCreate
		? "icon-[solar--add-folder-linear]"
		: selectedName
			? "icon-[solar--folder-linear]"
			: "icon-[solar--folder-with-files-linear]";

	function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			onHighlightMove(1);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			onHighlightMove(-1);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			onCommitHighlight();
		}
	}

	return (
		<div className={cn("min-w-0", className, classNames?.root)}>
			<Popover open={open} onOpenChange={creating ? undefined : onOpenChange}>
				<PopoverTrigger asChild>
					<button
						type="button"
						disabled={creating}
						title={labels.triggerTitle}
						aria-label={labels.triggerTitle}
						className={cn(
							// 与左侧模式切换共用同一层 accent 底色：一行里两枚同族的静默 chip。
							"no-drag flex h-7 max-w-[16rem] min-w-0 items-center gap-1.5 rounded-lg bg-accent/50 px-2.5 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-60",
							open ? "bg-accent text-foreground" : "text-foreground hover:bg-accent",
							!selectedName && !creating && "text-muted-foreground/80 hover:text-foreground",
							classNames?.trigger,
						)}
					>
						<span className={cn(triggerIcon, "h-3.5 w-3.5 shrink-0")} aria-hidden />
						<span className="min-w-0 truncate">{triggerLabel}</span>
						{pendingCreate && !creating && (
							<span className="shrink-0 text-[11px] font-normal text-muted-foreground/70">
								{labels.pendingHint}
							</span>
						)}
						<span className="icon-[solar--alt-arrow-down-linear] h-3 w-3 shrink-0 opacity-70" aria-hidden />
					</button>
				</PopoverTrigger>
				<AnimatePresence>
					{open && (
						<PopoverContent
							forceMount
							asChild
							side="bottom"
							align="start"
							sideOffset={6}
							className={cn(
								"w-[228px] gap-0 overflow-visible rounded-lg border border-border p-0",
								classNames?.content,
							)}
							style={{ animation: "none" }}
						>
							<motion.div
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.12, ease: "easeOut" }}
								className="relative overflow-visible rounded-[inherit]"
							>
								<ThemeSurface slot="chat.projectSelectorMenu" />
								<div className={cn("relative z-10 rounded-[inherit] p-1", classNames?.contentInner)}>
									{searchVisible && (
										<input
											ref={searchRef}
											type="text"
											value={query}
											onChange={(event) => onQueryChange(event.target.value)}
											onKeyDown={handleSearchKeyDown}
											placeholder={labels.searchPlaceholder}
											aria-label={labels.searchPlaceholder}
											className="mb-1 w-full rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-input"
										/>
									)}
									<div className="max-h-[260px] overflow-y-auto">
										<button
											type="button"
											onClick={() => onSelect(null)}
											className={cn(
												"flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
												classNames?.item,
											)}
										>
											<span className="icon-[solar--close-circle-linear] h-3.5 w-3.5 shrink-0" aria-hidden />
											<span className="truncate">{labels.clear}</span>
										</button>
										{options.length === 0 ? (
											<p className="px-2 py-2 text-[12px] text-muted-foreground/70">{labels.empty}</p>
										) : (
											options.map((option, index) => (
												<button
													key={option.cwd}
													type="button"
													title={option.name}
													onClick={() => onSelect(option.cwd)}
													className={cn(
														"flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium transition-colors",
														option.selected || index === highlightIndex
															? "bg-accent text-foreground"
															: "text-foreground hover:bg-accent",
														classNames?.item,
													)}
												>
													<span className="icon-[solar--folder-linear] h-3.5 w-3.5 shrink-0" aria-hidden />
													<span className="truncate">{option.name}</span>
													{option.selected && (
														<span
															className="icon-[solar--check-circle-linear] ml-auto h-3.5 w-3.5 shrink-0 text-primary"
															aria-hidden
														/>
													)}
												</button>
											))
										)}
									</div>
									<div className="mt-1 border-t border-border pt-1">
										<button
											type="button"
											onClick={onCreateProject}
											className={cn(
												"flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent",
												classNames?.item,
											)}
										>
											<span className="icon-[solar--add-folder-linear] h-3.5 w-3.5 shrink-0" aria-hidden />
											<span className="truncate">{labels.newProject}</span>
										</button>
										<button
											type="button"
											onClick={onOpenProject}
											className={cn(
												"flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent",
												classNames?.item,
											)}
										>
											<span className="icon-[solar--folder-open-linear] h-3.5 w-3.5 shrink-0" aria-hidden />
											<span className="truncate">{labels.openProject}</span>
										</button>
									</div>
								</div>
							</motion.div>
						</PopoverContent>
					)}
				</AnimatePresence>
			</Popover>
		</div>
	);
}
