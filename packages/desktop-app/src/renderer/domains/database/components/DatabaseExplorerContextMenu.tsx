import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { cn } from "@astravia/ui";

/** 菜单项：icon 为图标 class；label 已由调用方完成 i18n；separator 渲染分隔线。 */
export type DatabaseContextMenuItem =
	| {
			readonly key: string;
			readonly icon?: string;
			readonly label: string;
			readonly destructive?: boolean;
			/** 勾选态（用于排序等单选动作），行尾显示对勾。 */
			readonly checked?: boolean;
			readonly onSelect: () => void;
	  }
	| { readonly key: string; readonly separator: true };

export interface DatabaseExplorerContextMenuProps {
	readonly x: number;
	readonly y: number;
	readonly items: readonly DatabaseContextMenuItem[];
	readonly onClose: () => void;
}

const MENU_PADDING = 8;

/**
 * 连接树节点右键菜单（V2，对齐 dbx-main ConnectionTree 右键菜单）。
 * fixed 定位 + portal；点击外部 / Escape / 滚动关闭；超出视口时翻转定位。
 * 菜单内容由调用方按节点类型组装（连接/表/列各有不同动作）。
 */
export function DatabaseExplorerContextMenu({
	x,
	y,
	items,
	onClose,
}: DatabaseExplorerContextMenuProps): JSX.Element {
	const menuRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ x, y });

	// 菜单尺寸未知前先渲染一帧测量，再翻转越界坐标（避免菜单飞出视口）。
	useLayoutEffect(() => {
		const el = menuRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const nextX = x + rect.width + MENU_PADDING > window.innerWidth ? Math.max(MENU_PADDING, x - rect.width) : x;
		const nextY = y + rect.height + MENU_PADDING > window.innerHeight ? Math.max(MENU_PADDING, y - rect.height) : y;
		if (nextX !== x || nextY !== y) setPos({ x: nextX, y: nextY });
	}, [x, y]);

	useEffect(() => {
		function handlePointerDown(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
		}
		function handleKey(event: KeyboardEvent) {
			if (event.key === "Escape") onClose();
		}
		function handleScroll() {
			onClose();
		}
		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKey);
		document.addEventListener("wheel", handleScroll, { passive: true });
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKey);
			document.removeEventListener("wheel", handleScroll);
		};
	}, [onClose]);

	return createPortal(
		<AnimatePresence>
			<motion.div
				ref={menuRef}
				initial={{ opacity: 0, scale: 0.95 }}
				animate={{ opacity: 1, scale: 1 }}
				exit={{ opacity: 0, scale: 0.95 }}
				transition={{ duration: 0.12, ease: [0.25, 0.1, 0.25, 1] }}
				className="fixed z-[1000] w-max min-w-40 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl"
				style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
				role="menu"
			>
				{items.map((item) =>
					"separator" in item ? (
						<div key={item.key} role="separator" className="mx-1 my-1 h-px bg-border/80" />
					) : (
						<button
							key={item.key}
							type="button"
							role="menuitem"
							onClick={() => {
								item.onSelect();
								onClose();
							}}
							className={cn(
								"flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-[12px] font-medium text-foreground transition-colors hover:bg-accent",
								item.destructive && "text-destructive",
							)}
						>
							{/* 对齐主界面设置菜单（SettingsMenuActionButton）：图标 14px 内联、与文字 gap-2；文字为 flex 子项自然左对齐，不另包占位。 */}
							<span className={cn("h-3.5 w-3.5 shrink-0", item.icon, item.destructive && "text-destructive")} />
							<span className="whitespace-nowrap">{item.label}</span>
							{item.checked ? <span className="ml-auto h-3.5 w-3.5 shrink-0 text-primary icon-[mdi--check]" /> : null}
						</button>
					),
				)}
			</motion.div>
		</AnimatePresence>,
		document.body,
	);
}
