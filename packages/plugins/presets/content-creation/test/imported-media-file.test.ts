import { afterEach, describe, expect, it, vi } from "vitest";
import { createImportedMediaFile } from "../src/node/imported-media-file";

describe("createImportedMediaFile", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("captures decoded image dimensions for automatic video aspect ratios", async () => {
		const close = vi.fn();
		vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1080, height: 1920, close }));
		const file = new File(["image"], "portrait.png", { type: "image/png" });

		await expect(createImportedMediaFile(file)).resolves.toMatchObject({
			name: "portrait.png",
			mimeType: "image/png",
			width: 1080,
			height: 1920,
			file,
		});
		expect(close).toHaveBeenCalledOnce();
	});

	it("still imports an image when dimension decoding fails", async () => {
		vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode failed")));
		const file = new File(["image"], "damaged.png", { type: "image/png" });

		await expect(createImportedMediaFile(file)).resolves.toEqual({
			name: "damaged.png",
			mimeType: "image/png",
			file,
		});
	});
});
