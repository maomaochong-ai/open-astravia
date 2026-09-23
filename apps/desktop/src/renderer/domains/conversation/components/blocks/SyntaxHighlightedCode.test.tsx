// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { codeToHtml } = vi.hoisted(() => ({
	codeToHtml: vi.fn(async () => "<pre>highlighted</pre>"),
}));
vi.mock("shiki", () => ({
	codeToHtml,
}));

const { SyntaxHighlightedCode } = await import("@vetta-org/theme-ui/shared");

describe("SyntaxHighlightedCode", () => {
	beforeEach(() => {
		codeToHtml.mockClear();
		codeToHtml.mockImplementation(async () => "<pre>highlighted</pre>");
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("流式 live 块只渲染等宽纯文本，不调用 Shiki", async () => {
		const { container } = render(
			<SyntaxHighlightedCode code="const a = 1;" lang="ts" theme="dark" live />,
		);
		expect(container.textContent).toContain("const a = 1;");
		await Promise.resolve();
		expect(codeToHtml).not.toHaveBeenCalled();
	});

	it("非 live 且没有 IntersectionObserver 时会请求高亮", async () => {
		const { container } = render(
			<SyntaxHighlightedCode code="unique-live-skip regular" lang="ts" theme="dark" />,
		);
		await waitFor(() => expect(codeToHtml).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(container.innerHTML).toContain("highlighted"));
	});

	it.each([
		["total size", `${"x".repeat(1000)}\n`.repeat(31)],
		["line count", "x\n".repeat(1001)],
		["long line", "x".repeat(2001)],
	])("keeps %s over-budget code complete and copyable", async (_name, code) => {
		const writeText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
		const props = {
			theme: "dark" as const, labels: { copy: "Copy code", copied: "Copied" },
			getFileIconClass: () => "", onOpenFile: () => {}, onOpenUrl: () => {},
		};
		const view = render(<MarkdownContent {...props} text={`\`\`\`ts\n${code}\n\`\`\``} />);
		expect(view.container.querySelector("code")?.textContent).toBe(code);
		fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
		expect(codeToHtml).not.toHaveBeenCalled();
	});

	it("highlights ordinary code after streaming finishes and reuses it when returning to history", async () => {
		const props = { code: "normal-stream-finish", lang: "ts", theme: "light" as const };
		const view = render(<SyntaxHighlightedCode {...props} live />);
		expect(view.container.textContent).toBe(props.code);
		expect(codeToHtml).not.toHaveBeenCalled();
		view.rerender(<SyntaxHighlightedCode {...props} />);
		await waitFor(() => expect(view.container.textContent).toBe("highlighted"));
		view.unmount();
		const history = render(<SyntaxHighlightedCode {...props} />);
		expect(history.container.textContent).toBe("highlighted");
		expect(codeToHtml).toHaveBeenCalledOnce();
	});

	it("retains plain source when generated highlighting exceeds its output budget", async () => {
		codeToHtml.mockResolvedValue(`<pre>${"x".repeat(256001)}</pre>`);
		const view = render(<SyntaxHighlightedCode code="oversized-output" lang="ts" theme="dark" />);
		await waitFor(() => expect(codeToHtml).toHaveBeenCalledOnce());
		await Promise.resolve();
		expect(view.container.textContent).toBe("oversized-output");
		view.unmount();
		render(<SyntaxHighlightedCode code="oversized-output" lang="ts" theme="dark" />);
		expect(codeToHtml).toHaveBeenCalledOnce();
	});

	it("evicts old large highlights by total size instead of retaining hundreds of huge results", async () => {
		codeToHtml.mockResolvedValue(`<pre>${"x".repeat(249980)}</pre>`);
		for (let index = 0; index < 17; index++) {
			const view = render(<SyntaxHighlightedCode code={`cache-budget-${index}`} lang="ts" theme="light" />);
			await waitFor(() => expect(view.container.querySelector("pre")?.textContent?.length).toBe(249980));
			view.unmount();
		}
		codeToHtml.mockClear();
		const recent = render(<SyntaxHighlightedCode code="cache-budget-16" lang="ts" theme="light" />);
		expect(recent.container.querySelector("pre")?.textContent?.length).toBe(249980);
		expect(codeToHtml).not.toHaveBeenCalled();
		recent.unmount();
		render(<SyntaxHighlightedCode code="cache-budget-0" lang="ts" theme="light" />);
		await waitFor(() => expect(codeToHtml).toHaveBeenCalledOnce());
	});
});
