// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkdownPreviewView } from "@vetta-org/theme-ui/activity";
import { MarkdownContent } from "@vetta-org/theme-ui/markdown";
import { afterEach, describe, expect, it, vi } from "vitest";

function environment() {
	return {
		theme: "dark" as const,
		labels: { copy: "Copy", copied: "Copied" },
		getFileIconClass: () => "file-icon",
		onOpenFile: vi.fn(),
		onOpenUrl: vi.fn(),
	};
}

function icon(label: string): HTMLImageElement {
	const image = screen.getByRole("link", { name: label }).querySelector("img");
	expect(image).not.toBeNull();
	return image as HTMLImageElement;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("Markdown website icons", () => {
	it("loads a decorative site icon while preserving link navigation before and after load", async () => {
		const user = userEvent.setup();
		const props = environment();
		const url = "https://docs.example.test/guide?lang=zh#install";
		const view = render(<MarkdownContent {...props} text={`[Documentation](${url})`} />);
		const image = icon("Documentation");
		expect(image.getAttribute("src")).toBe("https://docs.example.test/favicon.ico");
		expect(image.getAttribute("loading")).toBe("lazy");
		expect(image.getAttribute("decoding")).toBe("async");
		expect(image.getAttribute("fetchpriority")).toBe("low");
		expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
		expect(image.alt).toBe("");
		expect(screen.queryByRole("img")).toBeNull();
		await user.click(screen.getByRole("link", { name: "Documentation" }));
		expect(props.onOpenUrl).toHaveBeenLastCalledWith(url);
		fireEvent.load(image);
		expect(image.classList.contains("opacity-100")).toBe(true);
		view.rerender(<MarkdownContent {...props} text={`[Documentation](${url}) and more text`} />);
		expect(icon("Documentation")).toBe(image);
		await user.click(screen.getByRole("link", { name: "Documentation" }));
		expect(props.onOpenUrl).toHaveBeenCalledTimes(2);
	});

	it("falls back after failure, shares the cooldown across pages, and retries on remount after expiry", () => {
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
		const props = environment();
		const first = render(<MarkdownContent {...props} text="[Missing](https://missing-icon.example.test/a)" />);
		fireEvent.error(icon("Missing"));
		expect(screen.getByRole("link", { name: "Missing" }).querySelector("img")).toBeNull();
		fireEvent.click(screen.getByRole("link", { name: "Missing" }));
		expect(props.onOpenUrl).toHaveBeenCalledWith("https://missing-icon.example.test/a");
		first.unmount();
		const second = render(<MarkdownContent {...props} text="[Other page](https://missing-icon.example.test/b)" />);
		expect(screen.getByRole("link", { name: "Other page" }).querySelector("img")).toBeNull();
		second.unmount();
		now.mockReturnValue(1_300_001);
		render(<MarkdownContent {...props} text="[Retry](https://missing-icon.example.test/c)" />);
		fireEvent.load(icon("Retry"));
		expect(icon("Retry").classList.contains("opacity-100")).toBe(true);
	});

	it("recovers when a failed link changes to another site and removes embedded credentials from icon requests", () => {
		const props = environment();
		const view = render(<MarkdownContent {...props} text="[Site](https://old-icon.example.test)" />);
		fireEvent.error(icon("Site"));
		view.rerender(
			<MarkdownContent
				{...props}
				text="[Site](https://user:password@new-icon.example.test:8443/private?q=secret#part)"
			/>,
		);
		expect(icon("Site").getAttribute("src")).toBe("https://new-icon.example.test:8443/favicon.ico");
		fireEvent.load(icon("Site"));
		expect(icon("Site").classList.contains("opacity-100")).toBe(true);
	});

	it("uses the same icon in file previews without fetching icons for fragments or mail links", async () => {
		const open = vi.fn();
		const user = userEvent.setup();
		render(
			<MarkdownPreviewView
				theme="light"
				onOpenExternal={open}
				content="[Website](http://preview-icon.example.test:3000/doc) [Mail](mailto:test@example.test) [Section](#part) [Local](./guide.md)"
			/>,
		);
		expect(icon("Website").getAttribute("src")).toBe("http://preview-icon.example.test:3000/favicon.ico");
		for (const name of ["Mail", "Section", "Local"]) {
			expect(screen.getByRole("link", { name }).querySelector("img")).toBeNull();
		}
		fireEvent.error(icon("Website"));
		await user.click(screen.getByRole("link", { name: "Website" }));
		expect(open).toHaveBeenLastCalledWith("http://preview-icon.example.test:3000/doc");
		await user.click(screen.getByRole("link", { name: "Mail" }));
		expect(open).toHaveBeenLastCalledWith("mailto:test@example.test");
	});

	it("keeps local file links on their existing icon and opening path", async () => {
		const props = environment();
		const user = userEvent.setup();
		render(<MarkdownContent {...props} text="[readme.md](/project/readme.md) [Mail](mailto:test@example.test) [Part](#part)" />);
		expect(document.querySelector("img")).toBeNull();
		await user.click(screen.getByRole("button", { name: "readme.md" }));
		expect(props.onOpenFile).toHaveBeenCalledWith("/project/readme.md");
		expect(props.onOpenUrl).not.toHaveBeenCalled();
	});

	it("bounds the failed-site cache when reading a history with many different websites", () => {
		const props = environment();
		const links = Array.from({ length: 129 }, (_, index) => `[Site ${index}](https://bounded-${index}.example.test)`);
		const history = render(<MarkdownContent {...props} text={links.join("\n\n")} />);
		const images = screen.getAllByRole("link").map((link) => link.querySelector("img"));
		for (const image of images) {
			expect(image).not.toBeNull();
			if (image) fireEvent.error(image);
		}
		history.unmount();
		render(<MarkdownContent {...props} text={`${links[0]} ${links[128]}`} />);
		expect(icon("Site 0").getAttribute("src")).toBe("https://bounded-0.example.test/favicon.ico");
		expect(screen.getByRole("link", { name: "Site 128" }).querySelector("img")).toBeNull();
	});
});
