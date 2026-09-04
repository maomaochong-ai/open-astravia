import type { JSX } from "react";
import type { SidebarNavItem } from "@vetta/theme-sdk/sidebar";
import { cn } from "@vetta/ui";
import { SidebarNavBadgeView } from "./SidebarNavBadgeView";
import type { SidebarNavDragHandlers, SidebarNavRegion } from "./useSidebarNavDrag";
import { SidebarNavIcon } from "./SidebarNavIcon";

export interface SidebarNavMorePanelLabels {
	/** 置顶区分组标题。 */
	pinnedTitle: string;
	/** 收纳区分组标题。 */
	moreTitle: string;
	pin: string;
	unpin: string;
	/** 置顶区已满时 pin 按钮的 title。 */
	pinFull: string;
	reset: string;
}

export interface SidebarNavMorePanelProps {
	canPinMore: boolean;
	drag: SidebarNavDragHandlers & { draggingKey: string | null };
	labels: SidebarNavMorePanelLabels;
	moreItems: readonly SidebarNavItem[];
	onItemClick: (item: SidebarNavItem) => void;
	onPin: (key: string) => void;
	onReset: () => void;
	onUnpin: (key: string) => void;
	pinnedItems: readonly SidebarNavItem[];
}

function DropLine({ visible }: { visible: boolean }): JSX.Element {
	return (
		<span
			aria-hidden
			className={cn("mx-1 block h-px rounded-full transition-colors", visible ? "bg-primary" : "bg-transparent")}
		/>
	);
}

function NavRow({
	drag,
	item,
	labels,
	onClick,
	onTogglePin,
	pinDisabled,
	region,
}: {
	drag: SidebarNavMorePanelProps["drag"];
	item: SidebarNavItem;
	labels: SidebarNavMorePanelLabels;
	onClick: () => void;
	onTogglePin: (() => void) | null;
	pinDisabled: boolean;
	region: SidebarNavRegion;
}): JSX.Element {
	const dragProps = drag.itemProps(item, region);
	const pinned = region === "pinned";
	return (
		<div
			className={cn(
				"group/nav-row flex items-center gap-1 rounded-md pr-1 transition-opacity",
				drag.draggingKey === item.key && "opacity-40",
			)}
			draggable={dragProps.draggable}
			onDragStart={dragProps.onDragStart}
			onDragEnd={dragProps.onDragEnd}
			onDragOver={dragProps.onDragOver}
			onDrop={dragProps.onDrop}
		>
			<span
				aria-hidden
				className={cn(
					"icon-[solar--hamburger-menu-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40",
					dragProps.draggable ? "cursor-grab" : "opacity-0",
				)}
			/>
			<button
				type="button"
				title={item.title ?? item.label}
				onClick={onClick}
				className={cn(
					"flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-[13px] transition-colors",
					item.active ? "bg-accent font-semibold text-foreground" : "text-foreground hover:bg-accent/50",
				)}
			>
				<SidebarNavIcon icon={item.icon} iconUrl={item.iconUrl} />
				<span className="truncate">{item.label}</span>
				{item.badge && <SidebarNavBadgeView badge={item.badge} />}
			</button>
			{onTogglePin ? (
				<button
					type="button"
					disabled={pinDisabled}
					title={pinned ? labels.unpin : pinDisabled ? labels.pinFull : labels.pin}
					aria-label={pinned ? labels.unpin : labels.pin}
					aria-pressed={pinned}
					onClick={onTogglePin}
					className={cn(
						"flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all",
						pinned
							? "text-primary hover:bg-accent/60"
							: "text-muted-foreground/50 opacity-0 hover:bg-accent/60 hover:text-foreground focus-visible:opacity-100 group-hover/nav-row:opacity-100",
						pinDisabled && "cursor-not-allowed opacity-30 group-hover/nav-row:opacity-30",
					)}
				>
					<span className={cn(pinned ? "icon-[solar--pin-bold]" : "icon-[solar--pin-linear]", "h-3.5 w-3.5")} />
				</button>
			) : (
				// 锁定项（「新会话」）没有 pin 动作，占位保持行对齐。
				<span aria-hidden className="h-6 w-6 shrink-0" />
			)}
		</div>
	);
}

/**
 * 「更多」弹层：既是次要入口列表，也是**导航自定义面板**。
 * 置顶区与收纳区都在这里列出，可拖拽排序、可跨区拖拽、也可以点 pin 图标切换。
 */
export function SidebarNavMorePanel({
	canPinMore,
	drag,
	labels,
	moreItems,
	onItemClick,
	onPin,
	onReset,
	onUnpin,
	pinnedItems,
}: SidebarNavMorePanelProps): JSX.Element {
	const pinnedRegion = drag.regionProps("pinned");
	const moreRegion = drag.regionProps("more");
	const hasLockedTail = moreItems[moreItems.length - 1]?.locked === true;

	return (
		<div className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
			<div className="flex items-center gap-1 px-2 pt-1">
				<p className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
					{labels.pinnedTitle}
				</p>
				<button
					type="button"
					onClick={onReset}
					title={labels.reset}
					aria-label={labels.reset}
					className="-me-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-accent/50 hover:text-foreground"
				>
					<span aria-hidden className="icon-[solar--restart-linear] h-3.5 w-3.5" />
				</button>
			</div>
			<div className="flex flex-col" onDragOver={pinnedRegion.onDragOver} onDrop={pinnedRegion.onDrop}>
				{pinnedItems.map((item) => (
					<div key={item.key}>
						<DropLine visible={drag.isDropBefore(item.key, "pinned")} />
						<NavRow
							drag={drag}
							item={item}
							labels={labels}
							onClick={() => onItemClick(item)}
							onTogglePin={item.locked === true ? null : () => onUnpin(item.key)}
							pinDisabled={false}
							region="pinned"
						/>
					</div>
				))}
				<DropLine visible={drag.isDropAtEnd("pinned")} />
			</div>

			<p className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
				{labels.moreTitle}
			</p>
			<div className="flex flex-col" onDragOver={moreRegion.onDragOver} onDrop={moreRegion.onDrop}>
				{moreItems.map((item, index) => {
					// 末位锁定项（「更多选项」）之后没有落位，「落到末尾」的指示线要画在它**之前**。
					const lockedTail = item.locked === true && index === moreItems.length - 1;
					return (
						<div key={item.key}>
							<DropLine
								visible={drag.isDropBefore(item.key, "more") || (lockedTail && drag.isDropAtEnd("more"))}
							/>
							<NavRow
								drag={drag}
								item={item}
								labels={labels}
								onClick={() => onItemClick(item)}
								onTogglePin={item.locked === true ? null : () => onPin(item.key)}
								pinDisabled={!canPinMore}
								region="more"
							/>
						</div>
					);
				})}
				<DropLine visible={!hasLockedTail && drag.isDropAtEnd("more")} />
			</div>
		</div>
	);
}
