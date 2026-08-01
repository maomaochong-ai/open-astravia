import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useEffect, useLayoutEffect, useRef, useState } from "react";

/** 右键菜单的锚点：frameId + 容器内坐标（不受画布 transform 影响）。 */
export interface FrameMenuAnchor {
	frameId: string;
	x: number;
	y: number;
}

interface FrameContextMenuProps {
	anchor: FrameMenuAnchor;
	onAsk(): void;
	onRename(): void;
	onCopyImage(): void;
	onExportMockup(): void;
	onDelete(): void;
	onClose(): void;
}

/** 贴边时把菜单收回容器内的留白。 */
const EDGE_GAP = 8;

const icons = {
	ask: (
		<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M21 12a8 8 0 11-3.1-6.3M12 8v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	),
	rename: (
		<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M4 20h16M5.5 15.5L15 6a2.1 2.1 0 013 3l-9.5 9.5-4 1 1-4z" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	),
	copy: (
		<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="9" y="9" width="12" height="12" rx="2" />
			<path d="M15 5H5a2 2 0 00-2 2v10" strokeLinecap="round" />
		</svg>
	),
	mockup: (
		<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="4" y="2" width="7" height="20" rx="2" />
			<rect x="14" y="6" width="7" height="16" rx="2" />
		</svg>
	),
	remove: (
		<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	),
};

function MenuItem({
	icon,
	label,
	danger,
	onClick,
}: {
	icon: JSX.Element;
	label: string;
	danger?: boolean;
	onClick(): void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
				danger ? "text-red-500 hover:bg-red-500/10" : "text-foreground hover:bg-accent"
			}`}
		>
			{icon}
			<span className="truncate">{label}</span>
		</button>
	);
}

/**
 * Frame 的右键菜单。定位用的是画布容器内坐标而不是世界坐标——菜单不该跟着画布
 * 缩放一起放大，所以它挂在 world 变换之外。
 */
export function FrameContextMenu({
	anchor,
	onAsk,
	onRename,
	onCopyImage,
	onExportMockup,
	onDelete,
	onClose,
}: FrameContextMenuProps) {
	const { t } = useTranslation();
	const ref = useRef<HTMLDivElement | null>(null);
	const [position, setPosition] = useState({ x: anchor.x, y: anchor.y });

	// 贴着容器右/下边缘弹出时会被裁掉，量完真实尺寸再夹回可视区。
	useLayoutEffect(() => {
		const element = ref.current;
		const parent = element?.offsetParent as HTMLElement | null;
		if (!element || !parent) return;
		const maxX = parent.clientWidth - element.offsetWidth - EDGE_GAP;
		const maxY = parent.clientHeight - element.offsetHeight - EDGE_GAP;
		setPosition({
			x: Math.max(EDGE_GAP, Math.min(anchor.x, maxX)),
			y: Math.max(EDGE_GAP, Math.min(anchor.y, maxY)),
		});
	}, [anchor.x, anchor.y]);

	// 点别处 / Esc / 滚动画布都关掉。捕获阶段监听：画布根节点在 pointerdown 时会
	// setPointerCapture，冒泡阶段这条事件已经改派走了。
	useEffect(() => {
		const onPointerDown = (event: PointerEvent): void => {
			if (ref.current?.contains(event.target as Node)) return;
			onClose();
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
			}
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("wheel", onClose, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("wheel", onClose, true);
		};
	}, [onClose]);

	return (
		<div
			ref={ref}
			// 画布根节点是 select-none，菜单里的文字保持可读的常规样式即可。
			className="absolute z-40 min-w-40 rounded-xl border border-border bg-card p-1 shadow-xl"
			style={{ left: position.x, top: position.y }}
			// 菜单落在画布之上，别让指针手势穿到画布去（平移 / 框选）。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
			onContextMenu={(event) => event.preventDefault()}
		>
			<MenuItem icon={icons.ask} label={t("canvas.frame.menu.ask")} onClick={onAsk} />
			<MenuItem icon={icons.rename} label={t("canvas.frame.menu.rename")} onClick={onRename} />
			<MenuItem icon={icons.copy} label={t("canvas.frame.menu.copyImage")} onClick={onCopyImage} />
			<MenuItem icon={icons.mockup} label={t("canvas.frame.menu.exportMockup")} onClick={onExportMockup} />
			<div className="my-1 h-px bg-border" />
			<MenuItem icon={icons.remove} label={t("canvas.frame.menu.delete")} danger onClick={onDelete} />
		</div>
	);
}
