// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { TextBlockView } from "@vetta-org/theme-ui/chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FULL_TEXT =
	"The assistant streams this answer word by word so the reader never sees a whole paragraph jump onto the screen at once.";

let frameQueue: FrameRequestCallback[] = [];
let now = 0;

function runFrame(stepMs = 32): void {
	now += stepMs;
	const callbacks = frameQueue;
	frameQueue = [];
	act(() => {
		for (const callback of callbacks) callback(now);
	});
}

function renderView(text: string, isStreamingTail: boolean) {
	const props = {
		theme: "dark" as const,
		labels: { copy: "copy", copied: "copied" },
		getFileIconClass: () => "",
		onOpenFile: () => {},
		onOpenUrl: () => {},
	};
	const view = render(<TextBlockView {...props} text={text} isStreamingTail={isStreamingTail} />);
	return {
		container: view.container,
		rerender: (nextText: string, nextTail: boolean) =>
			view.rerender(<TextBlockView {...props} text={nextText} isStreamingTail={nextTail} />),
	};
}

function shownText(container: HTMLElement): string {
	return container.textContent ?? "";
}

beforeEach(() => {
	frameQueue = [];
	now = 0;
	vi.useFakeTimers();
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frameQueue.push(callback);
		return frameQueue.length;
	});
	vi.stubGlobal("cancelAnimationFrame", () => {
		frameQueue = [];
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("TextBlockView streaming tail", () => {
	it("reveals streamed text progressively across frames instead of in one batch", () => {
		const { container } = renderView(FULL_TEXT, true);
		expect(shownText(container)).toBe("");

		const lengths: number[] = [];
		for (let frame = 0; frame < 200 && shownText(container) !== FULL_TEXT; frame++) {
			runFrame();
			lengths.push(shownText(container).length);
		}

		expect(shownText(container)).toBe(FULL_TEXT);
		expect(lengths.length).toBeGreaterThan(5);
		expect(Math.max(...lengths.slice(0, 3))).toBeLessThan(FULL_TEXT.length / 2);
		for (let index = 1; index < lengths.length; index++) {
			expect(lengths[index]).toBeGreaterThanOrEqual(lengths[index - 1] ?? 0);
		}
	});

	it("wraps revealed words in fade segments while streaming", () => {
		const { container } = renderView(FULL_TEXT, true);
		for (let frame = 0; frame < 40; frame++) runFrame();

		const chunks = Array.from(container.querySelectorAll(".streaming-chunk"), (node) => node.textContent);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks).toContain("assistant");
	});

	it("keeps already shown text when the host appends more", () => {
		const { container, rerender } = renderView("Hello there", true);
		for (let frame = 0; frame < 40; frame++) runFrame();
		expect(shownText(container)).toBe("Hello there");

		rerender("Hello there, general Kenobi", true);
		expect(shownText(container)).toBe("Hello there");
		runFrame();
		expect(shownText(container).startsWith("Hello there")).toBe(true);
	});

	it("finishes the backlog after the tail ends, then drops the fade segments", () => {
		const { container, rerender } = renderView(FULL_TEXT, true);
		runFrame();
		rerender(FULL_TEXT, false);
		expect(shownText(container).length).toBeLessThan(FULL_TEXT.length);

		for (let frame = 0; frame < 200 && shownText(container) !== FULL_TEXT; frame++) runFrame();
		expect(shownText(container)).toBe(FULL_TEXT);

		act(() => {
			vi.runAllTimers();
		});
		expect(container.querySelector(".streaming-chunk")).toBeNull();
		expect(shownText(container)).toBe(FULL_TEXT);
	});

	it("renders non-streaming text immediately without fade segments", () => {
		const { container } = renderView(FULL_TEXT, false);
		expect(shownText(container)).toBe(FULL_TEXT);
		expect(container.querySelector(".streaming-chunk")).toBeNull();
	});
});
