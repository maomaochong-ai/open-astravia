// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForCommittedPaint } from "./committed-paint";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("waitForCommittedPaint", () => {
	it("waits for two animation frames before releasing secondary work", async () => {
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});
		const barrier = waitForCommittedPaint();
		let result: string | undefined;
		void barrier.then((value) => {
			result = value;
		});

		frames.shift()?.(0);
		await Promise.resolve();
		expect(result).toBeUndefined();
		frames.shift()?.(16);

		await expect(barrier).resolves.toBe("painted");
	});

	it("does not wait for a paint when the window is hidden", async () => {
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		const requestFrame = vi.spyOn(window, "requestAnimationFrame");

		await expect(waitForCommittedPaint()).resolves.toBe("skipped-hidden");
		expect(requestFrame).not.toHaveBeenCalled();
	});
});
