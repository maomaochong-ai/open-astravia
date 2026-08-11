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
