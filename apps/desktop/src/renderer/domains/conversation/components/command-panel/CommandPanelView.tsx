import { ThemeSurface } from "@astravia-org/theme-ui/appearance/ThemeSurface";
import { ContextRingView } from "@astravia-org/theme-ui/chat/ContextRingView";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { ConnectorGrid } from "./ConnectorGrid";
import { FadingScrollArea } from "./FadingScrollArea";
import { SkillList } from "./SkillList";
import { PANEL_REVEAL_ROWS, PANEL_REVEAL_TRANSITION } from "./constants";
import type { CommandPanelProps } from "./types";

/**
 * 命令区最大高度。
 * 它与编辑区、工具栏共处一张卡片，因此还要给短窗口留余量——纯 420 在小屏上
 * 会把整条 bar 顶到占掉大半个视口。
 */
const MAX_HEIGHT = "min(320px, 40vh)";

/** 揭幕：从上往下裁开。内容不动，因此描边、圆角与卡片接缝全程都在终态位置上。 */
const REVEAL_CLIPPED = { clipPath: "inset(100% 0 0 0)" };
const REVEAL_SHOWN = { clipPath: "inset(0% 0 0 0)" };

/**
 * InputBar 的「展开」形态：命令区。
 *
 * 它是输入卡片的子节点（形态切换，不是外挂浮层），但**不参与布局**——底边钉在
 * 卡片顶沿、向上生长。否则在会话页里展开会把消息列表整体顶上去，正在读的内容
 * 会跳走。相接侧不留圆角与描边，视觉上仍是同一块面长高了。
 *
 * 区内结构：连接器宫格 + skill 列表（同一滚动容器）→ 命令条（固定在底部）。
 * 宫格随内容滚动、向下滚时让位给 skills；否则 8 个连接器就能把可滚区压到只剩几行。
 */
export function CommandPanelView({
	open,
	filter,
	items,
	activeIndex,
	operation,
	connectors,
	connectorColumns,
	actions,
	pluginActions,
	labels,
	resolveIcon,
	panelRef,
	className,
	onHoverItem,
	onSelectItem,
	onSelectConnector,
}: CommandPanelProps): JSX.Element {
	const filtering = filter.length > 0;
	const reduceMotion = useReducedMotion();
	const transition = reduceMotion ? { duration: 0 } : PANEL_REVEAL_TRANSITION;
	// 揭幕完成前列表只出可视区那几行、渐隐 mask 也先不挂：动画期间少一份重绘。
	const [revealed, setRevealed] = useState(false);
	useEffect(() => {
		if (!open) setRevealed(false);
	}, [open]);

	return (
		<AnimatePresence initial={false}>
			{open && (
				<motion.div
					key="command-region"
					ref={panelRef}
					initial={REVEAL_CLIPPED}
					animate={REVEAL_SHOWN}
					exit={REVEAL_CLIPPED}
					transition={transition}
					onAnimationComplete={() => setRevealed(true)}
					// 只在面板存在期间挂着：动画开始前就得就位才有用，收起时整块一起卸载。
					style={{ willChange: "clip-path" }}
					className={[
						// -inset-x-px：定位父级是卡片的内容盒（已被卡片 1px 描边内缩），
						// 不外扩这 1px 的话本区描边会比卡片描边窄一圈，接缝处看着像台阶。
						// bottom 压过 100% 那 1px：底下正对着卡片的上描边（展开态置成透明，见
						// InputBarView），那 1px 不被盖住时会在接缝上留一条贯穿全宽的细线，
						// 两块面看着是被切开的。命令区自己的底边无描边，压下去正好补平。
						// 不写描边色：缺省吃 base 层的 `* { border-border }`，聚焦态由 className
						// 传 `border-primary/20` 覆盖，和输入卡片一起亮，否则接缝上下两截颜色不一样。
						"absolute -inset-x-px bottom-[calc(100%-1px)] z-10 overflow-hidden rounded-t-[20px] border border-b-0 bg-input-bar-bg transition-[border-color] duration-200",
						className,
					]
						.filter(Boolean)
						.join(" ")}
				>
					<ThemeSurface slot="chat.slashPanel" />
					<div className="relative z-10 flex flex-col" style={{ maxHeight: MAX_HEIGHT }}>
						<FadingScrollArea className="pt-2" suspended={!revealed}>
							{operation ? (
								<button
									type="button"
									data-index="0"
									disabled={operation.disabled}
									onMouseEnter={() => onHoverItem(0)}
									onClick={operation.onSelect}
									className="relative flex h-8 w-full items-center gap-2 px-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
									style={{
										background:
											activeIndex === 0 ? "color-mix(in srgb, var(--primary) 9%, transparent)" : "transparent",
									}}
								>
									{activeIndex === 0 && (
										<motion.span
											layoutId="command-panel-active-marker"
											className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
											transition={{ type: "spring", stiffness: 500, damping: 32 }}
										/>
									)}
									<span className="flex h-5 w-5 shrink-0 items-center justify-center">
										{operation.contextRing ? (
											<ContextRingView {...operation.contextRing} className="pointer-events-none" />
										) : (
											<span className="h-4 w-4 rounded-full border border-border" aria-hidden="true" />
										)}
									</span>
									<span className="shrink-0 truncate text-[12.5px] font-medium text-foreground">
										{operation.label}
									</span>
									<span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground/50">
										{operation.description}
									</span>
								</button>
							) : null}
							{/* 过滤态隐藏宫格：此时用户在找 skill，键盘导航也只走列表 */}
							{!filtering && (
								<ConnectorGrid
									items={connectors}
									columns={connectorColumns}
									title={labels.connectorsSection}
									onSelect={onSelectConnector}
								/>
							)}
							{/* 插件开关：一行一个，带开启状态。放列表里而不是底部平铺，避免插件一多
							    就变成一整行看不出谁开着的标签。点一下即开启，插件自己负责打开它的面板。 */}
							{!filtering && pluginActions.length > 0 ? (
								<div className="flex flex-col gap-0.5 px-2 pb-1">
									<div className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-muted-foreground/60">
										{labels.pluginsSection}
									</div>
									{pluginActions.map((action) => (
										<button
											key={action.id}
											type="button"
											onClick={action.onToggle}
											title={action.label}
											aria-pressed={action.active}
											className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-foreground/5"
										>
											<span className="flex h-4 w-4 shrink-0 items-center justify-center">{action.icon}</span>
											<span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
												{action.label}
											</span>
											<span
												aria-hidden="true"
												className={[
													"h-4 w-4 shrink-0",
													action.active
														? "icon-[solar--check-circle-bold] text-primary"
														: "icon-[solar--add-circle-linear] text-muted-foreground/40",
												].join(" ")}
											/>
										</button>
									))}
								</div>
							) : null}
							{items.length > 0 || !operation ? <SkillList
								items={items}
								activeIndex={operation ? activeIndex - 1 : activeIndex}
								indexOffset={operation ? 1 : 0}
								labels={labels}
								filtering={filtering}
								limit={revealed ? undefined : PANEL_REVEAL_ROWS}
								resolveIcon={resolveIcon}
								onHover={(index) => onHoverItem(index + (operation ? 1 : 0))}
								onSelect={onSelectItem}
							/> : null}
						</FadingScrollArea>

						{/* A mouse has no horizontal axis and the scrollbar here is hidden, so without
						    the wheel handler below the strip is unreachable on a desktop once the
						    plugins outgrow it. Touchpads already send deltaX; both axes are accepted. */}
						{actions.length > 0 && (
							<div
								className="no-scrollbar flex shrink-0 flex-nowrap items-center gap-0.5 overflow-x-auto px-3 pb-1 pt-1"
								onWheel={(event) => {
									const strip = event.currentTarget;
									const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
									if (!delta) return;
									const before = strip.scrollLeft;
									strip.scrollLeft = before + delta;
									// Only claim the gesture when it actually moved the strip; otherwise the
									// panel behind it keeps its own scrolling.
									if (strip.scrollLeft !== before) event.preventDefault();
								}}
							>
								{actions.map((action) => (
									<button
										key={action.id}
										type="button"
										onClick={action.onToggle}
										title={action.label}
										className={[
											"flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-0.5 text-[12px] font-medium transition-colors",
											action.active
												? "bg-primary/10 text-primary"
												: "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
										].join(" ")}
									>
										{action.icon ? (
											<span className="flex h-3.5 w-3.5 items-center justify-center">{action.icon}</span>
										) : null}
										{action.label}
									</button>
								))}
							</div>
						)}
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
