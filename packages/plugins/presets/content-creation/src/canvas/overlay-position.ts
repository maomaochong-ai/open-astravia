export interface CanvasOverlayPosition {
	left: number;
	top: number;
}

interface CanvasOverlaySize {
	width: number;
	height: number;
}

export function clampCanvasOverlayPosition(
	position: CanvasOverlayPosition,
	overlay: CanvasOverlaySize,
	canvas: CanvasOverlaySize,
	margin = 8,
): CanvasOverlayPosition {
	return {
		left: Math.max(margin, Math.min(position.left, canvas.width - overlay.width - margin)),
		top: Math.max(margin, Math.min(position.top, canvas.height - overlay.height - margin)),
	};
}
