import { describe, expect, it, vi } from "vitest";
import { beginNativeFileDrag } from "./nativeFileDrag";

describe("beginNativeFileDrag", () => {
	it("cancels the HTML drag before starting Electron native drag", () => {
		const calls: string[] = [];
		const preventDefault = vi.fn(() => calls.push("prevent-default"));
		const startDrag = vi.fn(() => calls.push("start-native"));

		beginNativeFileDrag({ preventDefault }, ["C:\\project\\report.txt"], startDrag);

		expect(calls).toEqual(["prevent-default", "start-native"]);
		expect(startDrag).toHaveBeenCalledWith(["C:\\project\\report.txt"]);
	});

	it("supports multi-path native drag", () => {
		const preventDefault = vi.fn();
		const startDrag = vi.fn();
		beginNativeFileDrag({ preventDefault }, ["C:\\a.txt", "C:\\b.txt"], startDrag);
		expect(startDrag).toHaveBeenCalledWith(["C:\\a.txt", "C:\\b.txt"]);
	});

	it("no-ops when paths are empty", () => {
		const preventDefault = vi.fn();
		const startDrag = vi.fn();
		beginNativeFileDrag({ preventDefault }, [], startDrag);
		expect(preventDefault).not.toHaveBeenCalled();
		expect(startDrag).not.toHaveBeenCalled();
	});
});
