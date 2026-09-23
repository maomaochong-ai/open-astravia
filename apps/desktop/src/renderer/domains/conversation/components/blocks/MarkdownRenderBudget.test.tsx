// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import type { MarkdownDefinition } from "@vetta-org/theme-ui/markdown";
import { afterEach, expect, it, vi } from "vitest";

const environment = {
	theme: "dark" as const,
	labels: { copy: "Copy", copied: "Copied" },
	getFileIconClass: () => "",
	onOpenFile: () => {},
	onOpenUrl: () => {},
};

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("coalesces parsing of a long streaming answer and immediately flushes the complete final text", () => {
	vi.useFakeTimers();
	let parses = 0;
	const definition: MarkdownDefinition = { remarkPlugins: [() => () => { parses++; }] };
	let text = "Long answer content. ".repeat(800);
	const view = render(<MarkdownContent {...environment} definition={definition} text={text} />);
	parses = 0;
	for (let index = 0; index < 8; index++) {
		act(() => { vi.advanceTimersByTime(50); });
		text += `更新${index}。`;
		view.rerender(<MarkdownContent {...environment} definition={definition} text={text} isStreamingTail />);
	}
	// Parse budget is the observable performance contract; do not require a particular timer count.
	expect(parses).toBeLessThanOrEqual(3);
	expect(view.container.textContent).toContain("更新0");
	view.rerender(<MarkdownContent {...environment} definition={definition} text={text} />);
	expect(view.container.textContent).toBe(text);
	act(() => { vi.advanceTimersByTime(1000); });
	expect(view.container.textContent).toBe(text);
});

it("shows replacement text without allowing a pending long-answer snapshot to restore the old answer", () => {
	vi.useFakeTimers();
	const text = "Previous content. ".repeat(1000);
	const view = render(<MarkdownContent {...environment} text={text} />);
	view.rerender(<MarkdownContent {...environment} text={`${text}追加。`} isStreamingTail />);
	view.rerender(<MarkdownContent {...environment} text="Replacement answer." isStreamingTail />);
	expect(view.container.textContent).toBe("Replacement answer.");
	act(() => { vi.advanceTimersByTime(1000); });
	expect(view.container.textContent).toBe("Replacement answer.");
});

it("holds an incomplete nested link then exposes the complete destination without a raw-markup flash", () => {
	vi.useFakeTimers();
	const open = vi.fn();
	const view = render(<MarkdownContent {...environment} onOpenUrl={open} text="See [page](https://example.test/a(b)" isStreamingTail />);
	act(() => { vi.advanceTimersByTime(200); });
	expect(view.container.textContent).toBe("See");
	expect(screen.queryByRole("link")).toBeNull();
	view.rerender(<MarkdownContent {...environment} onOpenUrl={open} text="See [page](https://example.test/a(b))" isStreamingTail />);
	act(() => { vi.advanceTimersByTime(200); });
	const link = screen.getByRole("link", { name: "page" });
	fireEvent.click(link);
	expect(open).toHaveBeenCalledWith("https://example.test/a(b)");
	view.rerender(<MarkdownContent {...environment} onOpenUrl={open} text="See [page](https://example.test/a(b))" />);
	expect(screen.getByRole("link", { name: "page" })).toBe(link);
});

it("flushes unfinished math and links as literal text when generation stops", () => {
	vi.useFakeTimers();
	for (const text of ["Value $x + y", "See [unfinished](https://example.test/"]) {
		const view = render(<MarkdownContent {...environment} text={text} isStreamingTail />);
		act(() => { vi.advanceTimersByTime(200); });
		expect(view.container.textContent).not.toContain(text);
		view.rerender(<MarkdownContent {...environment} text={text} />);
		expect(view.container.textContent).toBe(text);
		view.unmount();
	}
});
