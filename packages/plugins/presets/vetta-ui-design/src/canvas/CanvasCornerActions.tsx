import { useTranslation } from "@vetta-org/plugin-sdk";
import type { ReactNode } from "react";

interface CanvasCornerActionsProps {
	/** 查看模式的横幅压在画布顶部，按钮组要给它让位。 */
	offsetTop: number;
	historyOpen: boolean;
	onRefresh(): void;
	onExport(): void;
	onToggleHistory(): void;
}

const icons = {
	refresh: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
			<path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	),
	export: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
			<path d="M12 3v12" strokeLinecap="round" />
			<path d="M8 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M4 14v4a3 3 0 003 3h10a3 3 0 003-3v-4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	),
	history: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
			<path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	),
};

function Action({
	label,
	active,
	onClick,
	children,
}: {
	label: string;
	/** 对应面板开着时高亮；一次性动作传 false。 */
	active: boolean;
	onClick(): void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={active}
			onClick={onClick}
			className={`flex size-7 items-center justify-center rounded-md transition-colors ${
				active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}

/**
 * 画布右上角的动作按钮组（刷新 / 导出渲染图 / 版本历史）。
 *
 * 不放进 ControlBar：那一排是「用什么工具画」（选择、拖手、画框、备注、缩放），
 * 这三个不是画布工具，混进去还会让本来就长的 dock 再长一截。
 */
export function CanvasCornerActions({
	offsetTop,
	historyOpen,
	onRefresh,
	onExport,
	onToggleHistory,
}: CanvasCornerActionsProps) {
	const { t } = useTranslation();
	return (
		<div
			style={{ top: 12 + offsetTop }}
			className="pointer-events-auto absolute right-3 z-40 flex items-center gap-0.5 rounded-lg border border-border/60 bg-popover/90 p-0.5 shadow-sm backdrop-blur-xl"
			// 同历史抽屉：不截断的话画布根会捕获指针，按钮点不动。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
		>
			<Action label={t("canvas.refresh")} active={false} onClick={onRefresh}>
				{icons.refresh}
			</Action>
			<Action label={t("controlbar.exportMockup.label")} active={false} onClick={onExport}>
				{icons.export}
			</Action>
			<Action label={t("controlbar.history")} active={historyOpen} onClick={onToggleHistory}>
				{icons.history}
			</Action>
		</div>
	);
}
