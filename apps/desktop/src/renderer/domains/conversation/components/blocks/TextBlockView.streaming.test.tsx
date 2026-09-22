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
	it("reveals streamed text as a steady flow of whole words", () => {
		const { container } = renderView(FULL_TEXT, true);
		// 挂载时已有积压（切回正在流式的会话）：先追到允许的滞后以内，再匀速放。
		expect(FULL_TEXT.startsWith(shownText(container))).toBe(true);
		expect(shownText(container).length).toBeLessThan(FULL_TEXT.length);

		const snapshots: string[] = [];
		for (let step = 0; step < 100 && shownText(container) !== FULL_TEXT; step++) {
			advance(100);
			const shown = shownText(container);
			if (shown !== snapshots.at(-1)) snapshots.push(shown);
		}

		expect(shownText(container)).toBe(FULL_TEXT);
		// 每一步都是前一步的延伸，且不从单词中间切开。
		expect(snapshots.length).toBeGreaterThan(3);
		for (const [index, shown] of snapshots.entries()) {
			expect(FULL_TEXT.startsWith(shown)).toBe(true);
			if (index > 0) expect(shown.startsWith(snapshots[index - 1] as string)).toBe(true);
			const nextChar = FULL_TEXT[shown.length];
			if (nextChar !== undefined) expect(nextChar).not.toMatch(/[A-Za-z0-9]/);
		}
	});

	it("keeps up with a fast stream instead of falling behind in bursts", () => {
		const { container, rerender } = renderView("", true);
		let text = "";
		for (let tick = 0; tick < 20; tick++) {
			text += "word ".repeat(12);
			rerender(text, true);
			advance(100);
		}
		// 放出速率跟随到达速率：积压始终有限。
		expect(text.length - shownText(container).length).toBeLessThan(100);
	});

	it("wraps revealed phrases in segments and dims the newest ones", () => {
		const { container } = renderView(FULL_TEXT, true);
		advance(1200);

		const chunks = Array.from(container.querySelectorAll(".streaming-chunk"), (node) => node.textContent);
		expect(chunks[0]).toBe("As twilight falls,");
		expect(chunks.join("")).toBe(shownText(container));
		expect(container.querySelector(".streaming-chunk-latest")).not.toBeNull();
	});

	it("holds back an unfinished word until it completes", () => {
		const { container, rerender } = renderView("Hello there, gene", true);
		advance(500);
		expect(shownText(container)).toBe("Hello there,");

		rerender("Hello there, general Kenobi. You are", true);
		advance(300);
		expect(shownText(container)).toBe("Hello there, general Kenobi. You");
	});

	it("releases a stalled unfinished tail instead of hiding it forever", () => {
		const { container } = renderView("Hello there, gene", true);
		advance(500);
		expect(shownText(container)).toBe("Hello there,");

		advance(1000);
		expect(shownText(container)).toBe("Hello there, gene");
	});

	it("holds back an open link and shows it whole once it closes", () => {
		const { container, rerender } = renderView("See [report](/tmp/rep", true);
		advance(300);
		expect(shownText(container)).toBe("See");
		expect(container.querySelector("button, a")).toBeNull();

		rerender("See [report](/tmp/report.md) for details", true);
		advance(300);
		expect(container.querySelector("button, a")?.textContent).toBe("report");
		// 末尾的 "details" 还可能没写完，先扣着；停顿后放出。
		expect(shownText(container)).toBe("See report for");
		advance(900);
		expect(shownText(container)).toBe("See report for details");
	});

	it("releases an open link as plain text after the hold timeout", () => {
		const { container } = renderView("See [report](/tmp/rep", true);
		advance(1200);
		expect(shownText(container)).toBe("See [report](/tmp/rep");
	});

	it("shows the rest at once when the tail ends, then only lifts the dimming without rebuilding", () => {
		const { container, rerender } = renderView(FULL_TEXT, true);
		advance(1);
		expect(shownText(container).length).toBeLessThan(FULL_TEXT.length);

		rerender(`${FULL_TEXT} The end`, false);
		expect(shownText(container)).toBe(`${FULL_TEXT} The end`);
		const lastChunk = container.querySelector(".streaming-chunk-latest");
		expect(lastChunk).not.toBeNull();
		expect(container.querySelector(".markdown-streaming-tail")).not.toBeNull();

		advance(200);
		// 分段 span 留在原地（不重建 DOM），只是包裹类没了，暗色随之消失。
		expect(container.querySelector(".markdown-streaming-tail")).toBeNull();
		expect(container.querySelector(".streaming-chunk-latest")).toBe(lastChunk);
	});

	it("renders non-streaming text immediately without segments", () => {
		const { container } = renderView(FULL_TEXT, false);
		expect(shownText(container)).toBe(FULL_TEXT);
		expect(container.querySelector(".streaming-chunk")).toBeNull();
	});
});
