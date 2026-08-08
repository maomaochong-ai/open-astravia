import { motion } from "motion/react";
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type JSX,
	type DragEvent as ReactDragEvent,
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
	/** 为 true 时显示关闭按钮，点击触发 onRemove（文件等固定 tab 不可移除） */
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
	/** 点击页签关闭按钮时触发；未传则不渲染关闭按钮。 */
	onRemove?: (key: T) => void;
	/** 关闭按钮的本地化名称；传入 onRemove 时必须同时传入。 */
	removeLabel?: string;
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
	/** 文件拖拽悬停到非激活页签时切换页签，供内容区接管后续 drop。 */
	activateOnFileDragHover?: boolean;
}

/** 页签条左右内边距（px-3 = 0.75rem）。 */
const ROW_PADDING_X = 12;
const FILE_DRAG_HOVER_DELAY_MS = 300;

function isFileDrag(event: ReactDragEvent<HTMLElement>): boolean {
	const types = Array.from(event.dataTransfer.types);
	return types.includes("Files") || types.includes("application/vetta-path");
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
		used += widthOf(key);
		visible.add(key);
	};
	if (items.some((it) => it.key === activeKey)) take(activeKey);
	for (const it of items) {
		if (visible.has(it.key)) continue;
		const add = widthOf(it.key);
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
		<span className="relative z-10 flex min-w-0 flex-1 items-center gap-1.5">
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
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{badge && badge > 0 ? (
				<span className="inline-flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold leading-none text-primary">
					{badge > 99 ? "99+" : badge}
				</span>
			) : null}
		</span>
	);
}

/**
 * 浏览器式选项卡：所有页签保持等高、互不覆盖。激活页签与内容卡片同色并向下延伸
 * 1px 盖住卡片描边；非激活页签仅在 hover 时显示浅背景，避免切换时产生尺寸跳动。
 *
 * 须与带 1px `border-border` 边框的内容卡片紧贴配套使用（见 ActivityPanel），
 * 激活页签的顶部、侧边和两侧凹形连接角共同延续卡片边框，内部保持同色。
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
	removeLabel,
	onReorder,
	listRef,
	onTabDragStart,
	onTabDragMove,
	onTabDragEnd,
	onOverflowChange,
	activateOnFileDragHover = false,
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
	const fileDragHoverRef = useRef<{ key: T; timer: number } | null>(null);
	const fileDragHoverKeyRef = useRef<T | null>(null);
	const [fileDragHoverKey, setFileDragHoverKey] = useState<T | null>(null);

	const clearFileDragHover = useCallback((key?: T): void => {
		if (key != null && fileDragHoverKeyRef.current !== key) return;
		const pending = fileDragHoverRef.current;
		if (pending) window.clearTimeout(pending.timer);
		fileDragHoverRef.current = null;
		fileDragHoverKeyRef.current = null;
		setFileDragHoverKey(null);
	}, []);

	const onFileDragEnter = useCallback(
		(event: ReactDragEvent<HTMLDivElement>, key: T): void => {
			if (!activateOnFileDragHover || !isFileDrag(event)) return;
			if (fileDragHoverKeyRef.current !== key) {
				clearFileDragHover();
				fileDragHoverKeyRef.current = key;
				setFileDragHoverKey(key);
			}
			if (key === value || fileDragHoverRef.current?.key === key) return;
			const timer = window.setTimeout(() => {
				fileDragHoverRef.current = null;
				onChange(key);
			}, FILE_DRAG_HOVER_DELAY_MS);
			fileDragHoverRef.current = { key, timer };
		},
		[activateOnFileDragHover, clearFileDragHover, onChange, value],
	);

	const onFileDragLeave = useCallback(
		(event: ReactDragEvent<HTMLDivElement>, key: T): void => {
			const nextTarget = event.relatedTarget;
			if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
			clearFileDragHover(key);
		},
		[clearFileDragHover],
	);

	const onFileDragOver = useCallback(
		(event: ReactDragEvent<HTMLDivElement>): void => {
			if (!activateOnFileDragHover || !isFileDrag(event)) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
		},
		[activateOnFileDragHover],
	);

	const onFileDrop = useCallback(
		(event: ReactDragEvent<HTMLDivElement>, key: T): void => {
			if (!activateOnFileDragHover || !isFileDrag(event)) return;
			event.preventDefault();
			clearFileDragHover(key);
			if (key !== value) onChange(key);
		},
		[activateOnFileDragHover, clearFileDragHover, onChange, value],
	);

	// 拖拽中按临时顺序渲染，否则按 props 顺序
	const renderItems =
		order != null
			? order.map((k) => items.find((it) => it.key === k)).filter((it): it is TabBarItem<T> => it != null)
			: items;

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
			clearFileDragHover();
			const session = pointerSessionRef.current;
			pointerSessionRef.current = null;
			session?.cleanupGlobalCapture?.();
		},
		[clearFileDragHover],
	);

	const overflowSet = responsive ? new Set(overflowKeys) : null;
	const visibleItems = overflowSet ? renderItems.filter((it) => !overflowSet.has(it.key)) : renderItems;
	return (
		<div className={cn("group/tabbar relative z-10 min-w-0", className)}>
			<div ref={setRowRef} role="tablist" className="flex h-8 items-end overflow-visible px-3">
				{visibleItems.map(({ key, label, icon, badge, removable }, index) => {
					const active = value === key;
					const isDragged = dragKey === key;
					const fileDragHovered = fileDragHoverKey === key;
					const canRemove = removable && onRemove != null && removeLabel != null;
					const nextItem = visibleItems[index + 1];
					const showSeparator =
						!active &&
						nextItem != null &&
						nextItem.key !== value &&
						!fileDragHovered &&
						fileDragHoverKey !== nextItem.key;
					return (
						<div
							key={key}
							data-tabkey={key}
							data-file-drag-hover={fileDragHovered ? "" : undefined}
							onPointerDown={(event) => onTabPointerDown(event, key)}
							onPointerMove={onTabPointerMove}
							onPointerUp={(event) => finishPointerDrag(event.clientX, event.clientY, false)}
							onPointerCancel={(event) => finishPointerDrag(event.clientX, event.clientY, true)}
							onDragEnter={(event) => onFileDragEnter(event, key)}
							onDragLeave={(event) => onFileDragLeave(event, key)}
							onDragOver={onFileDragOver}
							onDrop={(event) => onFileDrop(event, key)}
							className={cn(
								"group/tab relative min-w-[72px] max-w-[160px] shrink-0 touch-none",
								active ? "z-10" : "z-0",
								isDragged && "opacity-60",
							)}
						>
							<button
								type="button"
								role="tab"
								aria-selected={active}
								onClick={(event) => {
									if (suppressClickRef.current === key) {
										suppressClickRef.current = null;
										event.preventDefault();
										return;
									}
									onChange(key);
								}}
								className={cn(
									"relative flex h-8 w-full select-none items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-b-0 border-transparent pl-3 text-[11px] font-medium leading-none transition-colors",
									canRemove ? "pr-7" : "pr-3",
									isDragged ? "cursor-grabbing" : "cursor-pointer",
									active ? "text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
									fileDragHovered && !active && "border-primary/50 bg-primary/10 text-foreground",
									fileDragHovered && active && "text-primary",
								)}
							>
								{active && (
									<motion.span
										layoutId={`tabbar-active-${layoutId}`}
										aria-hidden
										className="pointer-events-none absolute inset-x-0 top-0 -bottom-px rounded-t-lg border border-b-0 border-border bg-muted"
										data-active-tab-indicator
										transition={
											suppressLayoutAnimation
												? { duration: 0 }
												: { type: "spring", stiffness: 480, damping: 36, mass: 0.8 }
										}
									>
										<span className="absolute bottom-0 left-0 h-2 w-px bg-muted" />
										<svg
											viewBox="0 0 9 9"
											className="absolute -left-2 -bottom-px h-[9px] w-[9px] fill-muted stroke-border"
											data-tab-join-curve="left"
										>
											<path d="M0 9 C5 9 9 5 9 0 L9 9 Z" stroke="none" />
											<path d="M0 8.5 C4.7 8.5 8.5 4.7 8.5 0" fill="none" />
										</svg>
										<span className="absolute bottom-0 right-0 h-2 w-px bg-muted" />
										<svg
											viewBox="0 0 9 9"
											className="absolute -right-2 -bottom-px h-[9px] w-[9px] fill-muted stroke-border"
											data-tab-join-curve="right"
										>
											<path d="M0 0 C0 5 4 9 9 9 H0 Z" stroke="none" />
											<path d="M0.5 0 C0.5 4.7 4.3 8.5 9 8.5" fill="none" />
										</svg>
									</motion.span>
								)}
								<TabInner icon={icon} label={label} badge={badge} active={active} />
							</button>
							{showSeparator && (
								<span
									aria-hidden
									className="pointer-events-none absolute right-0 top-1/2 z-10 h-3.5 w-px -translate-y-1/2 bg-border/60"
								/>
							)}
							{canRemove && (
								<button
									type="button"
									title={removeLabel}
									aria-label={`${removeLabel}: ${label}`}
									onPointerDown={(e) => e.stopPropagation()}
									onClick={(e) => {
										e.stopPropagation();
										onRemove(key);
									}}
									className="absolute right-1 top-1/2 z-20 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
								>
									<span className="icon-[mdi--close] h-3.5 w-3.5" />
								</button>
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
					{renderItems.map(({ key, label, icon, badge, removable }) => (
						<div
							key={key}
							data-tabkey={key}
							className={cn(
								"flex h-8 min-w-[72px] max-w-[160px] select-none items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-b-0 pl-3 text-[11px] font-medium leading-none",
								removable && onRemove != null && removeLabel != null ? "pr-7" : "pr-3",
							)}
						>
							<TabInner icon={icon} label={label} badge={badge} active={false} />
						</div>
					))}
				</div>
			)}
		</div>
	);
}
