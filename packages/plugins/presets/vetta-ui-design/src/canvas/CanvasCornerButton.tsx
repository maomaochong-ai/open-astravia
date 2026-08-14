import type { ReactNode } from "react";

interface CanvasCornerButtonProps {
	label: string;
	/** 对应的面板/弹窗开着时高亮。没有开合态的动作传 false。 */
	active: boolean;
	/** 距画布顶部的距离，已含查看模式横幅的让位量。 */
	top: number;
	onClick(): void;
	children: ReactNode;
}

/**
 * 画布右上角的独立动作按钮（版本历史、导出渲染图）。
 *
 * 不放进 ControlBar：那一排是「用什么工具画」（选择、拖手、画框、备注、缩放），
 * 这些不是画布工具，混进去还会让本来就长的 dock 再长一截。样式收在这里而不是
 * 各自抄一遍，是因为它们竖着叠在同一列，尺寸和底色一旦分叉立刻看得出来。
 */
export function CanvasCornerButton({ label, active, top, onClick, children }: CanvasCornerButtonProps) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
			// 同历史抽屉：不截断的话画布根会捕获指针，按钮点不动。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
			style={{ top }}
			className={`pointer-events-auto absolute right-3 z-40 flex size-8 items-center justify-center rounded-lg border shadow-sm backdrop-blur-xl transition-colors ${
				active
					? "border-primary/40 bg-primary/10 text-primary"
					: "border-border/60 bg-popover/90 text-muted-foreground hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}
