import { cn } from "@astravia-org/ui/utils";
import { ButtonGroup, ButtonGroupItem } from "@astravia-org/ui/button-group";
import { ThemeSurface } from "@astravia-org/theme-ui/appearance/ThemeSurface";
import { ContextRingView } from "@astravia-org/theme-ui/chat/ContextRingView";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AddPanelList } from "./AddPanelList";
import { AddPanelPreviewView } from "./AddPanelPreviewView";
import { AddPanelRail } from "./AddPanelRail";
import { PANEL_REVEAL_TRANSITION } from "./constants";
import type { CommandPanelProps } from "./types";

/**
 * 面板高度：与模型选择器同一量级。两栏（轨道 + 列表/预览）比三栏窄，窄窗口更从容。
 */
const MAX_HEIGHT_PX = 320;
/** 面板顶部与视口顶之间至少保留的距离（标题栏 / 窗口圆角）。 */
const TOP_MARGIN = 16;
/** 与输入卡片之间的间隙：8px 够看出是两层面，再多就显松散。 */
const CARD_GAP = 8;

/** 揭幕：从上往下裁开。内容不动，因此描边与圆角全程停在终态位置上。 */
const REVEAL_CLIPPED = { clipPath: "inset(100% 0 0 0)" };
const REVEAL_SHOWN = { clipPath: "inset(0% 0 0 0)" };

/**
 * 输入卡片的「添加」面板：左栏分类、中栏列表、右栏预览与详情。
 *
 * 两栏：分类轨道（固定位置）｜内容区。内容区在两种形态间切换——
 *
 * - **列表**：搜索框 + 按来源分组的条目。点条目直接插入 / 执行，点行尾「详情」进预览。
 * - **预览**：整栏换成这一条的完整信息，带返回。没有动作按钮。
 *
 * 面板是输入卡片的子节点、`absolute` 定位、与卡片留 8px 间隙：它是浮层而不是与卡片
 * 接成一整块的长高形态——毛玻璃必须透出背后的会话内容，卡片是不透明的。
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
					initial={REVEAL_CLIPPED}
					animate={REVEAL_SHOWN}
					exit={REVEAL_CLIPPED}
					transition={transition}
					style={{ willChange: "clip-path" }}
					className={[
						// -inset-x-px：定位父级是卡片内容盒（已被卡片 1px 描边内缩），不外扩这 1px
						// 面板描边会比卡片窄一圈。bottom-[calc(100%+8px)]：与卡片留 8px 间隙（见 CARD_GAP）。
						"absolute -inset-x-px bottom-[calc(100%+8px)] z-10 flex flex-col overflow-hidden rounded-xl border border-border/50 bg-background/40 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_24px_60px_-18px_rgb(0_0_0/0.65)]",
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
												searching={searching}
												tabKey={tab}
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

								{/* 快捷键统一放在最底部一行：工具行在上、提示在下，视线自然落在「怎么操作」。 */}
								<div className="flex h-7 shrink-0 items-center gap-3 border-t border-border/25 px-3 text-[10px] text-muted-foreground/70">
									<Hint keys="↑ ↓" label={labels.hints.navigate} />
									<Hint keys="Enter" label={labels.hints.insert} />
									<Hint keys="esc" label={labels.hints.close} />
								</div>
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
		<div className="flex shrink-0 items-center gap-0.5 pb-1 pl-3 pr-1.5 pt-0.5">
			<ScrollButton direction="left" label={leftLabel} disabled={!edges.left} onClick={() => scrollBy(-1)} />
			<div ref={scrollerRef} className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto">
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
			className={cn(
				"flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors",
				disabled ? "cursor-default opacity-40" : "hover:bg-foreground/8 hover:text-foreground",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"size-4",
					direction === "left" ? "icon-[solar--alt-arrow-left-linear]" : "icon-[solar--alt-arrow-right-linear]",
				)}
			/>
		</button>
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
