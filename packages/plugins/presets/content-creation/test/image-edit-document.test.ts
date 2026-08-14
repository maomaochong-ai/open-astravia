import { describe, expect, it } from "vitest";
import {
	findImageEditModel,
	normalizeBounds,
	normalizePoint,
	serializeImageEditInstructions,
	type ContentImageEditRegion,
} from "../src/image-edit/image-edit-document";

describe("image edit document", () => {
	it("normalizes canvas coordinates and bounds", () => {
		expect(normalizePoint({ x: -0.2, y: 1.4 })).toEqual({ x: 0, y: 1 });
		expect(normalizeBounds({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 })).toEqual({
			x: 0.2,
			y: 0.1,
			w: 0.6000000000000001,
			h: 0.6,
		});
	});

	it("serializes spatial instructions without coupling to a provider", () => {
		const regions: ContentImageEditRegion[] = [{
			id: "region-1",
			kind: "rectangle",
			points: [{ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.8 }],
			bounds: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
			instruction: "replace the shirt with a red jacket",
		}];
		const result = serializeImageEditInstructions(regions);
		expect(result).toContain("normalized bounds");
		expect(result).toContain("replace the shirt with a red jacket");
		expect(result).toContain("Preserve the rest");
	});

	it("prefers a configured image-to-image model and falls back by capability", () => {
		const models = [
			{ providerId: "text", modelId: "text", outputKind: "image", modes: [{ id: "text-to-image" }] },
			{ providerId: "edit", modelId: "edit", outputKind: "image", modes: [{ id: "image-to-image" }] },
		];
		expect(findImageEditModel(models, "edit", "edit")).toEqual({ providerId: "edit", modelId: "edit" });
		expect(findImageEditModel(models, "text", "text")).toEqual({ providerId: "edit", modelId: "edit" });
	});
});
