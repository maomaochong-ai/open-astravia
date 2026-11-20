import { cn } from "@astravia-org/ui/utils";
import { ButtonGroup, ButtonGroupItem } from "@astravia-org/ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@astravia-org/ui";
import { ThemeSurface } from "@astravia-org/theme-ui/appearance/ThemeSurface";
import { ContextRingView } from "@astravia-org/theme-ui/chat/ContextRingView";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AddPanelList } from "./AddPanelList";
import { AddPanelPreviewView } from "./AddPanelPreviewView";
import { AddPanelRail } from "./AddPanelRail";
import { PANEL_REVEAL_MS, PANEL_REVEAL_TRANSITION } from "./constants";
import type { CommandPanelProps } from "./types";

/**
 * 面板高度：与模型选择器同一量级。两栏（轨道 + 列表/预览）比三栏窄，窄窗口更从容。
 */
const MAX_HEIGHT_PX = 320;
/** 面板顶部与视口顶之间至少保留的距离（标题栏 / 窗口圆角）。 */
const TOP_MARGIN = 16;
/**
 * 与输入卡片之间的间隙：**8**。
 *
 * 面板是与输入卡片**分离**的独立圆角浮层（见 ADR-0183）：四角圆角 + 四边描边 + 毛玻璃，
 * 与模型选择器同一套浮层语言，不再「长高」压过卡片上描边。
 */
const CARD_GAP = 8;

/** 窄输入区（容器宽度，非视口）下动作条最多平铺的动作数；超出的收进「更多」下拉。 */
const NARROW_INLINE_ACTIONS = 2;

const REVEAL_HIDDEN = { opacity: 0 };
const REVEAL_SHOWN = { opacity: 1 };

/**
 * 输入卡片的「添加」面板。
 *
 * 两栏：分类轨道（固定位置）｜内容区。内容区在两种形态间切换——
 *
 * - **列表**：搜索框 + 按来源分组的条目。点条目直接插入 / 执行，点行尾「详情」进预览。
 * - **预览**：整栏换成这一条的完整信息，带返回。没有动作按钮。
 *
 * 形态是输入卡片上方的**独立圆角浮层**（与卡片分离 8px）：四角圆角 + 四边描边 + 毛玻璃，
 * 底色取卡片同一个 token（`--input-bar-bg`），因此换主题时一起变。
 */
export function CommandPanelView({
	open,
	tab,
	query,
	sections,
	activeKey,
	scrollSignal,
	favorites,
	preview,
	searching,
	operation,
	actions,
	labels,
	panelRef,
	onPanelKeyDown,
	className,
	onSelectTab,
	onQueryChange,
	onActivateEntry,
	onOpenPreview,
	onClosePreview,
	onToggleFavorite,
	onOpenAbilityPlaza,
}: CommandPanelProps): JSX.Element {
	const reduceMotion = useReducedMotion();
	const transition = reduceMotion ? { duration: 0 } : PANEL_REVEAL_TRANSITION;
	const searchInputRef = useRef<HTMLInputElement>(null);
	// 恰好 3 个时平铺也放得下；多于 3 个才把第 3 个起折进「更多」。
	const hasOverflow = actions.length > NARROW_INLINE_ACTIONS + 1;
	const overflowActions = hasOverflow ? actions.slice(NARROW_INLINE_ACTIONS) : [];
	/**
	 * 揭幕完成前只渲染前若干行。
	 *
	 * 列表不做窗口化（一个会话能用的技能上百条，全量渲染本来是稳的），但**首帧**同步
	 * 布局上百行会顶掉揭幕的前几帧，看起来就是「点了以后停一下才出现」。分两段渲染：
	 * 动画期间只铺可视区那十几行（足够填满），动画结束再补齐。
	 */
	const [revealed, setRevealed] = useState(false);
	/**
	 * 可用高度：锚点（输入卡片上沿）到视口顶之间的空间。
	 *
	 * 面板向上生长，只在 CSS 里写 `min(360px, 56vh)` 是不够的——新会话页卡片上方是
	 * hero 与快捷动作条，面板长到 360px 时会整块盖住它们。因此按真实可用空间收口，
	 * 空间不足就变矮并在内部滚动，而不是压到别的内容上。
	 */
	const [maxHeight, setMaxHeight] = useState<number>(MAX_HEIGHT_PX);

	useEffect(() => {
		if (!open) return;
		const measure = (): void => {
			const anchor = panelRef.current;
			if (!anchor) return;
			// 参考点是「卡片上沿」：面板绝对定位在同一个 relative 容器里，bottom 100% 就是容器上沿。
			const anchorTop = anchor.parentElement?.getBoundingClientRect().top ?? anchor.getBoundingClientRect().top;
			const available = anchorTop - CARD_GAP - TOP_MARGIN;
			setMaxHeight(Math.max(180, Math.min(MAX_HEIGHT_PX, available)));
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [open, panelRef]);

	useEffect(() => {
		if (!open) return;
		/**
		 * 面板开着时由这里接管方向键 / Enter / Esc / Tab。
		 *
		 * 用 document 上的 capture 监听而不是只挂在面板容器上：输入框的编辑器在 capture
		 * 阶段就把这些键 `preventDefault` 掉了（焦点常常还在编辑器里），容器级监听根本收
		 * 不到。这里显式无视 `defaultPrevented`——面板开着时，这几个键的语义就是「在面板
		 * 里选东西」，不该交给编辑器。
		 */
		const handler = (event: KeyboardEvent): void => {
			if (event.isComposing) return;
			if (!["ArrowDown", "ArrowUp", "ArrowLeft", "Enter", "Tab", "Escape"].includes(event.key)) return;
			onPanelKeyDown(event as unknown as React.KeyboardEvent<HTMLElement>);
		};
		document.addEventListener("keydown", handler, true);
		return () => document.removeEventListener("keydown", handler, true);
	}, [onPanelKeyDown, open]);

	/*
	 * 揭幕结束的判定用定时器，不用 `onAnimationComplete`：
	 * `AnimatePresence initial={false}` 会让第一次展开**不播动画**，回调因此不触发，
	 * 列表就永远停在「前 12 行」。定时器与动画时长同源，掉帧与否都按时补齐。
	 */
	useEffect(() => {
		if (!open) {
			setRevealed(false);
			return;
		}
		const timer = window.setTimeout(() => setRevealed(true), PANEL_REVEAL_MS + 24);
		return () => window.clearTimeout(timer);
	}, [open]);

	/*
	 * 揭幕结束的判定用定时器，不用 `onAnimationComplete`：
	 * `AnimatePresence initial={false}` 会让第一次展开**不播动画**，回调因此不触发，
	 * 列表就永远停在「前 12 行」。定时器与动画时长同源，掉帧与否都按时补齐。
	 */
	useEffect(() => {
		if (!open) {
			setRevealed(false);
			return;
		}
		const timer = window.setTimeout(() => setRevealed(true), PANEL_REVEAL_MS + 24);
		return () => window.clearTimeout(timer);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		// 打开就把焦点放进搜索框（模型选择器同款行为）：用户第一反应是打字。
		// 预览态不抢焦点，否则返回列表时焦点会跳回搜索框、看着像刚打开。
		if (preview) return;
		const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [open, preview]);

	return (
		<AnimatePresence initial={false}>
			{open && (
				<motion.div
					key="add-panel"
					ref={panelRef}
					initial={REVEAL_HIDDEN}
					animate={REVEAL_SHOWN}
					exit={REVEAL_HIDDEN}
					transition={transition}

					className={[
						// 独立圆角浮层：与输入卡片分离 8px（CARD_GAP），四角圆角 + 四边描边，
						// 底色用卡片同 token + backdrop-blur，与模型选择器同一套毛玻璃浮层语言。
						"absolute inset-x-0 bottom-[calc(100%+8px)] z-10 flex flex-col overflow-hidden rounded-[20px] border border-border bg-input-bar-bg/85 backdrop-blur-xl",
						className,
					]
						.filter(Boolean)
						.join(" ")}
				>
					<ThemeSurface slot="chat.slashPanel" />
					<div
						className="relative z-10 flex min-h-0 flex-col"
						style={{ maxHeight }}

					>
						<div className="flex min-h-0 flex-1">
							<AddPanelRail
								tab={tab}
								labels={labels}
								onSelectTab={onSelectTab}
								onOpenAbilityPlaza={onOpenAbilityPlaza}
							/>

							<div className="flex min-h-0 min-w-0 flex-1 flex-col">
								{preview ? (
									<AddPanelPreviewView preview={preview} labels={labels} onBack={onClosePreview} />
								) : (
									<>
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

										{sections.every((section) => section.groups.every((group) => group.entries.length === 0)) &&
										!operation ? (
											<EmptyState
												title={
													searching
														? labels.emptyNoMatch
														: tab === "favorites"
															? labels.favoritesEmpty
															: labels.categoryEmpty(labels.categoryLabel(tab))
												}
												hint={
													searching
														? labels.emptyNoMatchHint
														: tab === "favorites"
															? labels.favoritesEmptyHint
															: tab === "operations"
																? labels.operationsEmptyHint
																: labels.emptyNoSkillsHint
												}
											/>
										) : (
											<AddPanelList
												sections={sections}
												operation={tab === "operations" ? operation : undefined}
												activeKey={activeKey}
												scrollSignal={scrollSignal}
												favorites={favorites}
												labels={labels}
												searching={searching || tab === "all"}
												tabKey={tab}
											limit={revealed ? undefined : 12}
												onActivateEntry={onActivateEntry}
												onOpenPreview={onOpenPreview}
												onToggleFavorite={onToggleFavorite}
											/>
										)}
									</>
								)}
								{actions.length > 0 && (
									<div className="no-scrollbar flex shrink-0 items-center overflow-x-auto px-3 pb-2 pt-1">
										<ButtonGroup blur={false} shape="square">
											{actions.map((action, index) => (
												<ButtonGroupItem
													key={action.id}
													active={action.active}
													onClick={action.onToggle}
													title={action.label}
													className={
														hasOverflow && index >= NARROW_INLINE_ACTIONS ? "hidden @[32rem]:inline-flex" : undefined
													}
													icon={
														action.icon ? (
															<span className="flex size-4 items-center justify-center">{action.icon}</span>
														) : undefined
													}
													label={action.label}
												/>
											))}
											{hasOverflow ? (
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<ButtonGroupItem
															className="@[32rem]:hidden"
															active={overflowActions.some((action) => action.active)}
															title={labels.moreActions}
															aria-label={labels.moreActions}
															icon={<span className="icon-[solar--menu-dots-bold] size-4" />}
														/>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end" side="top" data-command-panel-keep-open="true">
														{overflowActions.map((action) => (
															<DropdownMenuItem key={action.id} onSelect={action.onToggle}>
																{action.icon ? (
																	<span className="flex size-4 shrink-0 items-center justify-center">{action.icon}</span>
																) : null}
																<span className="min-w-0 flex-1 truncate">{action.label}</span>
																{action.active ? (
																	<span className="icon-[solar--check-circle-bold] size-4 shrink-0 text-primary" />
																) : null}
															</DropdownMenuItem>
														))}
													</DropdownMenuContent>
												</DropdownMenu>
											) : null}
										</ButtonGroup>
									</div>
								)}
							</div>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
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
