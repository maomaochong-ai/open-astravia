// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/canvas/raster-cache", () => ({
	loadRasters: async () => new Map([["frame", "data:image/jpeg;fake"]]),
	saveCover: vi.fn(),
}));

import { composeCover } from "../src/canvas/cover-compose";

afterEach(() => vi.unstubAllGlobals());

describe("gallery cover cancellation", () => {
	it("stops decoding after leaving and never paints a cancelled cover", async () => {
		let imageStarted!: () => void;
		const started = new Promise<void>((resolve) => { imageStarted = resolve; });
		const sourceChanges: string[] = [];
		vi.stubGlobal("Image", class {
			onload: (() => void) | null = null;
			onerror: (() => void) | null = null;
			set src(value: string) {
				sourceChanges.push(value);
				if (value) imageStarted();
			}
		});
		const createElement = vi.spyOn(document, "createElement");
		const controller = new AbortController();
		const pending = composeCover(
			"/work/design.vetd",
			[{
				id: "frame", file: "frames/frame.tsx", title: "Frame",
				x: 0, y: 0, width: 100, height: 100,
				meta: { width: 100, height: 100, title: "Frame" },
			}],
			controller.signal,
		);
		await started;
		controller.abort();
		expect(await pending).toBeNull();
		expect(sourceChanges).toEqual(["data:image/jpeg;fake", ""]);
		expect(createElement).not.toHaveBeenCalledWith("canvas");
		createElement.mockRestore();
	});
});
