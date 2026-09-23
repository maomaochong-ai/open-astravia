// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import { MarkdownPreviewView } from "@vetta-org/theme-ui/activity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderFormula } from "../../../../../../../../packages/theme-ui/src/markdown/math-render";
import { RichCodeBlock } from "../../../../../../../../packages/theme-ui/src/markdown/RichCodeBlock";
import { useRenderSnapshot } from "../../../../../../../../packages/theme-ui/src/markdown/use-render-snapshot";

const environment = {
	theme: "dark" as const,
	labels: { copy: "Copy", copied: "Copied" },
	getFileIconClass: () => "",
	onOpenFile: vi.fn(),
	onOpenUrl: vi.fn(),
};

class FormulaWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	terminated = false;
	postMessage(request: { id: number; source: string; display: boolean }) {
		queueMicrotask(() => {
			if (!this.terminated)
				this.onmessage?.(
					new MessageEvent("message", {
						data: {
							id: request.id,
							html: renderFormula(request.source, request.display),
						},
					}),
				);
		});
	}
	terminate() {
		this.terminated = true;
	}
}

beforeEach(() => {
	vi.stubGlobal("Worker", FormulaWorker);
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("Markdown rich content user flows", () => {
	it("keeps malformed SVG source readable without crashing the message", async () => {
		const source = '<svg><text>\ud800</text></svg>';
		render(<MarkdownContent {...environment} text={`\`\`\`svg\n${source}\n\`\`\``} />);
		await screen.findByText(/Could not render this content/);
		expect(screen.getByText(source)).toBeTruthy();
	});
	it("receives a streamed answer, settles into an HTML preview and preserves it while surrounding text updates", async () => {
		const text = "Here is the page.\n\n```html\n<h1>Generated page</h1>\n```";
		const view = render(<MarkdownContent {...environment} text={text} isStreamingTail />);
		await screen.findByText(/Preview will appear/, {}, { timeout: 3000 });
		expect(screen.queryByTitle("HTML preview")).toBeNull();
		view.rerender(<MarkdownContent {...environment} text={text} />);
		await screen.findByTitle("HTML preview");
		fireEvent.click(screen.getByRole("button", { name: "Run JavaScript" }));
		expect(screen.getByTitle("HTML preview").getAttribute("sandbox")).toBe("allow-scripts");
		view.rerender(<MarkdownContent {...environment} text={text} onOpenFile={() => undefined} />);
		expect(screen.getByTitle("HTML preview").getAttribute("sandbox")).toBe("allow-scripts");
	});

	it("keeps a full raw HTML page with blank lines in one preview", async () => {
		const text =
			'<!doctype html>\n<html>\n<head><style>h1 { color: red; }</style></head>\n\n<body><h1>Page</h1>\n\n<script>document.title="Page";</script></body>\n</html>';
		render(<MarkdownContent {...environment} text={text} />);
		await screen.findByTitle("HTML preview");
		expect(screen.getAllByTitle("HTML preview")).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text));
	});
	it("renders inline and display formulas, preserves code and recovers from an invalid formula", async () => {
		const view = render(
			<MarkdownContent {...environment} text={"Inline $x^2$\n\n$$\n\\frac{a}{b}\n$$\n\n`$literal$`"} />,
		);
		await waitFor(() => expect(view.container.querySelectorAll("math").length).toBe(2));
		expect(screen.getByText("$literal$").tagName).toBe("CODE");
		view.rerender(<MarkdownContent {...environment} text={"$\\invalidCommand$"} />);
		await waitFor(() => expect(view.container.querySelector("math")).toBeNull());
		expect(screen.getByText("\\invalidCommand")).toBeTruthy();
		view.rerender(<MarkdownContent {...environment} text="$y^3$" />);
		await waitFor(() => expect(view.container.querySelector("math")).not.toBeNull());
	});

	it("previews SVG without inserting model markup into the host, then shows and copies its original source", async () => {
		const source = '<svg viewBox="0 0 10 10"><script>parent.pwned=1</script><circle cx="5" cy="5" r="4"/></svg>';
		const view = render(<MarkdownContent {...environment} text={`\`\`\`svg\n${source}\n\`\`\``} />);
		const image = await screen.findByRole("img", { name: "SVG preview" });
		expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
		expect(view.container.querySelector("svg, script")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Source" }));
		expect(view.container.textContent).toContain(source);
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(source));
		fireEvent.click(screen.getByRole("button", { name: "Preview" }));
		expect(await screen.findByRole("img", { name: "SVG preview" })).toBeTruthy();
	});

	it("supports raw inline SVG and the same formulas and fenced HTML in file preview", async () => {
		const source = '<svg viewBox="0 0 10 10"><text>OK</text></svg>';
		const view = render(<MarkdownContent {...environment} text={`Diagram ${source} after.`} />);
		expect(await screen.findByRole("img", { name: "SVG preview" })).toBeTruthy();
		expect(view.container.textContent).toContain("after.");
		view.rerender(
			<MarkdownPreviewView
				content={"---\ntitle: Example\n---\n$x+1$\n\n```html\n<h1>Page</h1>\n```"}
				theme="dark"
				onOpenExternal={vi.fn()}
			/>,
		);
		expect(screen.getByText("Example")).toBeTruthy();
		await waitFor(() => expect(view.container.querySelector("math")).not.toBeNull());
		expect(await screen.findByTitle("HTML preview")).toBeTruthy();
	});

	it("waits for generation, runs only on request, and stops when source changes or the document is hidden", () => {
		const code = '<button onclick="this.textContent=42">Run</button>';
		const view = render(<RichCodeBlock {...environment} lang="html" code={code} live />);
		expect(screen.queryByTitle("HTML preview")).toBeNull();
		view.rerender(<RichCodeBlock {...environment} lang="html" code={code} />);
		expect(screen.getByTitle("HTML preview").getAttribute("sandbox")).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "Run JavaScript" }));
		expect(screen.getByTitle("HTML preview").getAttribute("sandbox")).toBe("allow-scripts");
		view.rerender(<RichCodeBlock {...environment} lang="html" code={`${code}<p>New</p>`} />);
		expect(screen.getByTitle("HTML preview").getAttribute("sandbox")).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "Run JavaScript" }));
		Object.defineProperty(document, "hidden", { configurable: true, value: true });
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		expect(screen.queryByTitle("HTML preview")).toBeNull();
		Object.defineProperty(document, "hidden", { configurable: true, value: false });
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		expect(screen.getByTitle("HTML preview").getAttribute("sandbox")).toBe("");
	});

	it("bounds script lifetime and retains source access for oversized content", () => {
		vi.useFakeTimers();
		const view = render(<RichCodeBlock {...environment} lang="html" code="<p>Page</p>" />);
		fireEvent.click(screen.getByRole("button", { name: "Run JavaScript" }));
		act(() => vi.advanceTimersByTime(30_000));
		expect(screen.getByTitle("HTML preview").getAttribute("sandbox")).toBe("");
		expect(screen.getByText(/Preview paused/)).toBeTruthy();
		view.rerender(<RichCodeBlock {...environment} lang="html" code={"x".repeat(256_001)} />);
		expect(screen.queryByTitle("HTML preview")).toBeNull();
		expect(screen.queryByRole("button", { name: "Run JavaScript" })).toBeNull();
		expect(screen.getByText(/too large to preview/)).toBeTruthy();
	});

	it("unloads an offscreen HTML page and resumes with a static preview", () => {
		let intersect: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				constructor(callback: typeof intersect) {
					intersect = callback;
				}
				observe() {}
				disconnect() {}
			},
		);
		render(<RichCodeBlock {...environment} lang="html" code="<h1>Page</h1>" />);
		expect(screen.queryByTitle("HTML preview")).toBeNull();
		act(() => intersect?.([{ isIntersecting: true }]));
		fireEvent.click(screen.getByRole("button", { name: "Run JavaScript" }));
		expect(screen.getByTitle("HTML preview").getAttribute("sandbox")).toBe("allow-scripts");
		act(() => intersect?.([{ isIntersecting: false }]));
		expect(screen.queryByTitle("HTML preview")).toBeNull();
		act(() => intersect?.([{ isIntersecting: true }]));
		expect(screen.getByTitle("HTML preview").getAttribute("sandbox")).toBe("");
	});

	it("renders at a bounded cadence under continuous arrivals, flushes the final value and cancels offscreen work", () => {
		vi.useFakeTimers();
		function Snapshot({ source, active = true, live = true }: { source: string; active?: boolean; live?: boolean }) {
			return <output>{useRenderSnapshot(source, active, live)}</output>;
		}
		const view = render(<Snapshot source="0" />);
		for (let i = 1; i <= 4; i++) {
			view.rerender(<Snapshot source={String(i)} />);
			act(() => vi.advanceTimersByTime(50));
			expect(screen.getByRole("status").textContent).toBe("0");
		}
		act(() => vi.advanceTimersByTime(50));
		expect(screen.getByRole("status").textContent).toBe("4");
		view.rerender(<Snapshot source="final" live={false} />);
		expect(screen.getByRole("status").textContent).toBe("final");
		view.rerender(<Snapshot source="hidden" active={false} />);
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.getByRole("status").textContent).toBe("final");
		view.rerender(<Snapshot source="hidden" live={false} />);
		expect(screen.getByRole("status").textContent).toBe("hidden");
	});
});
