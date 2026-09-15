// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { TextBlockView } from "@vetta-org/theme-ui/chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FULL_TEXT =
	"As twilight falls, the city wakes up. Streetlights flicker on, shadows stretch across the pavement, and the air turns cool.";

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

function advance(ms: number): void {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("TextBlockView streaming tail", () => {
	it("reveals streamed text one phrase at a time", () => {
		const { container } = renderView(FULL_TEXT, true);
		expect(shownText(container)).toBe("");

		const snapshots: string[] = [];
		for (let step = 0; step < 100 && shownText(container) !== FULL_TEXT; step++) {
			advance(10);
			const shown = shownText(container);
			if (shown !== snapshots.at(-1)) snapshots.push(shown);
		}

		expect(shownText(container)).toBe(FULL_TEXT);
		expect(snapshots.slice(0, 3)).toEqual([
			"As twilight falls,",
			"As twilight falls, the city wakes up.",
			"As twilight falls, the city wakes up. Streetlights flicker on,",
		]);
	});

	it("wraps revealed phrases in fade segments while streaming", () => {
		const { container } = renderView(FULL_TEXT, true);
		advance(500);

		const chunks = Array.from(container.querySelectorAll(".streaming-chunk"), (node) => node.textContent);
		expect(chunks.slice(0, 2)).toEqual(["As twilight falls,", " the city wakes up."]);
	});

	it("holds back an unfinished tail until the phrase completes", () => {
		const { container, rerender } = renderView("Hello there, gene", true);
		advance(500);
		expect(shownText(container)).toBe("Hello there,");

		rerender("Hello there, general Kenobi. You are", true);
		advance(500);
		expect(shownText(container)).toBe("Hello there, general Kenobi.");
	});

	it("releases a stalled unfinished tail instead of hiding it forever", () => {
		const { container } = renderView("Hello there, gene", true);
		advance(500);
		expect(shownText(container)).toBe("Hello there,");

		advance(1000);
		expect(shownText(container)).toBe("Hello there, gene");
	});

	it("finishes the remaining phrases after the tail ends, then drops the fade segments", () => {
		const { container, rerender } = renderView(FULL_TEXT, true);
		advance(1);
		rerender(`${FULL_TEXT} The end`, false);
		expect(shownText(container)).toBe("As twilight falls,");

		advance(3000);
		expect(shownText(container)).toBe(`${FULL_TEXT} The end`);
		expect(container.querySelector(".streaming-chunk")).toBeNull();
	});

	it("renders non-streaming text immediately without fade segments", () => {
		const { container } = renderView(FULL_TEXT, false);
		expect(shownText(container)).toBe(FULL_TEXT);
		expect(container.querySelector(".streaming-chunk")).toBeNull();
	});
});
