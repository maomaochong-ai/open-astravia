import { motion, useReducedMotion } from "motion/react";
import {
	type ComponentProps,
	type DragEvent,
	Fragment,
	type JSX,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@astravia-org/ui";
import { ButtonGroup, ButtonGroupItem } from "@astravia-org/ui/button-group";
import { SessionTopItem, type SessionTopMenuItem } from "@astravia-org/ui/session-top-item";
import { cn } from "@astravia-org/ui/utils";
import { useHeaderCrowded } from "../app-shell/header-crowding";
import { partitionHeaderActionsForNarrow } from "./header-action-narrow";
import { HeaderActionOverflowMenu } from "./HeaderActionOverflowMenu";

/**
 * 会话页顶栏右侧的「统一按钮组」：内置按钮与插件动作按同一套数据渲染，外观完全由宿主决定。
 *
 * 顶栏只显示 `top`；`tray` 里的收进托盘（悬浮在按钮组上时，组下方出现的小白条，点开即是）。
 * 页头左右两簇挤在一起时（会话窗口极窄），除了 `retainWhenNarrow` 的项和活动面板开关，
 * 其余动作收进一个「更多」下拉菜单，避免两侧按钮撞在一起。
 * 托盘打开期间进入「编辑」状态：
 * - 托盘里只放没上栏的图标（无文字，名称在悬浮提示里），点一下直接使用；
 * - 把托盘里的图标拖进按钮组就上栏，把按钮组里的按钮拖进托盘就收纳，组内也能拖动换序；
 * - 按钮组里还没被占用的席位用虚线方框表示（总数由 `maxTop` 决定）；
 * - 每个图标左上角有 + / − 角标按钮，是不方便拖动时的备选。
 * 本组件只管渲染与交互，布局怎么算、怎么存都在调用方。
 */

export interface HeaderActionPopoverApi {
	readonly close: () => void;
}

export type HeaderActionBehavior =
	| { readonly type: "click"; readonly onClick: () => void }
	| { readonly type: "menu"; readonly items: readonly SessionTopMenuItem[] }
	| { readonly type: "popover"; readonly render: (api: HeaderActionPopoverApi) => ReactNode };

export interface HeaderActionBarItem {
	/** 全局唯一：内置为 `builtin:<name>`，插件为 `<pluginId>:<actionId>`。 */
	readonly key: string;
	readonly title: string;
	readonly icon: ReactNode;
	readonly badge?: number | true;
	readonly active?: boolean;
	readonly disabled?: boolean;
	readonly behavior: HeaderActionBehavior;
	/**
	 * 处于选中态时，即使被收纳也要在活动面板开关左侧露出一个按钮（如「窗口置顶」：开着却看不到入口很奇怪）。
	 * 仅宿主内置动作使用，插件声明里没有这个字段。
	 */
	readonly promoteWhenActive?: boolean;
	/**
	 * 页头被挤窄、其余动作收进下拉菜单时，这一项仍留在活动面板开关旁边。
	 * 仅宿主内置动作使用（窗口置顶）。
	 */
	readonly retainWhenNarrow?: boolean;
}

export type HeaderActionZone = "top" | "tray";

export interface HeaderActionBarLabels {
	/** 小白条的无障碍名称（兼悬浮提示）。 */
	readonly customize: string;
	/** 「放到顶栏」角标按钮的提示。 */
	readonly moveToTop: string;
	/** 顶栏已满时「放到顶栏」按钮的提示。 */
	readonly topFull: string;
	/** 「收纳」角标按钮的提示。 */
	readonly moveToTray: string;
	/** 收纳末尾「调整」按钮的提示（点了进入拖拽调整）。 */
	readonly adjust: string;
	/** 调整状态下该按钮的提示（点了退出调整）。 */
	readonly done: string;
	/** 页头挤窄时，把其余动作收进去的那个下拉按钮的名称。 */
	readonly more: string;
}

export interface HeaderActionBarViewProps {
	readonly top: readonly HeaderActionBarItem[];
	readonly tray: readonly HeaderActionBarItem[];
	/** 固定在组最右、不参与排序与收纳的那一格（活动面板开关）。 */
	readonly pinned?: ReactNode;
	readonly maxTop: number;
	readonly labels: HeaderActionBarLabels;
	/** `index` 是目标区里的插入位置（拖动时按「拖动前」的列表计，由调用方负责修正同区移动）。 */
	readonly onMove: (key: string, zone: HeaderActionZone, index: number) => void;
	/**
	 * 顶栏左右两侧已经挤在一起。为 true 时收进下拉菜单；不传则跟随页头自己的测量。
	 */
	readonly crowded?: boolean;
}

/**
 * 收纳与「调整」按钮的底：不透明底色 + 与按钮组同样的玻璃色叠加。
 * 它们会盖在活动面板、消息流这类有内容的区域上，按钮组那种纯半透明底会把下面的文字和图标透出来。
 */
const OPAQUE_GLASS =
	"bg-background dark:bg-background bg-[image:linear-gradient(color-mix(in_srgb,var(--foreground)_6%,transparent),color-mix(in_srgb,var(--foreground)_6%,transparent))] dark:bg-[image:linear-gradient(rgb(255_255_255/0.08),rgb(255_255_255/0.08))]";

/**
 * 图标统一放进固定方框：插件传来的图标大小各异，不能撑开按钮，也不接收指针事件。
 * `jiggle` 不为空时图标像 iOS 编辑主屏幕那样循环轻微抖动；数值用来错开各图标的节奏，免得齐刷刷同步。
 */
function IconBox({ children, jiggle }: { readonly children: ReactNode; readonly jiggle?: number }): JSX.Element {
	const reduceMotion = useReducedMotion();
	const className =
		"pointer-events-none flex size-4 shrink-0 items-center justify-center overflow-hidden text-[14px] [&>*]:max-h-4 [&>*]:max-w-4";
	if (jiggle === undefined || reduceMotion) return <span className={className}>{children}</span>;
	const swing = jiggle % 2 === 0 ? 2.5 : -2.5;
	return (
		<motion.span
			className={className}
			animate={{ rotate: [swing, -swing] }}
			transition={{
				duration: 0.13 + (jiggle % 3) * 0.015,
				delay: (jiggle % 4) * 0.03,
				repeat: Number.POSITIVE_INFINITY,
				repeatType: "mirror",
				ease: "easeInOut",
			}}
		>
			{children}
		</motion.span>
	);
}

function BarItem({
	item,
	dragProps,
	className,
	jiggle,
	onStow,
	stowLabel,
}: {
	readonly item: HeaderActionBarItem;
	/** 调整状态下右上角「−」：收进收纳。 */
	readonly onStow?: () => void;
	readonly stowLabel?: string;
	/** 调整状态下传入：按钮只剩拖动，不再触发功能，图标抖动。 */
	readonly jiggle?: number;
	readonly dragProps?: Pick<ComponentProps<"button">, "draggable" | "onDragStart" | "onDragEnd" | "onDragOver" | "onDrop">;
	readonly className?: string;
}): JSX.Element {
	const common = {
		title: item.title,
		"aria-label": item.title,
		icon: <IconBox jiggle={jiggle}>{item.icon}</IconBox>,
		badge: item.badge,
		active: item.active,
		disabled: item.disabled,
		className,
		...dragProps,
	};
	// 调整状态：只能拖动、排序，点击不触发任何功能（也不弹菜单 / 气泡）。
	if (jiggle !== undefined) {
		return (
			<ButtonGroupItem
				{...common}
				badge={undefined}
				icon={
					<>
						<IconBox jiggle={jiggle}>{item.icon}</IconBox>
						{/* 嵌在按钮里，用 span 而不是 button（button 不能嵌 button）；点它收纳，不会触发按钮本身。 */}
						<span
							role="button"
							tabIndex={-1}
							title={stowLabel}
							aria-label={`${stowLabel}: ${item.title}`}
							data-header-action-stow="true"
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								onStow?.();
							}}
							className="absolute -top-1 -right-1 z-10 flex size-3.5 items-center justify-center rounded-full bg-foreground/80 text-background"
						>
							<span className="icon-[solar--minus-linear] pointer-events-none size-2.5" />
						</span>
					</>
				}
			/>
		);
	}
	const { behavior } = item;
	if (behavior.type === "menu") return <SessionTopItem {...common} menuItems={behavior.items} />;
	if (behavior.type === "popover") {
		return <SessionTopItem {...common} popoverContent={(api) => behavior.render(api)} />;
	}
	return <SessionTopItem {...common} onClick={behavior.onClick} />;
}

interface DropTarget {
	readonly zone: HeaderActionZone;
	readonly index: number;
}

function TileBadge({ badge }: { readonly badge: HeaderActionBarItem["badge"] }): JSX.Element | null {
	if (badge === undefined) return null;
	if (badge === true) return <span className="absolute top-1 right-1 size-1.5 rounded-full bg-red-500" />;
	return (
		<span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] leading-none font-semibold text-white tabular-nums">
			{badge > 99 ? "99+" : badge}
		</span>
	);
}

/** 方块本体：只有图标，名称靠悬浮提示。点一下就使用。 */
function TileFace({
	item,
	onClick,
	jiggle,
}: {
	readonly item: HeaderActionBarItem;
	readonly onClick?: () => void;
	readonly jiggle?: number;
}): JSX.Element {
	return (
		<button
			type="button"
			title={item.title}
			aria-label={item.title}
			disabled={item.disabled}
			data-active={item.active || undefined}
			aria-pressed={item.active ? true : undefined}
			onClick={onClick}
			className="relative flex h-7 w-8 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground outline-none transition-colors hover:bg-foreground/[0.14] focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40 data-[active]:bg-foreground/[0.22]"
		>
			<IconBox jiggle={jiggle}>{item.icon}</IconBox>
			{jiggle === undefined && <TileBadge badge={item.badge} />}
		</button>
	);
}

function Tile({
	item,
	index,
	count,
	editing,
	drop,
	dragging,
	moveDisabled,
	moveLabel,
	onMoveClick,
	onDragStart,
	onDragEnd,
	onDragOverTile,
	onClose,
}: {
	readonly item: HeaderActionBarItem;
	readonly index: number;
	readonly count: number;
	/** 调整状态：此时图标可拖动、显示「+」角标；否则点击只是触发它自己的功能。 */
	readonly editing: boolean;
	readonly drop: DropTarget | null;
	readonly dragging: boolean;
	readonly moveDisabled: boolean;
	readonly moveLabel: string;
	readonly onMoveClick: () => void;
	readonly onDragStart: (event: DragEvent) => void;
	readonly onDragEnd: () => void;
	readonly onDragOverTile: (event: DragEvent, index: number) => void;
	readonly onClose: () => void;
}): JSX.Element {
	const showBefore = drop?.zone === "tray" && drop.index === index;
	const showAfter = drop?.zone === "tray" && drop.index === count && index === count - 1;
	const { behavior } = item;

	let face: ReactNode;
	if (editing) {
		// 调整状态：只能拖动，点了没有任何功能。
		face = <TileFace item={item} jiggle={index} />;
	} else if (behavior.type === "menu") {
		face = (
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<TileFaceTrigger item={item} />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="center" sideOffset={6} className="min-w-40">
					{behavior.items.map((entry) => (
						<Fragment key={entry.id}>
							{entry.separatorBefore ? <DropdownMenuSeparator /> : null}
							<DropdownMenuItem
								disabled={entry.disabled}
								onSelect={() => {
									entry.onSelect();
									onClose();
								}}
								className={entry.destructive ? "text-destructive focus:text-destructive" : undefined}
							>
								{entry.icon ? <IconBox>{entry.icon}</IconBox> : null}
								{entry.label}
							</DropdownMenuItem>
						</Fragment>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		);
	} else if (behavior.type === "popover") {
		face = (
			<Popover>
				<PopoverTrigger asChild>
					<TileFaceTrigger item={item} />
				</PopoverTrigger>
				<PopoverContent
					align="center"
					sideOffset={6}
					className="w-max max-h-[min(70vh,32rem)] max-w-[min(92vw,32rem)] overflow-auto"
				>
					{behavior.render({ close: onClose })}
				</PopoverContent>
			</Popover>
		);
	} else {
		face = (
			<TileFace
				item={item}
				onClick={() => {
					behavior.onClick();
					onClose();
				}}
			/>
		);
	}

	return (
		<li
			draggable={editing}
			title={item.title}
			data-header-action-tile={item.key}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			onDragOver={(event) => onDragOverTile(event, index)}
			className={cn(
				"group/tile relative",
				dragging && "opacity-40",
				showBefore && "before:absolute before:-left-1 before:inset-y-1 before:w-0.5 before:rounded-full before:bg-primary",
				showAfter && "after:absolute after:-right-1 after:inset-y-1 after:w-0.5 after:rounded-full after:bg-primary",
			)}
		>
			{face}
			{/* 调整状态下左上角「+」：放上顶栏，拖不动时的备选（也供键盘使用）。 */}
			{editing && (
				<button
					type="button"
					title={moveLabel}
					aria-label={`${moveLabel}: ${item.title}`}
					disabled={moveDisabled}
					onClick={onMoveClick}
					className="absolute -top-1 -right-1 z-10 flex size-3.5 items-center justify-center rounded-full bg-foreground/80 text-background outline-none disabled:hidden"
				>
					<span className="icon-[solar--add-linear] size-2.5" />
				</button>
			)}
		</li>
	);
}

/** 菜单 / 气泡的触发器：要把 Radix 传来的 ref 与事件落到方块的 button 上。 */
function TileFaceTrigger({ item, ...props }: { readonly item: HeaderActionBarItem } & ComponentProps<"button">): JSX.Element {
	return (
		<button
			type="button"
			title={item.title}
			aria-label={item.title}
			{...props}
			disabled={item.disabled}
			data-active={item.active || undefined}
			aria-pressed={item.active ? true : undefined}
			className="relative flex h-7 w-8 items-center justify-center rounded-full bg-foreground/[0.08] text-foreground outline-none transition-colors hover:bg-foreground/[0.14] focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-40 data-[active]:bg-foreground/[0.22] data-[state=open]:bg-foreground/[0.1]"
		>
			<IconBox>{item.icon}</IconBox>
			<TileBadge badge={item.badge} />
		</button>
	);
}

/**
 * 拖动时跟手的那张图：浏览器默认拿元素本身截图，会带上半透明的玻璃底和描边，看起来像一团光斑。
 * 这里换成只有图标的一个小圆片。
 */
function setGhost(event: DragEvent): void {
	const source = event.currentTarget as HTMLElement;
	const icon = source.querySelector("svg, [class*='icon-']");
	const ghost = document.createElement("div");
	ghost.style.cssText =
		"position:fixed;top:-100px;left:-100px;width:32px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:9999px;background:rgba(128,128,128,0.35);";
	ghost.style.color = getComputedStyle(source).color;
	if (icon) ghost.append(icon.cloneNode(true));
	document.body.append(ghost);
	event.dataTransfer.setDragImage(ghost, 16, 14);
	setTimeout(() => ghost.remove(), 0);
}

export function HeaderActionBarView({
	top,
	tray,
	pinned,
	maxTop,
	labels,
	onMove,
	crowded: crowdedProp,
}: HeaderActionBarViewProps): JSX.Element {
	const contextCrowded = useHeaderCrowded();
	const crowded = crowdedProp ?? contextCrowded;
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const [dragKey, setDragKey] = useState<string | null>(null);
	const [drop, setDrop] = useState<DropTarget | null>(null);

	// 挤窄后托盘的拖拽调整用不上，先收起来，避免和「更多」菜单叠在一起。
	useLayoutEffect(() => {
		if (!crowded) return;
		setOpen(false);
		setEditing(false);
		setDragKey(null);
		setDrop(null);
	}, [crowded]);

	const closeTray = (): void => {
		setOpen(false);
		setEditing(false);
		setDragKey(null);
		setDrop(null);
	};

	// 展开期间：点到别处或按 Esc 收起。菜单 / 气泡的浮层在 body 下，点它们不算「点了外面」。
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null;
			if (!target || rootRef.current?.contains(target)) return;
			if (target.closest("[data-radix-popper-content-wrapper], [role='menu']")) return;
			closeTray();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") closeTray();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]); // biome-ignore lint/correctness/useExhaustiveDependencies: closeTray 只用稳定的 setState

	const topFull = top.length >= maxTop;
	// 收纳里的角标不能被藏起来：汇总到小白条上（红色）。
	const trayAlert = tray.some((item) => item.badge !== undefined && item.badge !== 0);
	const draggingFromTop = dragKey !== null && top.some((item) => item.key === dragKey);
	// 托盘打开时显示空位；顶栏一个都没有时也留着，否则没有东西可以悬浮、点开托盘。
	const hasFreeSeat = editing && top.length < maxTop;
	// 顶栏一个都没有（全收纳了）：不留空胶囊也不出小白条；悬浮到面板开关或它左边那一块时，
	// 开关左侧浮出一个虚线加号胶囊，点它呼出收纳。调整状态下仍要有按钮组接收拖放，所以照常显示。
	const narrow = crowded ? partitionHeaderActionsForNarrow(top, tray) : null;
	const emptyBar = narrow === null && top.length === 0 && !editing;
	const promoted = narrow !== null || editing ? [] : tray.filter((item) => item.promoteWhenActive && item.active);
	const beside = narrow ? narrow.retained : promoted;

	const canDropIn = (zone: HeaderActionZone): boolean => zone === "tray" || draggingFromTop || !topFull;

	const endDrag = (): void => {
		setDragKey(null);
		setDrop(null);
	};

	const startDrag = (key: string) => (event: DragEvent) => {
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", key);
		setDragKey(key);
		setGhost(event);
	};

	/** 悬在某个元素上：按左右半边决定插在它前面还是后面。 */
	const overAt = (zone: HeaderActionZone, index: number) => (event: DragEvent) => {
		if (dragKey === null || !canDropIn(zone)) return;
		event.preventDefault();
		event.stopPropagation();
		const rect = event.currentTarget.getBoundingClientRect();
		setDrop({ zone, index: index + (event.clientX > rect.left + rect.width / 2 ? 1 : 0) });
	};

	const dropOn = (zone: HeaderActionZone) => (event: DragEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (dragKey !== null && canDropIn(zone)) {
			const index = drop?.zone === zone ? drop.index : zone === "top" ? top.length : tray.length;
			onMove(dragKey, zone, index);
		}
		endDrag();
	};

	/** 区域空白处：放到末尾。 */
	const overZone = (zone: HeaderActionZone) => (event: DragEvent) => {
		if (dragKey === null || !canDropIn(zone)) return;
		event.preventDefault();
		setDrop((current) => (current?.zone === zone ? current : { zone, index: zone === "top" ? top.length : tray.length }));
	};

	// 直线指示插入位置；圆角按钮上画内阴影会变成一段弧，所以用伪元素。
	const lineBefore = "after:absolute after:inset-y-1 after:left-0 after:w-0.5 after:rounded-full after:bg-primary";
	const lineAfter = "after:absolute after:inset-y-1 after:right-0 after:w-0.5 after:rounded-full after:bg-primary";

	return (
		<div className="group/bar flex shrink-0 items-center gap-2">
			<div
				ref={rootRef}
				data-header-action-bar="true"
				data-header-action-narrow={narrow ? "true" : undefined}
				className="group/header-actions relative flex shrink-0"
			>
				{narrow ? (
					narrow.overflow.length > 0 ? (
						<HeaderActionOverflowMenu items={narrow.overflow} label={labels.more} />
					) : null
				) : emptyBar ? (
					// 与右边面板开关同一套尺寸与形状（同样的 ButtonGroup，只是描边换成虚线、去掉底色）。
					<ButtonGroup
						blur={false}
						className={cn(
							"no-drag border border-dashed border-foreground/30 bg-transparent p-px transition-opacity duration-150 dark:bg-transparent",
							// 平时看不见但占着位置，所以悬浮在面板开关左边那一块也能出现；展开收纳后保持可见。
							open ? "opacity-100" : "opacity-0 group-hover/bar:opacity-100 has-[:focus-visible]:opacity-100",
						)}
					>
						<ButtonGroupItem
							title={labels.customize}
							aria-label={labels.customize}
							aria-expanded={open}
							data-header-action-add="true"
							onClick={() => setOpen((current) => !current)}
							className="text-muted-foreground hover:text-foreground"
							icon={<span className="icon-[solar--add-linear] pointer-events-none size-4" />}
						/>
					</ButtonGroup>
				) : (
					<ButtonGroup blur={false} onDragOver={overZone("top")} onDrop={dropOn("top")}>
						{/* 还有空位就在最左边留一个虚线席位（只一个，不把剩余席位都摆出来）。 */}
						{hasFreeSeat && (
							<span
								data-header-action-seat="true"
								aria-hidden="true"
								onDragOver={(event) => {
									if (dragKey === null || !canDropIn("top")) return;
									event.preventDefault();
									event.stopPropagation();
									setDrop({ zone: "top", index: 0 });
								}}
								onDrop={dropOn("top")}
								className={cn(
									"mr-0.5 h-7 w-8 shrink-0 rounded-full border border-dashed border-foreground/30 transition-colors",
									dragKey !== null && drop?.zone === "top" && drop.index === 0 && !draggingFromTop && "border-primary",
								)}
							/>
						)}
						{top.map((item, index) => (
							<BarItem
								key={item.key}
								item={item}
								jiggle={editing ? index : undefined}
								stowLabel={labels.moveToTray}
								onStow={() => onMove(item.key, "tray", Number.MAX_SAFE_INTEGER)}
								// 只有进入「调整」状态后按钮才可拖，平时点击就是触发功能，拖拽手势留给窗口。
								dragProps={
									editing
										? {
												draggable: true,
												onDragStart: startDrag(item.key),
												onDragEnd: endDrag,
												onDragOver: overAt("top", index),
												onDrop: dropOn("top"),
											}
										: undefined
								}
								className={cn(
									dragKey === item.key && "opacity-40",
									drop?.zone === "top" && drop.index === index && lineBefore,
									drop?.zone === "top" && drop.index === top.length && index === top.length - 1 && lineAfter,
								)}
							/>
						))}
					</ButtonGroup>
				)}
				{/* 收纳展开时小白条不渲染：否则悬浮态会让它透在托盘后面；顶栏为空时本来就没有小白条。 */}
				{narrow === null && !emptyBar && !open && (
					<button
						type="button"
						title={labels.customize}
						aria-label={labels.customize}
						aria-expanded={open}
						data-header-action-tray-handle="true"
						onClick={() => setOpen(true)}
						className={cn(
							// 紧贴按钮组下沿的一条热区，始终接收指针：鼠标从按钮组往下挪的路上它还在，
							// 悬浮状态不会断；只有「看得见」是渐隐的，且消失前留 500ms 的余地。
							"no-drag absolute top-full left-1/2 z-10 flex h-4 w-14 -translate-x-1/2 items-center justify-center outline-none",
							"opacity-0 transition-opacity delay-500 duration-200",
							"group-hover/header-actions:opacity-100 group-hover/header-actions:delay-0",
							"group-focus-within/header-actions:opacity-100 group-focus-within/header-actions:delay-0",
							"hover:opacity-100 hover:delay-0 focus-visible:opacity-100",
							trayAlert && "opacity-100",
						)}
					>
						<span
							className={cn(
								"h-1 w-8 rounded-full transition-colors",
								trayAlert ? "bg-red-500" : "bg-foreground/35 group-hover/header-actions:bg-foreground/50",
							)}
						/>
					</button>
				)}
				{narrow === null && open && (
					<>
						{/* 「调整」按钮：独立在收纳胶囊右侧、面板开关正下方（同样的玻璃胶囊）。点它才进入拖拽调整，平时点图标只触发图标自己的功能。 */}
						<ButtonGroup
							blur={false}
							className={cn(
								"no-drag absolute top-full left-full z-30 mt-1.5 ml-2 origin-top-right animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-200",
								OPAQUE_GLASS,
							)}
						>
							<ButtonGroupItem
								title={editing ? labels.done : labels.adjust}
								aria-label={editing ? labels.done : labels.adjust}
								aria-pressed={editing}
								data-header-action-adjust="true"
								// 调整中（打勾）用主色底，提示「正在编辑、点它完成」；未调整时保持普通外观。
								className={editing ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : undefined}
								onClick={() => {
									setEditing((current) => !current);
									setDragKey(null);
									setDrop(null);
								}}
								icon={
									<span
										className={cn(
											editing ? "icon-[solar--check-read-linear]" : "icon-[solar--tuning-2-linear]",
											"pointer-events-none size-4",
										)}
									/>
								}
							/>
						</ButtonGroup>
						{/* 收纳是按钮组正下方的第二个胶囊（同样的玻璃质感，留一点间隙），不是浮层；没有可收纳的、也不在调整时不显示。 */}
						{(tray.length > 0 || editing) && (
							<div
								data-header-action-tray="true"
								className={cn(
									"no-drag absolute top-full right-0 z-30 mt-1.5 origin-top-right rounded-[18px] p-1",
									OPAQUE_GLASS,
									"animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-200",
								)}
							>
								<ul
									onDragOver={overZone("tray")}
									onDrop={dropOn("tray")}
									// 宽度跟着内容走：最多 4 列，不够 4 个就更窄。
									style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, tray.length + (editing ? 1 : 0)))}, 2rem)` }}
									className="grid gap-1"
								>
									{/* 调整状态下的空位：与图标同大，放在收纳的第一格；拖到它上面就放到收纳最前面。 */}
									{editing && (
										<li
											aria-hidden="true"
											data-header-action-seat="true"
											onDragOver={(event) => {
												if (dragKey === null) return;
												event.preventDefault();
												event.stopPropagation();
												setDrop({ zone: "tray", index: 0 });
											}}
											onDrop={dropOn("tray")}
											className={cn(
												"h-7 w-8 rounded-full border border-dashed border-foreground/30 transition-colors",
												dragKey !== null && drop?.zone === "tray" && drop.index === 0 && "border-primary",
											)}
										/>
									)}
									{tray.map((item, index) => (
										<Tile
											key={item.key}
											item={item}
											index={index}
											count={tray.length}
											editing={editing}
											drop={drop}
											dragging={dragKey === item.key}
											moveDisabled={topFull}
											moveLabel={topFull ? labels.topFull : labels.moveToTop}
											onMoveClick={() => onMove(item.key, "top", Number.MAX_SAFE_INTEGER)}
											onDragStart={startDrag(item.key)}
											onDragEnd={endDrag}
											onDragOverTile={(event, at) => overAt("tray", at)(event)}
											onClose={closeTray}
										/>
									))}
								</ul>
							</div>
						)}
					</>
				)}
			</div>
			{/* 活动面板开关是个独立的小组，固定在最右，不参与排序与收纳。 */}
			{/* 活动面板开关所在的小组；被收纳却处于选中态的动作（如窗口置顶）在它左边露出来，调整状态下不露（那时所有按钮都不可点）。 */}
			{pinned || beside.length > 0 ? (
				<ButtonGroup blur={false}>
					{beside.map((item) => (
						<BarItem key={item.key} item={item} />
					))}
					{pinned}
				</ButtonGroup>
			) : null}
		</div>
	);
}
