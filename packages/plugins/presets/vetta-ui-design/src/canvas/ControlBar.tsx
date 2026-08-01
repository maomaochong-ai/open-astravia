import { useTranslation } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";

export type CanvasTool = "select" | "hand" | "frame";

interface ControlBarProps {
	tool: CanvasTool;
	zoom: number;
	/** Number of frames the export action would act on; 0 hides the button. */
	exportableCount: number;
	/** frame 内的 backdrop-filter / filter 是否生效（关掉可救合成器，见 style 注释）。 */
	effectsEnabled: boolean;
	onToolChange(tool: CanvasTool): void;
	onZoomDelta(direction: 1 | -1): void;
	onZoomReset(): void;
	onToggleEffects(): void;
	onExport(): void;
}

function ToolButton({
	active,
	title,
	onClick,
	children,
}: {
	active: boolean;
	title: string;
	onClick(): void;
	children: JSX.Element;
}) {
	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			aria-pressed={active}
			onClick={onClick}
			className={`flex size-8 items-center justify-center rounded-lg transition-colors ${
				active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
			}`}
		>
			{children}
		</button>
	);
}

const icons = {
	select: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M4 3l7 17 2.5-7.5L21 10 4 3z" strokeLinejoin="round" />
		</svg>
	),
	hand: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path
				d="M8 12V6.5a1.5 1.5 0 013 0V11m0-5.5v-1a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V13m-9-1.5v-1a1.5 1.5 0 00-3 0V15a6 6 0 006 6h1a6 6 0 006-6v-2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	),
	frame: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M6 2v20M18 2v20M2 6h20M2 18h20" strokeLinecap="round" />
		</svg>
	),
	effects: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 3c3.5 4 5.5 6.5 5.5 9a5.5 5.5 0 01-11 0c0-2.5 2-5 5.5-9z" strokeLinejoin="round" />
		</svg>
	),
	mockup: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="4" y="2" width="7" height="20" rx="2" />
			<rect x="14" y="6" width="7" height="16" rx="2" />
		</svg>
	),
};

/** Fixed control bar at the bottom of the canvas panel (select / hand / frame / zoom). */
export function ControlBar({
	tool,
	zoom,
	exportableCount,
	effectsEnabled,
	onToolChange,
	onZoomDelta,
	onZoomReset,
	onToggleEffects,
	onExport,
}: ControlBarProps) {
	const { t } = useTranslation();
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: swallow canvas gestures under the bar
		<div
			className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card/95 px-1.5 py-1 shadow-lg"
			// 托手/空格态下画布根节点会在 pointerdown 时 setPointerCapture 接管平移，
			// 指针捕获会把 click 改派给画布根，工具栏按钮就永远点不动了（切不回选择工具）。
			onPointerDown={(event) => event.stopPropagation()}
			onPointerMove={(event) => event.stopPropagation()}
			onPointerUp={(event) => event.stopPropagation()}
		>
			<ToolButton active={tool === "select"} title={t("controlbar.select")} onClick={() => onToolChange("select")}>
				{icons.select}
			</ToolButton>
			<ToolButton active={tool === "hand"} title={t("controlbar.hand")} onClick={() => onToolChange("hand")}>
				{icons.hand}
			</ToolButton>
			<ToolButton active={tool === "frame"} title={t("controlbar.frame")} onClick={() => onToolChange("frame")}>
				{icons.frame}
			</ToolButton>
			<button
				type="button"
				title={effectsEnabled ? t("controlbar.effects.on") : t("controlbar.effects.off")}
				aria-label={effectsEnabled ? t("controlbar.effects.on") : t("controlbar.effects.off")}
				aria-pressed={!effectsEnabled}
				onClick={onToggleEffects}
				className={`flex size-8 items-center justify-center rounded-lg transition-colors ${
					effectsEnabled ? "text-muted-foreground hover:bg-accent" : "bg-amber-500/15 text-amber-600"
				}`}
			>
				{icons.effects}
			</button>
			<div className="mx-1 h-5 w-px bg-border" />
			<button
				type="button"
				title={t("controlbar.zoomOut")}
				aria-label={t("controlbar.zoomOut")}
				onClick={() => onZoomDelta(-1)}
				className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
			>
				<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
					<path d="M5 12h14" strokeLinecap="round" />
				</svg>
			</button>
			<button
				type="button"
				title={t("controlbar.zoomReset")}
				onClick={onZoomReset}
				className="min-w-12 rounded-lg px-1 py-1.5 text-center text-xs tabular-nums text-foreground hover:bg-accent"
			>
				{Math.round(zoom * 100)}%
			</button>
			<button
				type="button"
				title={t("controlbar.zoomIn")}
				aria-label={t("controlbar.zoomIn")}
				onClick={() => onZoomDelta(1)}
				className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
			>
				<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
					<path d="M12 5v14M5 12h14" strokeLinecap="round" />
				</svg>
			</button>
			{exportableCount > 0 ? (
				<>
					<div className="mx-1 h-5 w-px bg-border" />
					{/* 带文字：纯 icon 在这排工具里认不出来，而它是选中后才出现的动作，
					    用主题色淡底与前面的工具按钮拉开层次。 */}
					<button
						type="button"
						title={t("controlbar.exportMockup", { count: exportableCount })}
						onClick={onExport}
						className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
					>
						{icons.mockup}
						{t("controlbar.exportMockup.label")}
					</button>
				</>
			) : null}
		</div>
	);
}
