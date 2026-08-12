export type ContentImageEditRegionKind = "rectangle" | "stroke" | "arrow" | "text";

export interface ContentImageEditPoint {
	x: number;
	y: number;
}

export interface ContentImageEditBounds {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ContentImageEditRegion {
	id: string;
	kind: ContentImageEditRegionKind;
	points: readonly ContentImageEditPoint[];
	bounds?: ContentImageEditBounds;
	text?: string;
	instruction?: string;
}

export interface ContentImageEditRequest {
	sourceAssetId: string;
	regions: readonly ContentImageEditRegion[];
	providerId: string;
	modelId: string;
}

export interface ContentImageEditModel {
	providerId: string;
	modelId: string;
}

export function findImageEditModel(
	models: readonly { providerId: string; modelId: string; outputKind: string; modes: readonly { id: string }[] }[],
	preferredProviderId?: string,
	preferredModelId?: string,
): ContentImageEditModel | undefined {
	if (preferredProviderId && preferredModelId) {
		const preferred = models.find(
			(model) =>
				model.outputKind === "image" &&
				model.providerId === preferredProviderId &&
				model.modelId === preferredModelId &&
				model.modes.some((mode) => mode.id === "image-to-image"),
		);
		if (preferred) return { providerId: preferred.providerId, modelId: preferred.modelId };
	}
	const fallback = models.find(
		(model) => model.outputKind === "image" && model.modes.some((mode) => mode.id === "image-to-image"),
	);
	return fallback ? { providerId: fallback.providerId, modelId: fallback.modelId } : undefined;
}

export function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function normalizePoint(point: ContentImageEditPoint): ContentImageEditPoint {
	return { x: clampUnit(point.x), y: clampUnit(point.y) };
}

export function normalizeBounds(a: ContentImageEditPoint, b: ContentImageEditPoint): ContentImageEditBounds {
	const start = normalizePoint(a);
	const end = normalizePoint(b);
	return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) };
}

export function regionBounds(region: ContentImageEditRegion): ContentImageEditBounds {
	if (region.bounds) return region.bounds;
	if (region.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
	const xs = region.points.map((point) => point.x);
	const ys = region.points.map((point) => point.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

export function serializeImageEditInstructions(regions: readonly ContentImageEditRegion[]): string {
	if (regions.length === 0) return "";
	const lines = regions.map((region, index) => {
		const bounds = regionBounds(region);
		const location = `x=${bounds.x.toFixed(3)}, y=${bounds.y.toFixed(3)}, w=${bounds.w.toFixed(3)}, h=${bounds.h.toFixed(3)}`;
		const label = region.kind === "stroke" ? "freehand mark" : region.kind;
		const instruction = region.instruction?.trim() || region.text?.trim() || "apply the requested edit";
		return `${index + 1}. ${label} at normalized bounds (${location}): ${instruction}`;
	});
	return ["Image editing instructions:", "Treat the marked regions as spatial instructions. Preserve the rest of the source image unless the instruction requires a change.", ...lines].join("\n");
}
