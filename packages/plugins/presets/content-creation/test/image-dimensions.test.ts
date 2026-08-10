import { afterEach, describe, expect, it, vi } from "vitest";
import { inferImageDimensionsFromBase64 } from "../src/generation/image-dimensions";

describe("inferImageDimensionsFromBase64", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("decodes dimensions from legacy image content", async () => {
		const close = vi.fn();
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn().mockResolvedValue({ width: 1080, height: 1920, close }),
		);

		await expect(inferImageDimensionsFromBase64("AQID", "image/webp")).resolves.toEqual({
			width: 1080,
			height: 1920,
		});
		expect(close).toHaveBeenCalledOnce();
	});

	it("ignores non-image content", async () => {
		const createBitmap = vi.fn();
		vi.stubGlobal("createImageBitmap", createBitmap);

		await expect(inferImageDimensionsFromBase64("AQID", "video/mp4")).resolves.toBeUndefined();
		expect(createBitmap).not.toHaveBeenCalled();
	});
});
