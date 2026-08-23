import { useTranslation } from "@astravia-org/plugin-sdk";
import type { ReactNode } from "react";
import { NotesVisibilitySwitch } from "./NotesVisibilitySwitch";

interface CanvasCornerActionsProps {
	/** 查看模式的横幅压在画布顶部，按钮组要给它让位。 */
	offsetTop: number;
	historyOpen: boolean;
	/** 备注气泡在不在画布上（开关在这组的最左端）。 */
	notesVisible: boolean;
	onToggleNotes(): void;
	onRefresh(): void;
	onExport(): void;
	onToggleHistory(): void;
	/** 运行（进预览模式）：这组最右端，也是整组唯一的主色按钮。 */
	onRun(): void;
	runDisabled: boolean;
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
	run: (
		<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M6 4l12 8-12 8V4z" strokeLinejoin="round" />
		</svg>
	),
};

function Divider() {
	return <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />;
}

function Action({
	label,
	showLabel = false,
	active,
	onClick,
	children,
}: {
	label: string;
	/** true 时把 label 写在图标右边（打开面板类的动作，纯 icon 认不出来）。 */
	showLabel?: boolean;
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
			className={`flex h-7 items-center justify-center rounded-md transition-colors ${
				showLabel ? "gap-1.5 px-2 text-xs font-medium" : "w-7"
			} ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
		>
			{children}
			{showLabel ? <span className="whitespace-nowrap">{label}</span> : null}
		</button>
	);
}

/**
 * 画布右上角的动作按钮组：备注显隐 | 刷新 / 导出渲染图 / 版本历史 | 运行。
 *
 * 不放进 ControlBar：那一排是「用什么工具画」（选择、拖手、画框、备注、缩放），
 * 这些不是画布工具，混进去还会让本来就长的 dock 再长一截。
 */
export function CanvasCornerActions({
	offsetTop,
	historyOpen,
	notesVisible,
	onToggleNotes,
	onRefresh,
	onExport,
	onToggleHistory,
	onRun,
	runDisabled,
}: CanvasCornerActionsProps) {
	const { t } = useTranslation();
	return (
		<div
			style={{ top: 12 + offsetTop }}
			className="pointer-events-auto absolute right-3 z-40 flex items-center gap-0.5 rounded-lg border border-border bg-popover/90 p-0.5 backdrop-blur-xl"
			// 同历史抽屉：不截断的话画布根会捕获指针，按钮点不动。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
		>
			{/* 备注显隐：隐藏只有这一个入口（自动规则一律只往显示推）。 */}
			<NotesVisibilitySwitch visible={notesVisible} onToggle={onToggleNotes} />
			<Divider />
			<Action label={t("canvas.refresh")} active={false} onClick={onRefresh}>
				{icons.refresh}
			</Action>
			<Action label={t("controlbar.history")} showLabel active={historyOpen} onClick={onToggleHistory}>
				{icons.history}
			</Action>
			<Action label={t("controlbar.exportMockup.label")} showLabel active={false} onClick={onExport}>
				{icons.export}
			</Action>
			<Divider />
			{/* 运行带文字：它是这组里唯一一个「进入另一种模式」的动作，纯 icon 认不出来。 */}
			<button
				type="button"
				disabled={runDisabled}
				onClick={onRun}
				title={t("canvas.run")}
				className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
			>
				{icons.run}
				{t("canvas.run")}
			</button>
		</div>
	);
}
