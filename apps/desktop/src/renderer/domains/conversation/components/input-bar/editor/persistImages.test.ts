// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	persistImageFiles: vi.fn(),
	recordInputImagesAdded: vi.fn(),
}));

vi.mock("@shared/lib/app-monitor-events", () => ({
	recordInputImagesAdded: mocks.recordInputImagesAdded,
}));

const { persistImageFiles } = await import("./persistImages");

describe("persistImageFiles", () => {
	beforeEach(() => {
		mocks.persistImageFiles.mockReset();
		mocks.recordInputImagesAdded.mockClear();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { dialog: { persistImageFiles: mocks.persistImageFiles } },
		});
	});

	it("hands File objects to preload without constructing base64 data URLs", async () => {
		const fileReader = vi.spyOn(globalThis, "FileReader");
		const files = [new File([Uint8Array.from([1, 2, 3])], "one.png", { type: "image/png" })];
		const persisted = [{ path: "C:/cache/one.png", format: "png", sizeBytes: 3, width: 1, height: 1 }];
		mocks.persistImageFiles.mockResolvedValue(persisted);

		await expect(persistImageFiles(files, null, "paste")).resolves.toEqual(["C:/cache/one.png"]);

		expect(fileReader).not.toHaveBeenCalled();
		expect(mocks.persistImageFiles).toHaveBeenCalledWith("draft", files);
		expect(mocks.recordInputImagesAdded).toHaveBeenCalledWith("paste", persisted);
		fileReader.mockRestore();
	});
});
