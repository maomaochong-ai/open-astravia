import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useRef } from "react";
import { layoutMockup } from "./layout";
import { renderMockup } from "./render";
import type { MockupOptions, MockupShot } from "./types";

/** 工作台里正在拖的东西：来自左侧缩略图列表，或渲染区里已有的一格。 */
export type MockupDrag = { kind: "rail"; frameId: string } | { kind: "shot"; index: number };

interface MockupPageProps {
	/** 本页的画框，已按导出顺序切好。 */
	shots: MockupShot[];
	/** 本页第一格在整个序列里的下标——回调一律用全局下标，页只是它的一个视图。 */
	offset: number;
	/** 本页留几格。末页画框不满时空位照样占宽，多页叠起来才对得齐。 */
	slots: number;
	options: MockupOptions;
	brandLogo: CanvasImageSource | null;
	/** Per-shot capture error, keyed by frame id. */
	errors: ReadonlyMap<string, string>;
	/** 世界坐标到屏幕的缩放比，由工作台的视口统一给。 */
	scale: number;
	selectedFrameId: string | null;
	drag: MockupDrag | null;
	onSelect(frameId: string | null): void;
	onRetry(frameId: string): void;
	onDragShot(index: number): void;
	onDragEnd(): void;
	/** 落在某一格上：来自列表就插到它前面，来自渲染区就与它互换。 */
	onDropAt(index: number): void;
}

/**
 * 一页渲染图，由导出用的同一个渲染器画出来。命中区不重复推导几何：
 * layout 的 rects 再以透明 div 铺一层，负责选中、拖拽换位和重试入口。
 */
export function MockupPage({
	shots,
	offset,
	slots,
	options,
	brandLogo,
	errors,
	scale,
	selectedFrameId,
	drag,
	onSelect,
	onRetry,
	onDragShot,
	onDragEnd,
	onDropAt,
}: MockupPageProps) {
	const { t } = useTranslation();
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const layout = useMemo(() => layoutMockup(shots, options, slots), [shots, options, slots]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || scale <= 0 || layout.width <= 0) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.round(layout.width * scale * dpr));
		canvas.height = Math.max(1, Math.round(layout.height * scale * dpr));
		const g = canvas.getContext("2d");
		// happy-dom / 无 GPU 环境下拿不到 2D 上下文：不画就是了，命中区照旧可用。
		if (!g) return;
		renderMockup(g, shots, options, layout, scale * dpr, brandLogo);
	}, [shots, options, layout, scale, brandLogo]);

	if (layout.width <= 0) return null;

	return (
		<div
			className={`relative ${options.transparent ? "vetd-checkerboard" : ""}`}
			style={{ width: layout.width * scale, height: layout.height * scale }}
		>
			<canvas ref={canvasRef} className="block h-full w-full" aria-label={t("mockup.preview.alt")} role="img" />
			{layout.rects.map((rect, index) => {
				const shot = shots[index];
				if (!shot) return null;
				const globalIndex = offset + index;
				const error = errors.get(shot.frameId);
				const selected = selectedFrameId === shot.frameId;
				const dragging = drag?.kind === "shot" && drag.index === globalIndex;
				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: drag/选中面板铺在 canvas 上，语义由右侧选项区承担
					<div
						key={shot.frameId}
						draggable={!error}
						aria-label={shot.title}
						onDragStart={() => onDragShot(globalIndex)}
						onDragEnd={onDragEnd}
						onDragOver={(event) => {
							if (!drag) return;
							event.preventDefault();
							event.stopPropagation();
						}}
						onDrop={(event) => {
							event.preventDefault();
							event.stopPropagation();
							onDropAt(globalIndex);
						}}
						// 指针事件不能上浮到预览区：那层会把拖动当成平移画布。
						onPointerDown={(event) => event.stopPropagation()}
						onClick={() => onSelect(selected ? null : shot.frameId)}
						title={shot.title}
						className={`absolute flex items-center justify-center rounded-md transition-colors ${
							error
								? "bg-black/55"
								: dragging
									? "cursor-grabbing opacity-60"
									: selected
										? "cursor-grab ring-2 ring-primary"
										: "cursor-grab hover:ring-2 hover:ring-primary/50"
						}`}
						style={{
							left: rect.x * scale,
							top: rect.y * scale,
							width: rect.width * scale,
							height: rect.height * scale,
						}}
					>
						{error ? (
							<div className="flex flex-col items-center gap-2 p-3 text-center">
								<span className="text-xs font-medium text-white">{t("mockup.shot.failed")}</span>
								<span className="line-clamp-2 text-[10px] text-white/70">{error}</span>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										onRetry(shot.frameId);
									}}
									className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
								>
									{t("mockup.shot.retry")}
								</button>
							</div>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
