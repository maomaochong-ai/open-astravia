import { motion } from "motion/react";
import { useCallback, useEffect, useId, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

function cn(...parts: Array<string | false | null | undefined>): string {
	return parts.filter(Boolean).join(" ");
}

export interface TabBarItem<T extends string> {
	key: T;
	label: string;
	/** string 视为 iconify class；其余按 React 节点渲染（插件 tab 自带 icon） */
	icon?: ReactNode;
	/** 可选未读小红点（>0 显示） */
	badge?: number;
	/** 为 true 时 hover 该页签浮现减号按钮，点击触发 onRemove（文件等固定 tab 不可移除） */
	removable?: boolean;
}

export interface TabBarProps<T extends string> {
	items: TabBarItem<T>[];
	value: T;
	onChange: (value: T) => void;
	className?: string;
	/** 容器尺寸正在变化时设为 true，禁用激活指示器的滑动动画，避免抖动 */
	suppressLayoutAnimation?: boolean;
	/** 点击页签减号时触发；未传则不渲染减号按钮 */
	onRemove?: (key: T) => void;
	/** 拖拽排序结束后回调完整的新顺序；未传则禁用拖拽 */
	onReorder?: (keys: T[]) => void;
	/**
	 * 响应式溢出回调：按当前宽度容纳不下、被收纳起来的页签 key 列表（保持原顺序）。
	 * 由父级渲染到"下拉"菜单里。传了此回调即开启响应式收纳。
	 */
	onOverflowChange?: (overflowKeys: T[]) => void;
	/** 页签右键：父级可弹自定义上下文菜单；未传则禁用右键菜单（事件已 preventDefault，避免浏览器菜单）。 */
	onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, key: T) => void;
}

/** 页签条左右内边距（px-3 = 0.75rem）。 */
const ROW_PADDING_X = 12;
/** 相邻页签的负边距重叠量（-ml-2 = 0.5rem），计算容纳宽度时需扣除。 */
const TAB_OVERLAP = 8;

/** 把 from 处的 key 移动到 to 处，返回新数组。 */
function moveKey<T>(keys: T[], from: T, to: T): T[] {
	const fromIdx = keys.indexOf(from);
	const toIdx = keys.indexOf(to);
	if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return keys;
	const next = [...keys];
	next.splice(fromIdx, 1);
	next.splice(toIdx, 0, from);
	return next;
}

/**
 * 贪心计算溢出 key：始终保证激活页签可见（优先占位），再按顺序从头容纳，放不下即收纳其后全部。
 * 返回保持原顺序的溢出 key 列表。
 */
function computeOverflow<T extends string>(
	items: TabBarItem<T>[],
	activeKey: T,
	avail: number,
	widthOf: (key: T) => number,
): T[] {
	if (items.length === 0) return [];
	const visible = new Set<T>();
	let used = 0;
	const take = (key: T): void => {
		used += visible.size > 0 ? Math.max(0, widthOf(key) - TAB_OVERLAP) : widthOf(key);
		visible.add(key);
	};
	if (items.some((it) => it.key === activeKey)) take(activeKey);
	for (const it of items) {
		if (visible.has(it.key)) continue;
		const add = visible.size > 0 ? Math.max(0, widthOf(it.key) - TAB_OVERLAP) : widthOf(it.key);
		if (used + add <= avail) {
			used += add;
			visible.add(it.key);
		} else {
			break;
		}
	}
	return items.filter((it) => !visible.has(it.key)).map((it) => it.key);
}

function sameKeys<T>(a: T[], b: T[]): boolean {
	return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** 页签内容（图标 + 文字 + 小红点），真实页签与隐藏测量层共用，保证宽度一致。 */
function TabInner({
	icon,
	label,
	badge,
	active,
}: {
	icon?: ReactNode;
	label: string;
	badge?: number;
	active: boolean;
}): JSX.Element {
	return (
		<span className="relative z-10 flex items-center gap-1.5">
			{icon != null &&
				(typeof icon === "string" ? (
					<span className={cn(icon, "h-3.5 w-3.5 shrink-0", active ? "text-primary" : "opacity-70")} />
				) : (
					<span
						className={cn(
							"flex h-3.5 w-3.5 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full",
							active ? "text-primary" : "opacity-70",
						)}
					>
						{icon}
					</span>
				))}
			{label}
			{badge && badge > 0 ? (
				<span className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold leading-none text-white">
					{badge > 99 ? "99+" : badge}
				</span>
			) : null}
		</span>
	);
}

/**
 * 浏览器/文件夹式选项卡：页签悬浮在内容卡片上方。相邻页签以负边距互相重叠、靠
 * z-index 分层，形成卡片堆叠的层次感（越靠近激活页签层级越高，向激活页签汇聚叠
 * 压）。激活页签层级最高、圆角凸起、底色与卡片一致并向下延伸 1px 盖住卡片描边，
 * 与卡片无缝融合并带顶部投影抬升；非激活页签为下沉的半透明圆角块、带细描边。
 *
 * 须与带 1px `border-border` 边框的内容卡片紧贴配套使用（见 ActivityPanel），
 * 激活页签的左/右/上边框会与卡片边框接成一条连续轮廓。
 *
 * 传入 onOverflowChange 时开启响应式收纳：按可用宽度容纳尽量多的页签，放不下的
 * 通过回调交给父级收进"下拉"菜单；宽度变化（拉伸/收窄）自动增减可见数量。
 */
export function TabBar<T extends string>({
	items,
	value,
	onChange,
	className,
	suppressLayoutAnimation = false,
	onRemove,
	onReorder,
	onOverflowChange,
	onContextMenu,
}: TabBarProps<T>): JSX.Element {
	const layoutId = useId();
	// 拖拽中：dragKey 为被拖动的页签，order 为拖拽过程中的临时顺序（提交前不触碰 props）
	const [dragKey, setDragKey] = useState<T | null>(null);
	const [order, setOrder] = useState<T[] | null>(null);
	// 悬浮页签：减号按钮的显隐走 state 而非 CSS group-hover（group-hover 依赖的类链在部分
	// 环境下未生效，导致按钮永不出现），同时用于把该页签 z-index 提到最高防被相邻页签盖住。
	const [hoverKey, setHoverKey] = useState<T | null>(null);

	// 拖拽中按临时顺序渲染，否则按 props 顺序
	const renderItems =
		order != null
			? order.map((k) => items.find((it) => it.key === k)).filter((it): it is TabBarItem<T> => it != null)
			: items;

	const dragging = dragKey != null;
	const beginDrag = (key: T) => {
		setDragKey(key);
		setOrder(items.map((it) => it.key));
	};
	const dragOver = (overKey: T) => {
		if (dragKey == null || dragKey === overKey) return;
		setOrder((prev) => (prev == null ? prev : moveKey(prev, dragKey, overKey)));
	};
	const endDrag = () => {
		if (order != null && onReorder != null) {
			const changed = order.some((k, i) => k !== items[i]?.key);
			if (changed) onReorder(order);
		}
		setDragKey(null);
		setOrder(null);
	};

	// 响应式收纳：用隐藏测量层量出每个页签自然宽度，按可用宽度贪心算出溢出 key。
	const rowRef = useRef<HTMLDivElement>(null);
	const measureRef = useRef<HTMLDivElement>(null);
	const rafRef = useRef<number | undefined>(undefined);
	const [overflowKeys, setOverflowKeys] = useState<T[]>([]);
	const responsive = onOverflowChange != null;

	const recompute = useCallback(() => {
		const row = rowRef.current;
		const mz = measureRef.current;
		if (!row || !mz) return;
		const avail = row.clientWidth - ROW_PADDING_X * 2;
		const widths = new Map<string, number>();
		for (const c of Array.from(mz.children) as HTMLElement[]) {
			const k = c.dataset.tabkey;
			if (k != null) widths.set(k, c.offsetWidth);
		}
		const widthOf = (key: T) => widths.get(key) ?? 0;
		const next = computeOverflow(renderItems, value, avail, widthOf);
		setOverflowKeys((prev) => (sameKeys(prev, next) ? prev : next));
	}, [renderItems, value]);

	useEffect(() => {
		if (!responsive) return;
		recompute();
		const row = rowRef.current;
		if (!row) return;
		const ro = new ResizeObserver(() => {
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
			rafRef.current = requestAnimationFrame(recompute);
		});
		ro.observe(row);
		return () => {
			ro.disconnect();
			if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
		};
	}, [responsive, recompute]);

	useEffect(() => {
		onOverflowChange?.(overflowKeys);
	}, [overflowKeys, onOverflowChange]);

	const overflowSet = responsive ? new Set(overflowKeys) : null;
	const visibleItems = overflowSet ? renderItems.filter((it) => !overflowSet.has(it.key)) : renderItems;
	const activeIndex = visibleItems.findIndex((item) => item.key === value);

	return (
		<div className={cn("group/tabbar relative z-10 min-w-0", className)}>
			<div ref={rowRef} className="flex items-end overflow-visible px-3">
				{visibleItems.map(({ key, label, icon, badge, removable }, index) => {
					const active = value === key;
					const isDragged = dragKey === key;
					// 激活页签置顶；非激活页签越靠近激活页签层级越高，向激活页签方向叠压
					// 悬浮页签置于最顶，保证右上角减号按钮不被相邻页签（重叠 -ml-2）盖住
					const zIndex =
						hoverKey === key
							? visibleItems.length + 2
							: active
								? visibleItems.length + 1
								: visibleItems.length - Math.abs(index - activeIndex);
					// 用普通 div：拖拽走原生 HTML5 draggable，不需要 framer。激活态切换会改变页签
					// 高度(29↔23)，任何 framer layout 动画都会用 scale 变换拉伸带边框的盒子致边框闪
					// 一下——所以这里不挂 framer，切换即时无动画。
					return (
						<div
							key={key}
							style={{ zIndex }}
							draggable={onReorder != null}
							onContextMenu={(e) => {
								if (!onContextMenu) return;
								e.preventDefault();
								onContextMenu(e, key);
							}}
							onDragStart={() => beginDrag(key)}
							onDragEnter={() => dragOver(key)}
							onDragOver={(e) => {
								if (dragging) e.preventDefault();
							}}
							onDragEnd={endDrag}
							onMouseEnter={() => setHoverKey(key)}
							onMouseLeave={() => setHoverKey((prev) => (prev === key ? null : prev))}
							onDrop={(e) => {
								if (dragging) e.preventDefault();
							}}
							className={cn("group/tab relative", index > 0 && "-ml-2", isDragged && "opacity-50")}
						>
							<button
								type="button"
								onClick={() => onChange(key)}
								// 边框色用 inline style 钉死：非激活页签的 `border-border/70` 若走 class，
								// 在「变非激活、刚获得边框」那一帧会回退到 currentColor(=foreground) 闪出前景色
								// （浅黑/深白）。inline 优先级最高，杜绝回退。激活态无 border 宽度，不受影响。
								style={{ borderColor: "color-mix(in oklab, var(--border) 70%, transparent)" }}
								className={cn(
									"relative flex w-full select-none items-center gap-1.5 whitespace-nowrap rounded-t-lg text-[11px] font-medium leading-none",
									onReorder != null && "cursor-grab active:cursor-grabbing",
									active
										? "h-[29px] px-4 text-foreground"
										: "h-[23px] border border-b-0 bg-muted px-4 text-muted-foreground hover:brightness-110 hover:text-foreground/80 dark:bg-secondary",
								)}
							>
								{active && (
									// 激活指示器：用 layoutId 共享布局在页签间平滑滑动。borderColor 仍 inline 钉死
									// 防 v4 currentColor 回退（闪烁根因是边框色、与此动画无关，已修复）。
									<motion.span
										layoutId={`tabbar-active-${layoutId}`}
										style={{ borderColor: "var(--border)" }}
										className="absolute inset-x-0 top-0 -bottom-px rounded-t-lg border border-b-0 bg-muted shadow-[0_-2px_6px_rgba(0,0,0,0.08)]"
										transition={
											suppressLayoutAnimation
												? { duration: 0 }
												: { type: "spring", stiffness: 480, damping: 36, mass: 0.8 }
										}
									/>
								)}
								<TabInner icon={icon} label={label} badge={badge} active={active} />
							</button>
							{removable && onRemove != null && hoverKey === key && !dragging && (
								<span
									role="button"
									title="隐藏此面板"
									aria-label="隐藏此面板"
									onMouseDown={(e) => e.stopPropagation()}
									onClick={(e) => {
										e.stopPropagation();
										onRemove(key);
									}}
									className="absolute -right-1 -top-1 z-20 flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full bg-muted-foreground/85 text-background shadow-sm hover:bg-foreground"
								>
									<span className="icon-[mdi--minus] h-2.5 w-2.5" />
								</span>
							)}
						</div>
					);
				})}
			</div>

			{/* 隐藏测量层：渲染全部页签（非激活样式）量自然宽度，供 recompute 计算容纳数量。 */}
			{responsive && (
				<div
					ref={measureRef}
					aria-hidden
					className="pointer-events-none absolute left-0 top-0 flex items-end opacity-0"
				>
					{renderItems.map(({ key, label, icon, badge }) => (
						<div
							key={key}
							data-tabkey={key}
							className="flex h-[23px] select-none items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-b-0 px-4 text-[11px] font-medium leading-none"
						>
							<TabInner icon={icon} label={label} badge={badge} active={false} />
						</div>
					))}
				</div>
			)}
		</div>
	);
}
