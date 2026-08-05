import { useTranslation } from "@vetta-org/plugin-sdk";
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { DOCK_GAP, DOCK_ICON, dockMagnifyScale, dockTransition, usePrefersReducedMotion } from "./dock-magnify";

export type CanvasTool = "select" | "hand" | "frame";

interface ControlBarProps {
	tool: CanvasTool;
	zoom: number;
	/** Number of frames the export action would act on; 0 hides the button. */
	exportableCount: number;
	/** 设计体系抽屉开着时高亮按钮，同时整条工具栏淡出让位（见 faded）。 */
	designSystemsActive: boolean;
	/** 抽屉升起时工具栏淡出（不上推，避免布局跳动），关闭后恢复。 */
	faded: boolean;
	onToolChange(tool: CanvasTool): void;
	onZoomDelta(direction: 1 | -1): void;
	onZoomReset(): void;
	onExport(): void;
	onDesignSystems(): void;
}

type DockSlot =
	| { type: "divider"; key: string }
	| {
			type: "item";
			key: string;
			label: string;
			active: boolean;
			/** 主题色底的动作项（导出），与前面的工具按钮拉开层次。 */
			accent?: boolean;
			/** 非等宽项（缩放百分比、导出）：撑开宽度而不是锁死成方块。 */
			wide?: boolean;
			onClick(): void;
			content: ReactNode;
	  };

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
	mockup: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="4" y="2" width="7" height="20" rx="2" />
			<rect x="14" y="6" width="7" height="16" rx="2" />
		</svg>
	),
	swatches: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M7 3h4v14a2 2 0 11-4 0V3z" strokeLinejoin="round" />
			<path d="M11 8l3.5-3.5a1 1 0 011.4 0l2.1 2.1a1 1 0 010 1.4L11 15" strokeLinejoin="round" />
			<path d="M13 21h7a1 1 0 001-1v-3a1 1 0 00-1-1h-3" strokeLinejoin="round" />
			<circle cx="9" cy="17" r="0.5" fill="currentColor" />
		</svg>
	),
	minus: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M5 12h14" strokeLinecap="round" />
		</svg>
	),
	plus: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 5v14M5 12h14" strokeLinecap="round" />
		</svg>
	),
};

/**
 * 画布左下角固定的工具栏（选择 / 托手 / 画框 / 缩放）。底部中间留给「让 Vetta 调整」。
 * 视觉与动效对齐 content-creation 画布的 dock：图标方块 + 光标处放大 + 峰值项浮标签。
 */
export function ControlBar({
	tool,
	zoom,
	exportableCount,
	designSystemsActive,
	faded,
	onToolChange,
	onZoomDelta,
	onZoomReset,
	onExport,
	onDesignSystems,
}: ControlBarProps) {
	const { t } = useTranslation();
	const dockRef = useRef<HTMLDivElement>(null);
	const slotRefs = useRef<(HTMLElement | null)[]>([]);
	/** 放大只走 transform，布局宽度不变，所以中心点测一次即可缓存。 */
	const centersRef = useRef<number[] | null>(null);
	const [scales, setScales] = useState<number[]>([]);
	const reducedMotion = usePrefersReducedMotion();

	const slots = useMemo<DockSlot[]>(() => {
		const items: DockSlot[] = [
			{
				type: "item",
				key: "select",
				label: t("controlbar.select"),
				active: tool === "select",
				onClick: () => onToolChange("select"),
				content: icons.select,
			},
			{
				type: "item",
				key: "hand",
				label: t("controlbar.hand"),
				active: tool === "hand",
				onClick: () => onToolChange("hand"),
				content: icons.hand,
			},
			{
				type: "item",
				key: "frame",
				label: t("controlbar.frame"),
				active: tool === "frame",
				onClick: () => onToolChange("frame"),
				content: icons.frame,
			},
			{
				type: "item",
				key: "design-systems",
				label: t("controlbar.designSystems"),
				active: designSystemsActive,
				onClick: onDesignSystems,
				content: icons.swatches,
			},
			{ type: "divider", key: "divider-zoom" },
			{
				type: "item",
				key: "zoom-out",
				label: t("controlbar.zoomOut"),
				active: false,
				onClick: () => onZoomDelta(-1),
				content: icons.minus,
			},
			{
				type: "item",
				key: "zoom-value",
				label: t("controlbar.zoomReset"),
				active: false,
				wide: true,
				onClick: onZoomReset,
				content: <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>,
			},
			{
				type: "item",
				key: "zoom-in",
				label: t("controlbar.zoomIn"),
				active: false,
				onClick: () => onZoomDelta(1),
				content: icons.plus,
			},
		];
		if (exportableCount > 0) {
			items.push({ type: "divider", key: "divider-export" });
			items.push({
				type: "item",
				key: "export",
				label: t("controlbar.exportMockup", { count: exportableCount }),
				active: false,
				accent: true,
				wide: true,
				onClick: onExport,
				content: (
					<span className="flex items-center gap-1.5 text-xs font-medium">
						{icons.mockup}
						{t("controlbar.exportMockup.label")}
					</span>
				),
			});
		}
		return items;
	}, [
		designSystemsActive,
		exportableCount,
		onDesignSystems,
		onExport,
		onToolChange,
		onZoomDelta,
		onZoomReset,
		t,
		tool,
		zoom,
	]);

	/** 条目增删或百分比换位数都会挪动中心点，缓存作废。 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在布局宽度可能变化时作废缓存
	useEffect(() => {
		centersRef.current = null;
	}, [slots.length, zoom]);

	const resetMagnify = () => {
		setScales([]);
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (reducedMotion) return;
		const dock = dockRef.current;
		if (!dock) return;
		const centers = (centersRef.current ??= slotRefs.current.map((element) =>
			element ? element.offsetLeft + element.offsetWidth / 2 : Number.POSITIVE_INFINITY,
		));
		const x = event.clientX - dock.getBoundingClientRect().left;
		setScales(
			centers.map((center, index) => (slots[index]?.type === "divider" ? 1 : dockMagnifyScale(Math.abs(x - center)))),
		);
	};

	const peakIndex = useMemo(() => {
		let best = -1;
		let bestScale = 1.04;
		scales.forEach((scale, index) => {
			if (slots[index]?.type === "divider") return;
			if (scale > bestScale) {
				bestScale = scale;
				best = index;
			}
		});
		return best;
	}, [scales, slots]);

	const peakSlot = peakIndex >= 0 ? slots[peakIndex] : undefined;
	const peakLabel = peakSlot?.type === "item" ? peakSlot.label : null;

	return (
		// 左下角：底部中间留给「让 Vetta 调整」，顶部整条是画布自己的沉浸式标题栏
		// （CanvasTab 里那层约 58px 高的渐变遮罩，z-30），工具栏放上去会被罩住。
		// 外层不吃指针：放大溢出与浮标签留的空白区不能挡住画布手势。
		<div
			className={`pointer-events-none absolute bottom-6 left-6 z-30 transition-opacity duration-200 ${
				faded ? "opacity-0" : ""
			}`}
		>
			{/* 放大只用 transform（origin-bottom），图标向上溢出 dock，chrome 本身不变高 */}
			<div className="relative inline-flex flex-col items-start overflow-visible pt-9">
				{peakLabel ? (
					<div
						className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-border/70 bg-popover/95 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-popover-foreground shadow-sm"
						style={{ left: centersRef.current?.[peakIndex] }}
					>
						{peakLabel}
					</div>
				) : null}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: swallow canvas gestures under the bar */}
				<div
					ref={dockRef}
					className={`relative inline-flex items-end overflow-visible rounded-2xl border border-border/80 bg-popover/90 px-2 py-1.5 shadow-md backdrop-blur-md ${
						faded ? "pointer-events-none" : "pointer-events-auto"
					}`}
					style={{ gap: DOCK_GAP }}
					// 托手/空格态下画布根节点会在 pointerdown 时 setPointerCapture 接管平移，
					// 指针捕获会把 click 改派给画布根，工具栏按钮就永远点不动了（切不回选择工具）。
					onPointerDown={(event) => event.stopPropagation()}
					onPointerMove={(event) => {
						event.stopPropagation();
						handlePointerMove(event);
					}}
					onPointerUp={(event) => event.stopPropagation()}
					onPointerLeave={resetMagnify}
				>
					{slots.map((slot, index) => {
						if (slot.type === "divider") {
							return (
								<span
									key={slot.key}
									ref={(element) => {
										slotRefs.current[index] = element;
									}}
									className="w-px shrink-0 self-center bg-border"
									style={{ height: DOCK_ICON * 0.55 }}
									aria-hidden
								/>
							);
						}

						const scale = scales[index] ?? 1;
						return (
							<button
								key={slot.key}
								ref={(element) => {
									slotRefs.current[index] = element;
								}}
								type="button"
								title={slot.label}
								aria-label={slot.label}
								aria-pressed={slot.active}
								onClick={slot.onClick}
								className={`relative z-[1] flex shrink-0 origin-bottom items-center justify-center rounded-[22%] border border-transparent outline-none will-change-transform focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 ${
									slot.active || slot.accent
										? "bg-primary/12 text-primary"
										: "bg-muted/55 text-foreground hover:bg-muted"
								} ${slot.wide ? "px-2.5" : ""} ${scale > 1.02 ? "z-[2]" : ""}`}
								style={{
									width: slot.wide ? undefined : DOCK_ICON,
									minWidth: slot.wide ? DOCK_ICON + 12 : undefined,
									height: DOCK_ICON,
									transform: `scale(${scale})`,
									transition: dockTransition(reducedMotion),
								}}
							>
								{slot.content}
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
