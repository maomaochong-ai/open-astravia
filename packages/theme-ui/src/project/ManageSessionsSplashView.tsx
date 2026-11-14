import { cn } from "@astravia-org/ui/utils";
import { type JSX, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { CommandMenuRow } from "../overlays/CommandMenuRow";
import type { CommandMenuItemView } from "../overlays/command-menu-types";
import { SplashPanel } from "../overlays/SplashPanel";
import { SplashFooter, SplashInputHeader, SplashStep, SplashTitleHeader } from "../overlays/SplashParts";
import {
	computeManageSessionsRange,
	MANAGE_SESSIONS_LIST_HEIGHT,
	MANAGE_SESSIONS_ROW_HEIGHT,
	MANAGE_SESSIONS_VIRTUAL_THRESHOLD,
	manageSessionsScrollTopFor,
} from "./manage-sessions-range";

/**
 * 「管理会话」面板的纯展示层。整个流程在同一个 Splash 里完成，三个步骤只换头部与内容：
 * - list：搜索 + 会话列表，底栏是快捷键提示与「清空全部」；
 * - menu：选中会话的更多操作（也用来选标签），一个通用的操作列表；
 * - rename：重命名输入。
 * 键盘导航与快捷键由宿主负责，本组件只处理渲染与滚动跟随。
 */

export type ManageSessionsStep = "list" | "menu" | "rename";

export interface ManageSessionsMenuItemView {
	readonly id: string;
	readonly label: string;
	/** iconify 类名；有 dotColor 时以色点代替。 */
	readonly icon?: string;
	readonly dotColor?: string;
	readonly checked?: boolean;
	readonly danger?: boolean;
	readonly disabled?: boolean;
	/** 右侧的快捷键提示，例如 Control X。 */
	readonly shortcut?: string;
}

export interface ManageSessionsTabView {
	readonly id: string;
	readonly label: string;
	readonly dotColor?: string;
}

export interface ManageSessionsSplashViewLabels {
	readonly title: string;
	readonly searchPlaceholder: string;
	readonly searchLabel: string;
	readonly empty: string;
	readonly back: string;
	readonly renamePlaceholder: string;
	readonly renameLabel: string;
	readonly clearAll: string;
	readonly clearAllDisabled: string;
	readonly hintDelete: string;
	readonly hintMore: string;
	readonly hintClose: string;
	readonly hintTab: string;
	readonly hintBack: string;
	readonly hintSelect: string;
	readonly hintRename: string;
}

export interface ManageSessionsSplashViewProps {
	readonly open: boolean;
	readonly step: ManageSessionsStep;
	readonly labels: ManageSessionsSplashViewLabels;
	/** 快捷键修饰键的显示名，mac 为 Control，其余为 Ctrl。 */
	readonly modifierLabel: string;
	readonly onClose: () => void;

	/** 置顶在列表上方的标签页；为空时不显示。按 Tab 在其间切换由宿主处理。 */
	readonly tabs: readonly ManageSessionsTabView[];
	readonly activeTabId: string;
	readonly onSelectTab: (id: string) => void;

	// list
	readonly query: string;
	readonly onQueryChange: (value: string) => void;
	readonly rows: readonly CommandMenuItemView[];
	readonly selectedId: string | null;
	readonly onHoverRow: (id: string) => void;
	readonly onOpenRow: (id: string) => void;
	readonly onMoreRow: (id: string) => void;
	readonly clearAllVisible: boolean;
	readonly clearAllDisabled: boolean;
	readonly clearAllDisabledReason?: string;
	readonly onClearAll: () => void;

	// menu
	readonly menuTitle: string;
	readonly menuItems: readonly ManageSessionsMenuItemView[];
	readonly menuActiveId: string | null;
	readonly onHoverMenuItem: (id: string) => void;
	readonly onSelectMenuItem: (id: string) => void;

	// rename
	readonly renameValue: string;
	readonly onRenameChange: (value: string) => void;
	readonly onRenameSubmit: () => void;

	readonly onBack: () => void;
}

function Kbd({ children }: { children: ReactNode }): JSX.Element {
	return (
		<kbd className="rounded bg-foreground/[0.07] px-1 py-px font-sans text-[10px] font-medium text-foreground/70">
			{children}
		</kbd>
	);
}

function Hint({ keys, label }: { keys: readonly string[]; label: string }): JSX.Element {
	return (
		<span className="flex items-center gap-1 whitespace-nowrap">
			{keys.map((key) => (
				<Kbd key={key}>{key}</Kbd>
			))}
			<span>{label}</span>
		</span>
	);
}

const LIST_CLASS = `min-h-0 max-h-[min(${MANAGE_SESSIONS_LIST_HEIGHT}px,56vh)] overflow-y-auto overscroll-contain px-1.5 py-1.5`;

function MenuRow({
	item,
	active,
	onHover,
	onSelect,
	registerRef,
}: {
	item: ManageSessionsMenuItemView;
	active: boolean;
	onHover: (id: string) => void;
	onSelect: (id: string) => void;
	registerRef: (id: string, element: HTMLButtonElement | null) => void;
}): JSX.Element {
	return (
		<button
			type="button"
			ref={(element) => registerRef(item.id, element)}
			role="menuitem"
			disabled={item.disabled}
			title={item.disabled ? item.label : undefined}
			onMouseMove={() => {
				if (!item.disabled) onHover(item.id);
			}}
			onClick={() => {
				if (!item.disabled) onSelect(item.id);
			}}
			className={cn(
				"relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors",
				item.disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
				active && "bg-primary/10",
			)}
		>
			{item.dotColor ? (
				<span
					aria-hidden="true"
					className="size-2.5 shrink-0 rounded-full"
					style={{ backgroundColor: item.dotColor }}
				/>
			) : (
				<span
					aria-hidden="true"
					className={cn(
						item.icon,
						"size-4 shrink-0",
						item.danger ? "text-destructive" : active ? "text-foreground" : "text-muted-foreground",
					)}
				/>
			)}
			<span className={cn("min-w-0 flex-1 truncate text-[13px]", item.danger ? "text-destructive" : "text-foreground")}>
				{item.label}
			</span>
			{item.checked && (
				<span aria-hidden="true" className="icon-[solar--check-read-linear] size-4 shrink-0 text-primary" />
			)}
			{item.shortcut && <Kbd>{item.shortcut}</Kbd>}
		</button>
	);
}

export function ManageSessionsSplashView(props: ManageSessionsSplashViewProps): JSX.Element {
	const {
		open,
		step,
		labels,
		modifierLabel,
		onClose,
		tabs,
		activeTabId,
		onSelectTab,
		query,
		onQueryChange,
		rows,
		selectedId,
		onHoverRow,
		onOpenRow,
		onMoreRow,
		clearAllVisible,
		clearAllDisabled,
		clearAllDisabledReason,
		onClearAll,
		menuTitle,
		menuItems,
		menuActiveId,
		onHoverMenuItem,
		onSelectMenuItem,
		renameValue,
		onRenameChange,
		onRenameSubmit,
		onBack,
	} = props;
	const rowRefs = useRef(new Map<string, HTMLButtonElement>());
	const registerRef = useCallback((id: string, element: HTMLButtonElement | null) => {
		if (element) rowRefs.current.set(id, element);
		else rowRefs.current.delete(id);
	}, []);

	const listRef = useRef<HTMLDivElement | null>(null);
	const [scrollTop, setScrollTop] = useState(0);
	/**
	 * 列表的实际可视高度。
	 *
	 * 容器是 `max-h-[min(420px,56vh)]`：矮窗口下真实高度远小于 420，
	 * 按常量算可见行数会让窗口比视口大，选中行滚进“看不见的区域”且回不来。
	 * 因此实测容器高度，拿不到时（无 ResizeObserver / 尚未布局）退回上限值。
	 */
	const [viewportHeight, setViewportHeight] = useState(MANAGE_SESSIONS_LIST_HEIGHT);
	useEffect(() => {
		if (!open) return;
		const element = listRef.current;
		if (!element) return;
		const apply = (height: number): void => {
			if (!Number.isFinite(height) || height <= 0) return;
			setViewportHeight((current) => (Math.abs(current - height) < 1 ? current : height));
		};
		if (typeof ResizeObserver === "undefined") {
			apply(element.clientHeight);
			return;
		}
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			apply(entry?.contentRect.height ?? element.clientHeight);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [open, step]);

	// 换搜索词 / 换标签页后列表是另一批行，滚动位置回到顶部。
	const listIdentity = `${activeTabId}\u0000${query}`;
	useEffect(() => {
		setScrollTop(0);
		if (listRef.current) listRef.current.scrollTop = 0;
	}, [listIdentity]);

	const windowed = rows.length > MANAGE_SESSIONS_VIRTUAL_THRESHOLD;
	const range = computeManageSessionsRange({
		scrollTop,
		viewportHeight,
		rowHeight: MANAGE_SESSIONS_ROW_HEIGHT,
		count: rows.length,
	});

	const followId = step === "menu" ? menuActiveId : step === "list" ? selectedId : null;
	// 与命令面板同理：用 nearest 且不带 smooth，连续按方向键时平滑滚动会排队堆积。
	// 窗口化时目标行可能没挂载，改按行下标直接定位滚动位置。
	useEffect(() => {
		if (!open || !followId) return;
		if (step === "list" && windowed) {
			const index = rows.findIndex((row) => row.id === followId);
			const next = manageSessionsScrollTopFor(
				{
					index,
					rowHeight: MANAGE_SESSIONS_ROW_HEIGHT,
					viewportHeight,
					scrollTop,
				},
				range,
			);
			if (next !== null && listRef.current) {
				listRef.current.scrollTop = next;
				setScrollTop(next);
			}
			return;
		}
		rowRefs.current.get(followId)?.scrollIntoView?.({ block: "nearest" });
	}, [open, followId, step, windowed, rows, range, scrollTop, viewportHeight]);

	const showTabs = step === "list" && tabs.length > 1;
	const listHeader = (
		<>
			<SplashInputHeader
				icon="icon-[solar--magnifer-linear]"
				value={query}
				placeholder={labels.searchPlaceholder}
				label={labels.searchLabel}
				onChange={onQueryChange}
				onSubmit={() => {
					if (selectedId) onOpenRow(selectedId);
				}}
			/>
			{showTabs && (
				<div role="tablist" className="flex shrink-0 items-center gap-1 overflow-x-auto px-3 pb-2">
					{tabs.map((tab) => (
						<button
							key={tab.id}
							type="button"
							role="tab"
							tabIndex={-1}
							aria-selected={tab.id === activeTabId}
							onClick={() => onSelectTab(tab.id)}
							className={cn(
								"flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] outline-none transition-colors",
								tab.id === activeTabId
									? "bg-primary/10 text-foreground"
									: "text-muted-foreground hover:bg-accent hover:text-foreground",
							)}
						>
							{tab.dotColor && (
								<span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: tab.dotColor }} />
							)}
							{tab.label}
						</button>
					))}
				</div>
			)}
		</>
	);
	const header =
		step === "list" ? (
			listHeader
		) : step === "rename" ? (
			<SplashInputHeader
				icon="icon-[solar--pen-2-linear]"
				value={renameValue}
				placeholder={labels.renamePlaceholder}
				label={labels.renameLabel}
				onChange={onRenameChange}
				onSubmit={onRenameSubmit}
				onBack={onBack}
				backLabel={labels.back}
			/>
		) : (
			<SplashTitleHeader title={menuTitle} variant="plain" onBack={onBack} backLabel={labels.back} />
		);

	const footer =
		step === "list" ? (
			// 窄窗口下提示与按钮整组换行，而不是把每个提示挤成两三行。
			<SplashFooter className="flex-wrap gap-x-3 gap-y-1 py-1.5">
				<Hint keys={[modifierLabel, "X"]} label={labels.hintDelete} />
				<Hint keys={[modifierLabel, "K"]} label={labels.hintMore} />
				{showTabs && <Hint keys={["Tab"]} label={labels.hintTab} />}
				<span className="ml-auto flex items-center gap-3 whitespace-nowrap">
					{clearAllVisible && (
						<button
							type="button"
							disabled={clearAllDisabled}
							title={clearAllDisabled ? clearAllDisabledReason : undefined}
							onClick={onClearAll}
							className="rounded px-1 text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent"
						>
							{labels.clearAll}
						</button>
					)}
					<span>{labels.hintClose}</span>
				</span>
			</SplashFooter>
		) : step === "rename" ? (
			<SplashFooter>
				<span>{labels.hintRename}</span>
				<span className="ml-auto">{labels.hintBack}</span>
			</SplashFooter>
		) : (
			<SplashFooter>
				<span>{labels.hintSelect}</span>
				<span className="ml-auto">{labels.hintBack}</span>
			</SplashFooter>
		);

	const visibleRows = windowed ? rows.slice(range.start, range.end) : rows;

	return (
		<SplashPanel open={open} onClose={onClose} label={labels.title} width="560px" header={header} footer={footer}>
			<SplashStep stepKey={step}>
				{step === "list" && (
					<div
						ref={listRef}
						role="listbox"
						aria-label={labels.title}
						className={LIST_CLASS}
						onScroll={windowed ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
					>
						<div
							data-manage-sessions-spacer={windowed ? "true" : undefined}
							style={windowed ? { paddingTop: range.paddingTop, paddingBottom: range.paddingBottom } : undefined}
						>
							{visibleRows.map((row) => (
								<CommandMenuRow
									key={row.id}
									item={row}
									active={row.id === selectedId}
									suppressSelectionAnimation={false}
									onActivate={onOpenRow}
									onHover={onHoverRow}
									onMore={onMoreRow}
									moreLabel={labels.hintMore}
									registerRef={registerRef}
								/>
							))}
						</div>
						{rows.length === 0 && (
							<div className="px-3 py-10 text-center text-[13px] text-muted-foreground">{labels.empty}</div>
						)}
					</div>
				)}
				{step === "menu" && (
					<div role="menu" aria-label={menuTitle} className={LIST_CLASS}>
						{menuItems.map((item) => (
							<MenuRow
								key={item.id}
								item={item}
								active={item.id === menuActiveId}
								onHover={onHoverMenuItem}
								onSelect={onSelectMenuItem}
								registerRef={registerRef}
							/>
						))}
					</div>
				)}
			</SplashStep>
		</SplashPanel>
	);
}
