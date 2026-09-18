// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
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
	});
	afterEach(() => {
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
			<SyntaxHighlightedCode code={"unique-live-skip " + Math.random()} lang="ts" theme="dark" />,
		);
		await waitFor(() => expect(codeToHtml).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(container.innerHTML).toContain("highlighted"));
	});
});
