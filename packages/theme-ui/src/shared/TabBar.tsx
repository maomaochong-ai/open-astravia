import { motion } from "motion/react";
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type JSX,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	type RefObject,
} from "react";
import { hasReachedTabDragDistance, moveTabKey } from "./tab-drag";

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

export interface TabBarDragBounds {
	bottom: number;
	height: number;
	left: number;
	right: number;
	top: number;
	width: number;
}

export interface TabBarDragEvent<T extends string> {
	bounds: TabBarDragBounds;
	cancelled: boolean;
	key: T;
	point: { x: number; y: number };
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
	/** 宿主读取真实 tab 列表边界，用于把浮动 tab 拖回栏内。 */
	listRef?: RefObject<HTMLDivElement | null>;
	/** 页签指针拖拽生命周期；宿主可在拖出栏后接管为面板移动。 */
	onTabDragStart?: (event: TabBarDragEvent<T>) => void;
	onTabDragMove?: (event: TabBarDragEvent<T>) => void;
	onTabDragEnd?: (event: TabBarDragEvent<T>) => boolean | undefined;
	/**
	 * 响应式溢出回调：按当前宽度容纳不下、被收纳起来的页签 key 列表（保持原顺序）。
	 * 由父级渲染到"下拉"菜单里。传了此回调即开启响应式收纳。
	 */
	onOverflowChange?: (overflowKeys: T[]) => void;
}

/** 页签条左右内边距（px-3 = 0.75rem）。 */
const ROW_PADDING_X = 12;
/** 相邻页签的负边距重叠量（-ml-2 = 0.5rem），计算容纳宽度时需扣除。 */
const TAB_OVERLAP = 8;

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
	listRef,
	onTabDragStart,
	onTabDragMove,
	onTabDragEnd,
	onOverflowChange,
}: TabBarProps<T>): JSX.Element {
	const layoutId = useId();
	// 拖拽中：dragKey 为被拖动的页签，order 为拖拽过程中的临时顺序（提交前不触碰 props）
	const [dragKey, setDragKey] = useState<T | null>(null);
	const [order, setOrder] = useState<T[] | null>(null);
	const dragKeyRef = useRef<T | null>(null);
	const orderRef = useRef<T[] | null>(null);
	const pointerSessionRef = useRef<{
		bounds: TabBarDragBounds;
		cleanupGlobalCapture: (() => void) | null;
		clientX: number;
		clientY: number;
		key: T;
		pointerId: number;
		startX: number;
		startY: number;
		started: boolean;
	} | null>(null);
	const suppressClickRef = useRef<T | null>(null);
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
		dragKeyRef.current = key;
		setDragKey(key);
		const nextOrder = items.map((it) => it.key);
		orderRef.current = nextOrder;
		setOrder(nextOrder);
	};
	const dragOver = (overKey: T) => {
		const currentDragKey = dragKeyRef.current;
		const currentOrder = orderRef.current;
		if (currentDragKey == null || currentOrder == null || currentDragKey === overKey) return;
		const nextOrder = moveTabKey(currentOrder, currentDragKey, overKey);
		orderRef.current = nextOrder;
		setOrder(nextOrder);
	};
	const endDrag = (commit: boolean) => {
		const finalOrder = orderRef.current;
		if (commit && finalOrder != null && onReorder != null) {
			const changed = finalOrder.some((k, i) => k !== items[i]?.key);
			if (changed) onReorder(finalOrder);
		}
		dragKeyRef.current = null;
		orderRef.current = null;
		setDragKey(null);
		setOrder(null);
	};

	const dragEvent = (
		session: NonNullable<typeof pointerSessionRef.current>,
		clientX: number,
		clientY: number,
		cancelled = false,
	): TabBarDragEvent<T> => ({
		bounds: session.bounds,
		cancelled,
		key: session.key,
		point: { x: clientX, y: clientY },
	});

	const findOverKey = (clientX: number, clientY: number): T | null => {
		const row = rowRef.current;
		const session = pointerSessionRef.current;
		if (!row || !session || clientY < session.bounds.top - 16 || clientY > session.bounds.bottom + 16) {
			return null;
		}
		let closest: { distance: number; key: T } | null = null;
		for (const child of Array.from(row.children) as HTMLElement[]) {
			const key = child.dataset.tabkey as T | undefined;
			if (!key) continue;
			const bounds = child.getBoundingClientRect();
			const distance = Math.abs(clientX - (bounds.left + bounds.right) / 2);
			if (!closest || distance < closest.distance) closest = { distance, key };
		}
		return closest?.key ?? null;
	};

	const finishPointerDrag = (clientX: number, clientY: number, cancelled: boolean): void => {
		const session = pointerSessionRef.current;
		if (!session) return;
		pointerSessionRef.current = null;
		session.cleanupGlobalCapture?.();
		if (session.started) {
			const shouldCommit = onTabDragEnd?.(dragEvent(session, clientX, clientY, cancelled)) !== false;
			endDrag(!cancelled && shouldCommit);
			setTimeout(() => {
				if (suppressClickRef.current === session.key) suppressClickRef.current = null;
			}, 0);
		}
	};

	const continuePointerDrag = (clientX: number, clientY: number): void => {
		const session = pointerSessionRef.current;
		if (!session) return;
		session.clientX = clientX;
		session.clientY = clientY;
		const overKey = findOverKey(clientX, clientY);
		if (overKey) dragOver(overKey);
		onTabDragMove?.(dragEvent(session, clientX, clientY));
	};

	const startGlobalCapture = (session: NonNullable<typeof pointerSessionRef.current>): void => {
		if (session.cleanupGlobalCapture) return;
		const overlay = document.createElement("div");
		overlay.dataset.tabDragOverlay = "";
		overlay.style.position = "fixed";
		overlay.style.inset = "0";
		overlay.style.zIndex = "9999";
		overlay.style.cursor = "grabbing";
		overlay.style.touchAction = "none";
		const previousUserSelect = document.body.style.userSelect;

		const onPointerMove = (event: PointerEvent): void => {
			if (event.pointerId !== session.pointerId) return;
			event.preventDefault();
			continuePointerDrag(event.clientX, event.clientY);
		};
		const onPointerUp = (event: PointerEvent): void => {
			if (event.pointerId !== session.pointerId) return;
			finishPointerDrag(event.clientX, event.clientY, false);
		};
		const onPointerCancel = (event: PointerEvent): void => {
			if (event.pointerId !== session.pointerId) return;
			finishPointerDrag(event.clientX, event.clientY, true);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") finishPointerDrag(session.clientX, session.clientY, true);
		};
		const onWindowBlur = (): void => finishPointerDrag(session.clientX, session.clientY, true);
		const cleanup = (): void => {
			overlay.removeEventListener("pointermove", onPointerMove);
			overlay.removeEventListener("pointerup", onPointerUp);
			overlay.removeEventListener("pointercancel", onPointerCancel);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("blur", onWindowBlur);
			overlay.remove();
			document.body.style.userSelect = previousUserSelect;
			session.cleanupGlobalCapture = null;
		};

		overlay.addEventListener("pointermove", onPointerMove);
		overlay.addEventListener("pointerup", onPointerUp);
		overlay.addEventListener("pointercancel", onPointerCancel);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("blur", onWindowBlur);
		document.body.appendChild(overlay);
		document.body.style.userSelect = "none";
		session.cleanupGlobalCapture = cleanup;
	};

	const onTabPointerDown = (event: ReactPointerEvent<HTMLDivElement>, key: T): void => {
		if (
			event.button !== 0 ||
			(onReorder == null && onTabDragStart == null && onTabDragMove == null && onTabDragEnd == null)
		) {
			return;
		}
		const row = rowRef.current;
		if (!row) return;
		const bounds = row.getBoundingClientRect();
		pointerSessionRef.current = {
			bounds: {
				bottom: bounds.bottom,
				height: bounds.height,
				left: bounds.left,
				right: bounds.right,
				top: bounds.top,
				width: bounds.width,
			},
			cleanupGlobalCapture: null,
			clientX: event.clientX,
			clientY: event.clientY,
			key,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			started: false,
		};
	};

	const onTabPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const session = pointerSessionRef.current;
		if (!session || session.pointerId !== event.pointerId) return;
		if (
			!session.started &&
			!hasReachedTabDragDistance(event.clientX - session.startX, event.clientY - session.startY)
		) {
			return;
		}
		if (!session.started) {
			session.started = true;
			suppressClickRef.current = session.key;
			beginDrag(session.key);
			onTabDragStart?.(dragEvent(session, event.clientX, event.clientY));
			startGlobalCapture(session);
		}
		event.preventDefault();
		continuePointerDrag(event.clientX, event.clientY);
	};

	// 响应式收纳：用隐藏测量层量出每个页签自然宽度，按可用宽度贪心算出溢出 key。
	const rowRef = useRef<HTMLDivElement>(null);
	const setRowRef = useCallback(
		(node: HTMLDivElement | null): void => {
			rowRef.current = node;
			if (listRef) listRef.current = node;
		},
		[listRef],
	);
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

	useEffect(
		() => () => {
			const session = pointerSessionRef.current;
			pointerSessionRef.current = null;
			session?.cleanupGlobalCapture?.();
		},
		[],
	);

	const overflowSet = responsive ? new Set(overflowKeys) : null;
	const visibleItems = overflowSet ? renderItems.filter((it) => !overflowSet.has(it.key)) : renderItems;
	const activeIndex = visibleItems.findIndex((item) => item.key === value);

	return (
		<div className={cn("group/tabbar relative z-10 min-w-0", className)}>
			<div ref={setRowRef} className="flex min-h-[29px] items-end overflow-visible px-3">
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
					// 用普通 div：指针拖拽不需要 framer。激活态切换会改变页签
					// 高度(29↔23)，任何 framer layout 动画都会用 scale 变换拉伸带边框的盒子致边框闪
					// 一下——所以这里不挂 framer，切换即时无动画。
					return (
						<div
							key={key}
							data-tabkey={key}
							style={{ zIndex }}
							onPointerDown={(event) => onTabPointerDown(event, key)}
							onPointerMove={onTabPointerMove}
							onPointerUp={(event) => finishPointerDrag(event.clientX, event.clientY, false)}
							onPointerCancel={(event) => finishPointerDrag(event.clientX, event.clientY, true)}
							onMouseEnter={() => setHoverKey(key)}
							onMouseLeave={() => setHoverKey((prev) => (prev === key ? null : prev))}
							className={cn(
								"group/tab relative touch-none",
								index > 0 && "-ml-2",
								isDragged && "opacity-50",
							)}
						>
							<button
								type="button"
								onClick={(event) => {
									if (suppressClickRef.current === key) {
										suppressClickRef.current = null;
										event.preventDefault();
										return;
									}
									onChange(key);
								}}
								// 边框色用 inline style 钉死：非激活页签的 `border-border/70` 若走 class，
								// 在「变非激活、刚获得边框」那一帧会回退到 currentColor(=foreground) 闪出前景色
								// （浅黑/深白）。inline 优先级最高，杜绝回退。激活态无 border 宽度，不受影响。
								style={{ borderColor: "color-mix(in oklab, var(--border) 70%, transparent)" }}
								className={cn(
									"relative flex w-full select-none items-center gap-1.5 whitespace-nowrap rounded-t-lg text-[11px] font-medium leading-none",
								(onReorder != null || onTabDragStart != null) &&
									"cursor-grab active:cursor-grabbing",
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
									onPointerDown={(e) => e.stopPropagation()}
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
