export type CanvasTool = "select" | "pan";

export const DEFAULT_CANVAS_TOOL: CanvasTool = "pan";

export function getCanvasInteraction(tool: CanvasTool): {
	selectionOnDrag: boolean;
	panOnDrag: boolean;
} {
	return {
		selectionOnDrag: tool === "select",
		panOnDrag: tool === "pan",
	};
}
