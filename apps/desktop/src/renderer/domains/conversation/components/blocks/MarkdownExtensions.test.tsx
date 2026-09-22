// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarkdownPreviewView } from "@vetta-org/theme-ui/activity";
import {
	CodeBlock,
	MarkdownContent,
	MarkdownProvider,
	defaultMarkdown,
	extendMarkdown,
} from "@vetta-org/theme-ui/markdown";
import type { MarkdownCodeBlockProps } from "@vetta-org/theme-ui/markdown";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const environment = {
	theme: "dark" as const,
	labels: { copy: "Copy code", copied: "Copied code" },
	getFileIconClass: () => "",
	onOpenFile: vi.fn(),
	onOpenUrl: vi.fn(),
};

beforeEach(() =>
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	),
);
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("local Markdown extensions", () => {
	it("shares the same definition with previews while retaining frontmatter and external-link actions", () => {
		const open = vi.fn();
		const definition = extendMarkdown(defaultMarkdown, {
			components: { strong: ({ children }) => <mark>{children}</mark> },
			codeBlock: ({ code }) => <pre aria-label="preview extension">{code}</pre>,
		});
		render(
			<MarkdownProvider definition={definition}>
				<MarkdownPreviewView
					content={
						"---\ntitle: Preview\n---\n**Content**\n\n```js\nlet value = 1;\n```\n\n[Reference](https://example.test)"
					}
					theme="light"
					onOpenExternal={open}
				/>
			</MarkdownProvider>,
		);
		expect(screen.getByText("Preview")).toBeTruthy();
		expect(screen.getByText("Content").tagName).toBe("MARK");
		expect(screen.getByLabelText("preview extension").textContent).toBe("let value = 1;");
		fireEvent.click(screen.getByRole("link", { name: "Reference" }));
		expect(open).toHaveBeenCalledWith("https://example.test");
	});

	it("shows only the file name when a local file link's label is the absolute path", () => {
		const openFile = vi.fn();
		render(
			<MarkdownContent
				{...environment}
				onOpenFile={openFile}
				text={
					"- [/Users/me/app/src/topics.tsx](</Users/me/app/src/topics.tsx>) — edited\n- [lib/index.ts](</Users/me/app/lib/index.ts>) — added"
				}
			/>,
		);
		const chip = screen.getByRole("button", { name: "topics.tsx" });
		expect(chip.getAttribute("title")).toBe("/Users/me/app/src/topics.tsx");
		expect(screen.getByRole("button", { name: "lib/index.ts" })).toBeTruthy();
		fireEvent.click(chip);
		expect(openFile).toHaveBeenCalledWith("/Users/me/app/src/topics.tsx");
	});

	it("replaces a table and code block while retaining Markdown, link actions and sibling isolation", async () => {
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
		function CustomCode(props: MarkdownCodeBlockProps) {
			return (
				<CodeBlock.Root {...props}>
					<CodeBlock.Copy>
						<section aria-label="custom code">
							<CodeBlock.Language />
							<pre>{props.code}</pre>
						</section>
					</CodeBlock.Copy>
				</CodeBlock.Root>
			);
		}
		const definition = extendMarkdown(defaultMarkdown, {
			codeBlock: CustomCode,
			components: { table: ({ children }) => <table aria-label="custom table">{children}</table> },
		});
		const text =
			"**Answer**\n\n| A | B |\n|---|---:|\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```\n\n[spec](C:/My Files/spec.md)";
		const view = render(
			<>
				<MarkdownProvider definition={definition}>
					<MarkdownContent {...environment} text={text} />
				</MarkdownProvider>
				<MarkdownContent {...environment} text="Outside" />
			</>,
		);
		expect(screen.getByText("Answer").tagName).toBe("STRONG");
		expect(screen.getByRole("table", { name: "custom table" }).textContent).toContain("12");
		fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Copied code" })).toBeTruthy());
		expect(writeText).toHaveBeenCalledWith("const a = 1;");
		fireEvent.click(screen.getByRole("button", { name: "spec" }));
		expect(environment.onOpenFile).toHaveBeenCalledWith("C:/My Files/spec.md");
		expect(screen.getByText("Outside")).toBeTruthy();
		view.rerender(<MarkdownContent {...environment} text={"| C |\n|---|\n| D |"} />);
		expect(screen.queryByRole("table", { name: "custom table" })).toBeNull();
		expect(screen.getByRole("table")).toBeTruthy();
	});

	it("keeps stateful renderer identity while streaming appends and host callbacks change", () => {
		vi.useFakeTimers();
		function Paragraph({ children }: { children?: ReactNode }) {
			const [expanded, setExpanded] = useState(false);
			return (
				<div>
					<button type="button" onClick={() => setExpanded(!expanded)}>
						{expanded ? "Expanded" : "Expand"}
					</button>
					<p>{children}</p>
				</div>
			);
		}
		const definition = extendMarkdown(defaultMarkdown, { components: { p: Paragraph } });
		const view = render(<MarkdownContent {...environment} definition={definition} text="Hello." isStreamingTail />);
		act(() => vi.advanceTimersByTime(1000));
		fireEvent.click(screen.getByRole("button", { name: "Expand" }));
		view.rerender(
			<MarkdownContent
				{...environment}
				onOpenUrl={() => undefined}
				definition={definition}
				text="Hello. More text."
				isStreamingTail
			/>,
		);
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.getByRole("button", { name: "Expanded" })).toBeTruthy();
		expect(screen.getByText(/More text/)).toBeTruthy();
	});

	it("runs a trusted syntax extension and its custom element renderer without a global registry", () => {
		const definition = extendMarkdown(defaultMarkdown, {
			rehypePlugins: [
				() => (tree: { children: unknown[] }) => {
					tree.children.push({ type: "element", tagName: "extension-note", properties: {}, children: [] });
				},
			],
			elements: { "extension-note": () => <aside>Extension note</aside> },
		});
		render(
			<MarkdownProvider definition={definition}>
				<MarkdownContent {...environment} text="Body" />
			</MarkdownProvider>,
		);
		expect(screen.getByText("Body")).toBeTruthy();
		expect(screen.getByText("Extension note").tagName).toBe("ASIDE");
	});
});
