export interface ContentCanvasViewportConfig {
	minZoom: number;
	maxZoom: number;
	defaultZoom: number;
}

export const DEFAULT_CONTENT_CANVAS_VIEWPORT: Readonly<ContentCanvasViewportConfig> = {
	minZoom: 0.1,
	maxZoom: 4,
	defaultZoom: 1,
};

/** Format React Flow zoom (1 = 100%) for the bottom-left controls. */
export function formatCanvasZoomPercent(zoom: number): string {
	if (!Number.isFinite(zoom)) return "100%";
	return `${Math.round(zoom * 100)}%`;
}
