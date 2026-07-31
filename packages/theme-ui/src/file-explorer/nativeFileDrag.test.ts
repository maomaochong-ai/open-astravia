import { describe, expect, it, vi } from "vitest";
import { beginNativeFileDrag } from "./nativeFileDrag";

describe("beginNativeFileDrag", () => {
	it("cancels the HTML drag before starting Electron native drag", () => {
		const calls: string[] = [];
		const preventDefault = vi.fn(() => calls.push("prevent-default"));
		const startDrag = vi.fn(() => calls.push("start-native"));

		beginNativeFileDrag({ preventDefault }, "C:\\project\\report.txt", startDrag);

		expect(calls).toEqual(["prevent-default", "start-native"]);
		expect(startDrag).toHaveBeenCalledWith(["C:\\project\\report.txt"]);
	});
});
