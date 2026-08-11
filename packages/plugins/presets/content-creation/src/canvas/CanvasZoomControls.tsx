import { useTranslation } from "@vetta-org/plugin-sdk";
import { ControlButton, Controls, useReactFlow, useStore } from "@xyflow/react";
import { formatCanvasZoomPercent } from "./canvas-viewport";

interface CanvasZoomControlsProps {
	defaultZoom?: number;
}

/**
 * Bottom-left zoom stack: + / current% / − / fit.
 * Percent sits between zoom in and out so the scale reads as one control group.
 */
export function CanvasZoomControls({ defaultZoom = 1 }: CanvasZoomControlsProps) {
	const { t } = useTranslation();
	const zoom = useStore((state) => state.transform[2]);
	const minZoomReached = useStore((state) => state.transform[2] <= state.minZoom);
	const maxZoomReached = useStore((state) => state.transform[2] >= state.maxZoom);
	const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
	const safeZoom = Number.isFinite(zoom) ? zoom : defaultZoom;
	const percent = Math.round(safeZoom * 100);
	const label = formatCanvasZoomPercent(safeZoom);

	return (
		<Controls showZoom={false} showFitView={false} showInteractive={false} position="bottom-left">
			<ControlButton
				className="react-flow__controls-zoomin"
				onClick={() => {
					void zoomIn();
				}}
				disabled={maxZoomReached}
				title={t("canvas.zoom.in")}
				aria-label={t("canvas.zoom.in")}
			>
				<span className="icon-[lucide--plus] block size-3.5" aria-hidden="true" />
			</ControlButton>
			<ControlButton
				className="content-creation-zoom-percent"
				// Inline width guards against unscoped RF stylesheet order winning on width: 26px.
				style={{ width: "100%", minWidth: 40, whiteSpace: "nowrap" }}
				onClick={() => {
					void zoomTo(defaultZoom, { duration: 180 });
				}}
				title={t("canvas.zoom.resetHint", { percent })}
				aria-label={t("canvas.zoom.current", { percent })}
			>
				<span className="content-creation-zoom-percent__label">{label}</span>
			</ControlButton>
			<ControlButton
				className="react-flow__controls-zoomout"
				onClick={() => {
					void zoomOut();
				}}
				disabled={minZoomReached}
				title={t("canvas.zoom.out")}
				aria-label={t("canvas.zoom.out")}
			>
				<span className="icon-[lucide--minus] block size-3.5" aria-hidden="true" />
			</ControlButton>
			<ControlButton
				className="react-flow__controls-fitview"
				onClick={() => {
					void fitView({ duration: 240, padding: 0.16 });
				}}
				title={t("canvas.zoom.fit")}
				aria-label={t("canvas.zoom.fit")}
			>
				<span className="icon-[lucide--scan] block size-3.5" aria-hidden="true" />
			</ControlButton>
		</Controls>
	);
}
