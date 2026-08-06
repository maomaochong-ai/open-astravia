import type { PointerEvent as ReactPointerEvent } from "react";
import type { GapBand } from "./arrange";

interface GapHandlesProps {
	bands: readonly GapBand[];
	/** 1 / zoom：命中区与线宽按它反向缩放，缝再窄也留得住可点的宽度。 */
	scale: number;
	/** 正在拖的那条缝，拖动期间指针早跑出命中区了，靠它把高亮钉住。 */
	active: { axis: "x" | "y"; index: number } | null;
	onDragStart(band: GapBand, event: ReactPointerEvent): void;
}

/** 命中区最小厚度（屏幕像素）：缝比这窄就往两边溢出，否则贴在一起的两列拉不开。 */
const MIN_HIT = 12;

/**
 * 选中集里各条缝上的拖拽手柄：横向拖改列间距，纵向拖改行间距。
 *
 * 手柄铺在 frame 之间的空白上，命中区必须自己拦住 pointerdown——那片地方在画布看来
 * 就是空白，不拦的话按下去等于起手框选，选中当场就没了。
 */
export function GapHandles({ bands, scale, active, onDragStart }: GapHandlesProps) {
	return (
		<>
			{bands.map((band) => {
				const vertical = band.axis === "x";
				const middle = (band.from + band.to) / 2;
				const hit = Math.max(band.to - band.from, MIN_HIT * scale);
				const isActive = active?.axis === band.axis && active.index === band.index;
				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: canvas manipulation surface
					<div
						key={`${band.axis}-${band.index}`}
						className="group absolute z-20"
						style={{
							cursor: vertical ? "col-resize" : "row-resize",
							...(vertical
								? {
										left: middle - hit / 2,
										top: band.crossFrom,
										width: hit,
										height: band.crossTo - band.crossFrom,
									}
								: {
										left: band.crossFrom,
										top: middle - hit / 2,
										width: band.crossTo - band.crossFrom,
										height: hit,
									}),
						}}
						onPointerDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
							onDragStart(band, event);
						}}
					>
						<div
							className={`pointer-events-none absolute bg-[var(--vetd-selected)] transition-opacity ${
								isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
							}`}
							style={
								vertical
									? { left: hit / 2 - scale, top: 0, width: scale * 2, height: "100%" }
									: { left: 0, top: hit / 2 - scale, width: "100%", height: scale * 2 }
							}
						/>
						<div
							className={`pointer-events-none absolute ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
							style={{
								left: vertical ? hit / 2 : "50%",
								top: vertical ? "50%" : hit / 2,
								transform: `scale(${scale})`,
								transformOrigin: "left top",
							}}
						>
							<span
								className="absolute whitespace-nowrap rounded-sm bg-[var(--vetd-selected)] px-1 text-[10px] leading-4 text-white"
								style={{ transform: "translate(-50%, -50%)" }}
							>
								{Math.round(band.to - band.from)}
							</span>
						</div>
					</div>
				);
			})}
		</>
	);
}
