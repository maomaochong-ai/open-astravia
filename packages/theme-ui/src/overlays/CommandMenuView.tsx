import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, type JSX, type RefObject } from "react";
import { cn } from "@vetta/ui";
import { ThemeSurface } from "../appearance/ThemeSurface";
import { CommandMenuRow } from "./CommandMenuRow";
import type { CommandMenuGroupView, CommandMenuViewLabels } from "./command-menu-types";
import "./command-menu.css";

/**
 * 全局 Command Menu 的纯展示层：无状态、无数据获取，键盘导航由宿主的快捷键
 * scope 驱动（见 desktop `shared/shortcuts`），本组件只负责渲染与滚动跟随。
 *
 * 面板顶部对齐而非垂直居中：结果条数会变，垂直居中会让输入框随每次击键上下跳。
 */

export interface CommandMenuViewProps {
	readonly open: boolean;
	readonly query: string;
	readonly groups: readonly CommandMenuGroupView[];
	readonly selectedId: string | null;
	readonly labels: CommandMenuViewLabels;
	/** 结果集因击键刚变化：抑制选中指示条的位移动画。 */
	readonly suppressSelectionAnimation: boolean;
	readonly inputRef?: RefObject<HTMLInputElement | null>;
	readonly onQueryChange: (value: string) => void;
	readonly onHoverItem: (id: string) => void;
	readonly onActivateItem: (id: string) => void;
	readonly onClose: () => void;
}

export function CommandMenuView({
	open,
	query,
	groups,
	selectedId,
	labels,
	suppressSelectionAnimation,
	inputRef,
	onQueryChange,
	onHoverItem,
	onActivateItem,
	onClose,
}: CommandMenuViewProps): JSX.Element {
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const rowRefs = useRef(new Map<string, HTMLButtonElement>());

	const registerRef = useCallback((id: string, element: HTMLButtonElement | null) => {
		if (element) rowRefs.current.set(id, element);
		else rowRefs.current.delete(id);
	}, []);

	// 选中项滚动跟随。用 "nearest" 且不带 smooth：连续按方向键时平滑滚动会排队堆积。
	// 可选链到方法本身：jsdom 与部分老 webview 没有实现 scrollIntoView，不能让它把渲染打断。
	useEffect(() => {
		if (!open || !selectedId) return;
		rowRefs.current.get(selectedId)?.scrollIntoView?.({ block: "nearest" });
	}, [open, selectedId]);

	const hasResults = groups.some((group) => group.items.length > 0);
	const anyLoading = groups.some((group) => group.loading);

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					ref={overlayRef}
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.14 }}
					// 与 ConfirmDialogView 同因：portal 到 body 后需显式恢复指针事件。
					// 遮罩刻意不用 backdrop-filter——全屏模糊是低端机上最贵的一笔。
					className="pointer-events-auto fixed inset-0 z-[100] flex items-start justify-center bg-background/70 pt-[12vh]"
					onMouseDown={(event) => {
						if (event.target === overlayRef.current) onClose();
					}}
				>
					<motion.div
						role="dialog"
						aria-modal="true"
						aria-label={labels.title}
						initial={{ opacity: 0, scale: 0.96, y: -8 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.96, y: -8 }}
						transition={{ duration: 0.16, ease: [0.25, 0.1, 0.25, 1] }}
						className="command-menu-sheen relative flex w-[min(640px,calc(100vw-32px))] flex-col rounded-2xl border border-border/80 bg-popover shadow-2xl"
					>
						<ThemeSurface slot="root.commandMenu.panel" />
						<div className="relative z-10 flex min-h-0 flex-col">
							<div className="relative flex h-12 shrink-0 items-center gap-2.5 px-3.5">
								<span
									aria-hidden="true"
									className="icon-[solar--magnifer-linear] size-4 shrink-0 text-muted-foreground"
								/>
								<input
									ref={inputRef}
									type="text"
									role="combobox"
									aria-expanded={hasResults}
									aria-controls="command-menu-list"
									aria-activedescendant={selectedId ? `command-menu-item-${selectedId}` : undefined}
									aria-label={labels.title}
									autoComplete="off"
									spellCheck={false}
									value={query}
									placeholder={labels.placeholder}
									onChange={(event) => onQueryChange(event.target.value)}
									className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground/70"
								/>
								<span
									aria-hidden="true"
									className="command-menu-input-underline pointer-events-none absolute inset-x-3.5 bottom-0 h-px bg-border/70"
								/>
							</div>

							<div
								id="command-menu-list"
								role="listbox"
								aria-label={labels.title}
								className="min-h-0 max-h-[min(420px,56vh)] overflow-y-auto overscroll-contain px-1.5 py-1.5"
							>
								{groups.map((group) => {
									if (group.items.length === 0 && !group.loading) return null;
									return (
										<div key={group.key} role="group" aria-label={group.label} className="mb-1 last:mb-0">
											<div className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground/70">
												{group.label}
											</div>
											{group.items.map((item) => (
												<CommandMenuRow
													key={item.id}
													item={item}
													active={item.id === selectedId}
													suppressSelectionAnimation={suppressSelectionAnimation}
													onActivate={onActivateItem}
													onHover={onHoverItem}
													registerRef={registerRef}
												/>
											))}
											{group.loading && (
												<div
													aria-label={labels.loading}
													className="flex h-9 items-center gap-2.5 px-2.5"
												>
													{/* 固定高度骨架：异步结果到达时不产生高度跳变。 */}
													<span className="size-4 shrink-0 animate-pulse rounded bg-muted" />
													<span className="h-3 w-40 animate-pulse rounded bg-muted" />
												</div>
											)}
											{group.overflowLabel && (
												<div className="px-2.5 pb-1 pt-0.5 text-[11px] text-muted-foreground/60">
													{group.overflowLabel}
												</div>
											)}
										</div>
									);
								})}

								{!hasResults && !anyLoading && (
									<div className="flex flex-col items-center gap-1 px-3 py-10 text-center">
										<span className="text-[13px] text-foreground">{labels.empty}</span>
										<span className="text-[11px] text-muted-foreground">{labels.emptyHint}</span>
									</div>
								)}
							</div>

							<div
								className={cn(
									"flex h-8 shrink-0 items-center gap-3 border-t border-border/60 px-3.5",
									"text-[11px] text-muted-foreground/80",
								)}
							>
								<span>{labels.hintNavigate}</span>
								<span>{labels.hintSelect}</span>
								<span className="ml-auto">{labels.hintClose}</span>
							</div>
						</div>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
