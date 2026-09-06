import {
	createContext,
	useContext,
	useRef,
	useState,
	type DragEvent,
	type JSX,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@astravia/ui";
import type {
	ExplorerOrderMap,
	RowOrder,
} from "../lib/explorer-order";

/**
 * 连接树行级自定义操作（置顶/拖拽重排，#1）的共享上下文与行工具。
 *
 * 状态（ExplorerOrderMap）由 DatabaseExplorerTree 持有并持久化；
 * ScopeRows / TableRows / 连接行通过 useExplorerRowOrder 读取顺序并触发
 * 写操作。names 由调用方在「该容器此刻完整可排序行名」上给出：
 * 作用域行 = 该连接全部作用域；表行 = 该分区（表/视图分区共享容器，
 * 以分区行名操作，两分区互不污染）；连接行 = 该组全部连接。
 */

export interface ExplorerRowOrderController {
	readonly orderMap: ExplorerOrderMap;
	/** 切换行置顶。names = 容器完整行名（写操作基线）。 */
	togglePin: (container: string, names: readonly string[], name: string) => void;
	/** 拖拽移动（from 拖到 to 行前；同段/跨段自动处理）。 */
	moveRow: (container: string, names: readonly string[], from: string, to: string | null) => void;
}

export const ExplorerRowOrderContext = createContext<ExplorerRowOrderController | null>(null);

export function useExplorerRowOrder(): ExplorerRowOrderController {
	const controller = useContext(ExplorerRowOrderContext);
	if (!controller) {
		throw new Error("useExplorerRowOrder 必须在 DatabaseExplorerTree 的 Provider 内使用");
	}
	return controller;
}

/** 读取某容器行的置顶状态（无记录 = 未置顶）。 */
export function rowIsPinned(orderMap: ExplorerOrderMap, container: string, name: string): boolean {
	return orderMap[container]?.pinned.includes(name) ?? false;
}

const DRAG_MIME = "application/x-astravia-db-row";

function encodeDragPayload(container: string, name: string): string {
	return JSON.stringify({ container, name });
}

function decodeDragPayload(raw: string): { container: string; name: string } | null {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed == null) return null;
		const { container, name } = parsed as { container?: unknown; name?: unknown };
		if (typeof container !== "string" || typeof name !== "string") return null;
		return { container, name };
	} catch {
		return null;
	}
}

/**
 * 树行拖拽（HTML5 DnD）：
 * - 仅允许同一容器内移动；拖到目标行 = 移动到目标行位置（目标前）。
 * - 高亮由内部 isOver 状态驱动；移动在 onDrop 统一交给 controller.moveRow。
 */
export function useRowDrag(
	container: string,
	name: string,
	names: readonly string[],
): {
	rowProps: {
		draggable: boolean;
		onDragStart: (event: DragEvent<HTMLElement>) => void;
		onDragOver: (event: DragEvent<HTMLElement>) => void;
		onDragLeave: () => void;
		onDrop: (event: DragEvent<HTMLElement>) => void;
	};
	isOver: boolean;
} {
	const controller = useExplorerRowOrder();
	const [isOver, setIsOver] = useState(false);
	const namesRef = useRef(names);
	namesRef.current = names;

	const onDragStart = (event: DragEvent<HTMLElement>) => {
		event.dataTransfer.setData(DRAG_MIME, encodeDragPayload(container, name));
		event.dataTransfer.effectAllowed = "move";
	};

	const onDragOver = (event: DragEvent<HTMLElement>) => {
		const payload = decodeDragPayload(event.dataTransfer.getData(DRAG_MIME));
		if (!payload || payload.container !== container || payload.name === name) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
		if (!isOver) setIsOver(true);
	};

	const onDragLeave = () => {
		setIsOver(false);
	};

	const onDrop = (event: DragEvent<HTMLElement>) => {
		setIsOver(false);
		const payload = decodeDragPayload(event.dataTransfer.getData(DRAG_MIME));
		if (!payload || payload.container !== container || payload.name === name) return;
		event.preventDefault();
		event.stopPropagation();
		controller.moveRow(container, namesRef.current, payload.name, name);
	};

	return {
		rowProps: { draggable: true, onDragStart, onDragOver, onDragLeave, onDrop },
		isOver,
	};
}

/** 行拖拽高亮 class（isOver 时提示「可放置到此处」）。 */
export function rowDropHighlight(isOver: boolean): string {
	return isOver ? " ring-1 ring-inset ring-primary/50" : "";
}

/** 行尾置顶按钮（hover 显示，置顶后常显）。 */
export function RowPinButton({
	pinned,
	onToggle,
	className,
}: {
	pinned: boolean;
	onToggle: () => void;
	className?: string;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const label = pinned ? t("databaseUnpin") : t("databasePin");
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			className={cn(
				className,
				"flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/55 transition-opacity hover:bg-muted hover:text-foreground",
				pinned ? "opacity-100 text-primary" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
			)}
			onClick={(event) => {
				event.stopPropagation();
				onToggle();
			}}
		>
			<span className={cn("h-3.5 w-3.5", pinned ? "icon-[mdi--pin]" : "icon-[mdi--pin-outline]")} />
		</button>
	);
}

/** 读取容器顺序（无记录返回空顺序常量）。 */
export function containerOrder(orderMap: ExplorerOrderMap, container: string): RowOrder | undefined {
	return orderMap[container];
}


/**
 * 可拖拽/可置顶的行外壳：把 HTML5 拖拽（同一容器内跨段移动）接到行 div 上。
 * container/name/names 语义与 useExplorerRowOrder 一致；data-db-* 透传给吸顶/定位查询。
 */
export interface ExplorerOrderableRowProps {
	readonly container: string;
	readonly name: string;
	/** 拖拽落点基线：该容器此刻完整可排序行名（与 togglePin/moveRow 的 names 一致）。 */
	readonly names: readonly string[];
	/** 禁用拖拽/置顶交互（非「默认」排序时连接行）。外观不变。 */
	readonly disabled?: boolean;
	readonly className?: string;
	readonly title?: string;
	readonly "data-db-connection"?: string;
	readonly "data-db-expanded"?: string;
	readonly "data-db-group"?: string;
	onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
	onDoubleClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
	onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
	children?: ReactNode;
}

export function ExplorerOrderableRow(props: ExplorerOrderableRowProps): JSX.Element {
	const {
		container,
		name,
		names,
		disabled = false,
		className,
		title,
		"data-db-connection": dataDbConnection,
		"data-db-expanded": dataDbExpanded,
		"data-db-group": dataDbGroup,
		onClick,
		onDoubleClick,
		onContextMenu,
		children,
	} = props;
	const { rowProps, isOver } = useRowDrag(container, name, names);
	return (
		<div
			title={title}
			data-db-connection={dataDbConnection}
			data-db-expanded={dataDbExpanded}
			data-db-group={dataDbGroup}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContextMenu}
			{...(disabled ? {} : rowProps)}
			className={cn(className, !disabled && rowDropHighlight(isOver))}
		>
			{children}
		</div>
	);
}