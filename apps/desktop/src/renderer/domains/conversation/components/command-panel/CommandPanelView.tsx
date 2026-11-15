import { cn } from "@astravia-org/ui/utils";
import { ButtonGroup, ButtonGroupItem } from "@astravia-org/ui/button-group";
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
 * 与输入卡片之间的间隙：**0**。
 *
 * 面板是输入卡片「长高」出来的形态，不是浮在旁边的另一块面板——底边压过卡片上描边
 * 1px、上圆角与卡片一致，视觉上就是同一个圆角容器。用户点击「添加」时，卡片整块抬高，
 * 列表随之出现。
 */
const CARD_GAP = 0;

/*
 * 出现方式：**只淡入，不做裁剪揭幕**。
 *
 * 早期用 `clip-path: inset()` 从上往下裁开（为了避开 height 动画的 layout 成本）。
 * 列表上百行时，每帧重新裁剪整块面板比淡入贵得多，而用户体验上的差别几乎为零：
 * 面板是输入卡片长高的结果，用户要的是「点了立刻出来」，不是一段可以欣赏的生长动画。
 * opacity 走合成层，行数多少都不影响每帧成本。
 */
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
 * 形态是**输入卡片自己长高**，不是浮层：底边压过卡片上描边 1px、上圆角与卡片一致、
 * 底色取卡片同一个 token（`--input-bar-bg`），因此换主题时一起变。用户点「添加」时，
 * 卡片整块抬高、列表从卡片里长出来。
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
						// -inset-x-px：定位父级是卡片内容盒（已被卡片 1px 描边内缩），不外扩这 1px
						/*
						 * `inset-x-0`：面板左右边缘与卡片**外边界**完全重合（两者描边都是 1px）。
						 * 之前写 `-inset-x-px`（早期面板锚在卡片内容盒里时的补偿），锚点换成
						 * 外层容器后那 1px 补偿就多出来了，接缝处能看到半像素错位。
						 * `bottom-[calc(100%-1px)]` 让面板底边压住卡片上描边那一行，两条竖线连成一条。
						 * 底色用卡片同一个 token（`--input-bar-bg`），换主题自动跟随。
						 */
						"absolute inset-x-0 bottom-[calc(100%-1px)] z-10 flex flex-col overflow-hidden rounded-t-[20px] border border-b-0 border-border bg-input-bar-bg",
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
									<ToolRow leftLabel={labels.hints.scrollToolsLeft} rightLabel={labels.hints.scrollToolsRight}>
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
									</ToolRow>
								)}
							</div>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

/**
 * 工具行。
 *
 * 一排插件/内置动作经常比面板宽。触控板可以两指横扫，但**台式机与不带触控板的笔记本
 * 只能靠拖滚动条**——而这里为了观感把滚动条藏了。因此行尾常驻一对左右切换按钮，
 * 点一下走一个按钮的宽度（逐格切换才看得见走到哪）。到顶/到底时按钮降到半透明表示
 * 那个方向没有了，位置不变，不会让整排胶囊跳动。
 */
function ToolRow({
	children,
	leftLabel,
	rightLabel,
}: {
	readonly children: React.ReactNode;
	readonly leftLabel: string;
	readonly rightLabel: string;
}): JSX.Element {
	const scrollerRef = useRef<HTMLDivElement>(null);
	const [edges, setEdges] = useState({ left: false, right: false });

	const sync = (): void => {
		const el = scrollerRef.current;
		if (!el) return;
		const left = el.scrollLeft > 1;
		const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
		setEdges((previous) => (previous.left === left && previous.right === right ? previous : { left, right }));
	};

	useEffect(() => {
		const el = scrollerRef.current;
		if (!el) return;
		sync();
		el.addEventListener("scroll", sync, { passive: true });
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(sync);
		observer?.observe(el);
		return () => {
			el.removeEventListener("scroll", sync);
			observer?.disconnect();
		};
	}, []);

	/** 逐格切换：一次走一个按钮的宽度（按钮 28 + 间距 6），位置与顺序都看得见。 */
	const scrollBy = (direction: -1 | 1): void => {
		const el = scrollerRef.current;
		if (!el) return;
		el.scrollBy({ left: direction * 34, behavior: "smooth" });
	};

	return (
		/*
		 * 左箭头在行首、右箭头在行尾：一左一右夹住可滚区，方向与位置一致（左箭头向左、
		 * 右箭头向右）。左内边距 6px 让**左箭头的左缘**与列表行内图标的左缘重合
		 * （实测同为 477）。箭头用单箭头，与左栏上下切换同一套 `alt-arrow-*`。
		 */
		/*
		 * 分隔线在**下沿**：工具行是面板的最后一行，它下面紧接输入区。线在上面会把
		 * 列表最后一项和工具行切开（看着像列表被截断），线在下面才表达「面板到此为止」。
		 */
		<div className="flex shrink-0 items-center gap-1 border-b border-border/30 pl-3 pr-1.5 pb-1.5 pt-1">
			<ScrollButton direction="left" label={leftLabel} disabled={!edges.left} onClick={() => scrollBy(-1)} />
			<div
				ref={scrollerRef}
				className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]"
			>
				{children}
			</div>
			<ScrollButton direction="right" label={rightLabel} disabled={!edges.right} onClick={() => scrollBy(1)} />
		</div>
	);
}

/**
 * 工具行的左右切换按钮。
 *
 * **常显**：只在溢出时才出现等于让无触控板的用户不知道这里还能翻。到底/到顶时降到
 * 半透明表示「这个方向没有了」，尺寸与位置不变。图标用双箭头，与左栏的上下切换同族。
 */
function ScrollButton({
	direction,
	label,
	disabled,
	onClick,
}: {
	readonly direction: "left" | "right";
	readonly label: string;
	readonly disabled: boolean;
	readonly onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
			/*
			 * 与条目行里的图标盒**同尺寸同圆角**（24×24 / 4px）：它是那一列图标的延续，
			 * 尺寸差 8px 时左缘虽然对齐，视觉重心却偏右，看起来像没对齐。
			 */
			className={cn(
				"flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors",
				disabled ? "cursor-default opacity-40" : "hover:bg-foreground/8 hover:text-foreground",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"size-3.5",
					direction === "left" ? "icon-[solar--alt-arrow-left-linear]" : "icon-[solar--alt-arrow-right-linear]",
				)}
			/>
		</button>
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
