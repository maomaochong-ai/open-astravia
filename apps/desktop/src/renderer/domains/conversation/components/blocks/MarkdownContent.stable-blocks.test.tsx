// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const environment = {
	theme: "dark" as const,
	labels: { copy: "Copy code", copied: "Copied code" },
	getFileIconClass: () => "",
	onOpenFile: () => {},
	onOpenUrl: () => {},
};

describe("MarkdownContent 稳定块冻结", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				disconnect() {}
			},
		);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("流式追加时已闭合围栏前的正文节点保持身份，只有尾块继续增长", () => {
		const prefix = "Hello frozen paragraph.\n\n```js\nconst a = 1;\n```\n\n";
		const view = render(
			<MarkdownContent {...environment} text={`${prefix}Beta`} isStreamingTail />,
		);
		act(() => {
			vi.advanceTimersByTime(4000);
		});
		const first = screen.getByText("Hello frozen paragraph.");
		view.rerender(
			<MarkdownContent {...environment} text={`${prefix}Beta continues now.`} isStreamingTail />,
		);
		act(() => {
			vi.advanceTimersByTime(4000);
		});
		expect(screen.getByText("Hello frozen paragraph.")).toBe(first);
		expect(screen.getByText(/Beta continues now/)).toBeTruthy();
	});
});
