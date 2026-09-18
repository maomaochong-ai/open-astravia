import { afterEach, describe, expect, it, vi } from "vitest";
import { runAfterFirstPaint } from "../src/gallery/after-first-paint";

describe("runAfterFirstPaint", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("双 rAF 之后才调用", () => {
		const frames: Array<() => void> = [];
		vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => {
			frames[id - 1] = () => undefined;
		});

		const onPainted = vi.fn();
		runAfterFirstPaint(onPainted);
		expect(onPainted).not.toHaveBeenCalled();
		expect(frames).toHaveLength(1);

		frames[0]?.();
		expect(onPainted).not.toHaveBeenCalled();
		expect(frames).toHaveLength(2);

		frames[1]?.();
		expect(onPainted).toHaveBeenCalledTimes(1);
	});

	it("取消后不再调用", () => {
		const frames: Array<() => void> = [];
		vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
			frames.push(callback);
			return frames.length;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number) => {
			frames[id - 1] = () => undefined;
		});

		const late = vi.fn();
		const cancelLate = runAfterFirstPaint(late);
		cancelLate();
		for (const frame of [...frames]) frame();
		expect(late).not.toHaveBeenCalled();
	});
});
