import { ButtonGroup, ButtonGroupItem } from "@astravia-org/ui/button-group";
import { ThemeSurface } from "@astravia-org/theme-ui/appearance/ThemeSurface";
import { ContextRingView } from "@astravia-org/theme-ui/chat/ContextRingView";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AddPanelDetailView } from "./AddPanelDetailView";
import { AddPanelList } from "./AddPanelList";
import { AddPanelRail } from "./AddPanelRail";
import { PANEL_REVEAL_TRANSITION } from "./constants";
import type { CommandPanelProps } from "./types";

/**
 * 面板最大高度：与模型选择器同一量级（`min(340px, 52vh)`）。
 * 三栏布局需要最小宽度，窗口极窄时由容器查询退化（见 `@max-[720px]` 规则）。
 */
const MAX_HEIGHT = "min(340px, 52vh)";

/** 揭幕：从上往下裁开。内容不动，因此描边与圆角全程停在终态位置上。 */
const REVEAL_CLIPPED = { clipPath: "inset(100% 0 0 0)" };
const REVEAL_SHOWN = { clipPath: "inset(0% 0 0 0)" };

/**
 * 输入卡片的「添加」面板：左栏分类、中栏列表、右栏详情。
 *
 * 与改造前的两点不同：
 *
 * 1. **独立浮层**，不再是与卡片接成一整块的长高形态。毛玻璃必须透出背后的会话内容，
 *    而卡片是不透明的——「同一块面长高」与玻璃互斥，因此改为与卡片留 8px 的浮层，
 *    描边、圆角、投影都独立。
 * 2. **三栏**：分类轨道（固定位置）｜搜索 + 列表｜详情与动作。清单过千时只滚动中间
 *    那一栏，分类永远在同一个位置。
 *
 * 面板仍是输入卡片的子节点、`absolute` 定位、不参与布局——展开不会把消息列表顶上去。
 */
export function CommandPanelView({
	open,
	tab,
	query,
	sections,
	activeKey,
	favorites,
	detail,
	searching,
	operation,
	actions,
	labels,
	panelRef,
	className,
	onSelectTab,
	onQueryChange,
	onHoverEntry,
	onActivateEntry,
	onToggleFavorite,
	onOpenAbilityPlaza,
	onOpenEntryInPlaza,
}: CommandPanelProps): JSX.Element {
	const reduceMotion = useReducedMotion();
	const transition = reduceMotion ? { duration: 0 } : PANEL_REVEAL_TRANSITION;
	// 揭幕完成前不挂渐隐 mask：动画期间少一份重绘。
	const [revealed, setRevealed] = useState(false);
	const searchInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) setRevealed(false);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		// 打开就把焦点放进搜索框：模型选择器也是这个行为，用户第一反应是打字。
		const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [open]);

	return (
		<AnimatePresence initial={false}>
			{open && (
				<motion.div
					key="add-panel"
					ref={panelRef}
					initial={REVEAL_CLIPPED}
					animate={REVEAL_SHOWN}
					exit={REVEAL_CLIPPED}
					transition={transition}
					onAnimationComplete={() => setRevealed(true)}
					style={{ willChange: "clip-path" }}
					className={[
						// -inset-x-px：定位父级是卡片内容盒（已被卡片 1px 描边内缩），不外扩这 1px
						// 面板描边会比卡片窄一圈。bottom-[calc(100%+8px)]：与卡片留 8px 间隙。
						"absolute -inset-x-px bottom-[calc(100%+8px)] z-10 flex flex-col overflow-hidden rounded-xl border border-border bg-background/40 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_24px_60px_-18px_rgb(0_0_0/0.65)]",
						className,
					]
						.filter(Boolean)
						.join(" ")}
				>
					<ThemeSurface slot="chat.slashPanel" />
					<div
						className="relative z-10 flex min-h-0 flex-col"
						style={{ maxHeight: MAX_HEIGHT }}
						onKeyDown={(event) => {
							// 搜索框里的 Escape 交给面板关闭；其余按键不进编辑器。
							if (event.key !== "Escape" && event.key !== "ArrowDown" && event.key !== "ArrowUp") {
								event.stopPropagation();
							}
						}}
					>
						{operation && (
							<button
								type="button"
								disabled={operation.disabled}
								onMouseEnter={() => onHoverEntry("__operation__")}
								onClick={operation.onSelect}
								className="relative flex h-7 shrink-0 items-center gap-2 px-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
							>
								<span className="flex size-4 shrink-0 items-center justify-center">
									{operation.contextRing ? (
										<ContextRingView {...operation.contextRing} className="pointer-events-none" />
									) : (
										<span className="size-3.5 rounded-full border border-border" aria-hidden="true" />
									)}
								</span>
								<span className="shrink-0 truncate text-[11.5px] font-medium text-foreground">
									{operation.label}
								</span>
								<span className="min-w-0 flex-1 truncate text-right text-[10.5px] text-muted-foreground/60">
									{operation.description}
								</span>
							</button>
						)}

						<div className="flex min-h-0 flex-1">
							<AddPanelRail
								tab={tab}
								labels={labels}
								onSelectTab={onSelectTab}
								onOpenAbilityPlaza={onOpenAbilityPlaza}
							/>

							<div className="flex min-h-0 min-w-0 flex-1 flex-col">
								<div className="shrink-0 px-1 pt-1">
									<div className="relative">
										<span
											aria-hidden="true"
											className="icon-[solar--magnifer-linear] pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
										/>
										{/* type=search 在 WebKit 里自带清除按钮，隐藏它，只留自绘的那个 */}
										<input
											ref={searchInputRef}
											type="search"
											value={query}
											onChange={(event) => onQueryChange(event.target.value)}
											placeholder={labels.searchPlaceholder}
											aria-label={labels.searchPlaceholder}
											className="h-7 w-full rounded-md bg-transparent pl-7 pr-7 text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
										/>
										{query.length > 0 && (
											<button
												type="button"
												aria-label={labels.clearSearch}
												title={labels.clearSearch}
												onClick={() => onQueryChange("")}
												className="absolute right-1 top-1/2 inline-flex size-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
											>
												<span aria-hidden="true" className="icon-[solar--close-circle-linear] size-3" />
											</button>
										)}
									</div>
								</div>

								{sections.length === 0 || sections.every((section) => section.groups.length === 0) ? (
									<EmptyState
										title={searching ? labels.emptyNoMatch : labels.categoryEmpty}
										hint={searching ? labels.emptyNoMatchHint : labels.emptyNoSkillsHint}
									/>
								) : (
									<AddPanelList
										sections={sections}
										activeKey={activeKey}
										favorites={favorites}
										labels={labels}
										searching={searching}
										onHoverEntry={onHoverEntry}
										onActivateEntry={onActivateEntry}
										onToggleFavorite={onToggleFavorite}
									/>
								)}
							</div>

							{detail && (
								<AddPanelDetailView
									detail={detail}
									onActivate={() => onActivateEntry(detail.key)}
									onSecondary={onOpenEntryInPlaza}
								/>
							)}
						</div>

						<div className="flex h-8 shrink-0 items-center justify-between gap-2 border-t border-border/40 px-2.5 text-[10px] text-muted-foreground/70">
							<div className="flex min-w-0 items-center gap-2.5">
								<Hint keys="↑ ↓" label={labels.hints.navigate} />
								<Hint keys="Tab" label={labels.hints.tab} />
								<Hint keys="Enter" label={labels.hints.insert} />
								<Hint keys="esc" label={labels.hints.close} />
							</div>
						</div>

						{actions.length > 0 && (
							<div className="no-scrollbar flex shrink-0 items-center overflow-x-auto border-t border-border/40 px-2 py-1.5">
								<ButtonGroup blur={false} shape="square">
									{actions.map((action) => (
										<ButtonGroupItem
											key={action.id}
											active={action.active}
											onClick={action.onToggle}
											title={action.label}
											icon={
												action.icon ? (
													<span className="flex size-4 items-center justify-center">{action.icon}</span>
												) : undefined
											}
											label={action.label}
										/>
									))}
								</ButtonGroup>
							</div>
						)}
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

function Hint({ keys, label }: { readonly keys: string; readonly label: string }): JSX.Element {
	return (
		<span className="flex items-center gap-1 whitespace-nowrap">
			<kbd className="rounded border border-border/60 bg-foreground/5 px-1 text-[9px] font-medium leading-4 text-muted-foreground">
				{keys}
			</kbd>
			{label}
		</span>
	);
}

function EmptyState({ title, hint }: { readonly title: string; readonly hint: string }): JSX.Element {
	return (
		<div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
			<span className="mb-1 flex size-8 items-center justify-center rounded-full border border-border/40 text-muted-foreground">
				<span aria-hidden="true" className="icon-[solar--magnifer-linear] size-3.5" />
			</span>
			<p className="text-[11.5px] font-medium text-foreground/85">{title}</p>
			<p className="max-w-56 text-[10.5px] leading-relaxed text-muted-foreground">{hint}</p>
		</div>
	);
}
