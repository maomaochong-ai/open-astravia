// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import { MarkdownPreviewView } from "@vetta-org/theme-ui/activity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMarkdownHostFixture } from "./markdown-host.fixture";

afterEach(cleanup);
const props = { theme: "light" as const, labels: { copy: "Copy", copied: "Copied" }, getFileIconClass: () => "", onOpenFile: vi.fn(), onOpenUrl: vi.fn() };

describe("Markdown media workflows", () => {
	it("keeps image titles and does not follow an enclosing link when copying", async () => {
		const { host } = createMarkdownHostFixture();
		const navigate = vi.fn();
		render(<MarkdownContent {...props} onOpenUrl={navigate} host={host} text={'[![Chart](https://example.test/chart.png "Details")](https://example.test/page)'} />);
		const image = await screen.findByRole("img", { name: "Chart" });
		expect(image.getAttribute("title")).toBe("Details");
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		await screen.findByRole("button", { name: "Copied" });
		expect(navigate).not.toHaveBeenCalled();
		fireEvent.click(image);
		expect(navigate).toHaveBeenCalledWith("https://example.test/page");
	});

	it("keeps the link usable without retrying a failed host icon lookup in the browser", async () => {
		const { host } = createMarkdownHostFixture();
		render(<MarkdownContent {...props} host={host} text="[Missing](https://missing.test/private)" />);
		await waitFor(() => expect(host.favicon).toHaveBeenCalledWith("https://missing.test"));
		expect(screen.getByRole("link", { name: "Missing" }).querySelector("img")).toBeNull();
		fireEvent.click(screen.getByRole("link", { name: "Missing" }));
		expect(props.onOpenUrl).toHaveBeenCalledWith("https://missing.test/private");
	});
	it("preserves browser-relative image URLs for hosts without desktop capabilities", async () => {
		render(<MarkdownContent {...props} text="![Relative](./assets/picture.png)" />);
		expect((await screen.findByRole("img", { name: "Relative" })).getAttribute("src")).toBe("./assets/picture.png");
	});
	it("does not apply a previous image's pending copy result after the message changes", async () => {
		const { host } = createMarkdownHostFixture();
		let finish: () => void = () => {};
		host.copyImage.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
		const view = render(<MarkdownContent {...props} host={host} text="![First](https://example.test/first.png)" />);
		await screen.findByRole("img", { name: "First" });
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		view.rerender(<MarkdownContent {...props} host={host} text="![Second](https://example.test/second.png)" />);
		await screen.findByRole("img", { name: "Second" });
		await act(async () => finish());
		expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
	});
	it("loads an image, retries a failed load, then enlarges, copies and saves it", async () => {
		const { host } = createMarkdownHostFixture();
		host.resolveImage.mockResolvedValue("data:image/png;base64,ZmFrZQ==");
		render(<MarkdownContent {...props} host={host} text="![Example](./assets/example.png)" />);
		const image = await screen.findByRole("img", { name: "Example" });
		expect(host.resolveImage).toHaveBeenCalledWith("./assets/example.png");
		fireEvent.error(image);
		expect(screen.queryByRole("button", { name: "Enlarge" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByRole("img", { name: "Example" });
		fireEvent.click(screen.getByRole("button", { name: "Enlarge" }));
		expect(host.openImage).toHaveBeenCalledWith("data:image/png;base64,ZmFrZQ==", "Example");
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		await screen.findByRole("button", { name: "Copied" });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(host.saveImage).toHaveBeenCalledWith("data:image/png;base64,ZmFrZQ=="));
	});
	it("shows recoverable action failure without losing the image", async () => {
		const { host } = createMarkdownHostFixture();
		host.copyImage.mockRejectedValueOnce(new Error("Clipboard busy"));
		render(<MarkdownContent {...props} host={host} text="![Example](https://example.test/a.png)" />);
		await screen.findByRole("img", { name: "Example" });
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		await screen.findByText(/Could not complete this action/);
		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		await screen.findByRole("button", { name: "Copied" });
	});
	it("renders a diagram after streaming finishes, switches source and exports the SVG", async () => {
		const { host } = createMarkdownHostFixture();
		const text = "```mermaid\ngraph TD; A-->B\n```";
		const view = render(<MarkdownContent {...props} host={host} text={text} isStreamingTail />);
		await screen.findByText(/^graph/, {}, { timeout: 3000 });
		await act(async () => { await vi.dynamicImportSettled(); });
		await screen.findByText(/Preview will appear/, {}, { timeout: 3000 });
		expect(host.renderMermaid).not.toHaveBeenCalled();
		view.rerender(<MarkdownContent {...props} host={host} text={text} />);
		await screen.findByRole("img", { name: "Diagram" });
		expect(host.renderMermaid).toHaveBeenCalledWith("graph TD; A-->B", "light");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(host.saveImage).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/svg\+xml/)));
		fireEvent.click(screen.getByRole("button", { name: "Source" }));
		expect(view.container.textContent).toContain("graph TD; A-->B");
		fireEvent.click(screen.getByRole("button", { name: "Preview" }));
		await screen.findByRole("img", { name: "Diagram" });
	});
	it("retries a diagram error and also renders diagrams from file preview", async () => {
		const { host } = createMarkdownHostFixture();
		host.renderMermaid.mockRejectedValueOnce(new Error("Worker stopped"));
		render(<MarkdownPreviewView theme="light" labels={props.labels} host={host} onOpenExternal={vi.fn()} content={"```mermaid\ngraph TD; A-->B\n```"} />);
		await screen.findByText(/Could not render/);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByRole("img", { name: "Diagram" });
	});
	it("discovers an origin icon without changing the destination of a private page link", async () => {
		const { host } = createMarkdownHostFixture();
		const data = "data:image/png;base64,aWNvbg==";
		const resolver = vi.fn(async () => data);
		const destination = "https://example.test/private?secret=value";
		render(<MarkdownContent {...props} host={{ ...host, favicon: resolver }} text={`[Page](${destination})`} />);
		await waitFor(() => expect(screen.getByRole("link", { name: "Page" }).querySelector("img")?.src).toBe(data));
		expect(resolver).toHaveBeenCalledWith("https://example.test");
		fireEvent.click(screen.getByRole("link", { name: "Page" }));
		expect(props.onOpenUrl).toHaveBeenCalledWith(destination);
	});
});
