import { describe, expect, it, vi } from "vitest";
import { imageFileName, resolveMarkdownImage } from "./markdown-images";

describe("Markdown image resources", () => {
	it("reads relative local assets as image data and preserves remote document bases", async () => {
		const read = vi.fn(async () => ({ content: "aW1hZ2U=", encoding: "base64" as const }));
		expect(await resolveMarkdownImage("assets/a%20b.png", "/work/docs", read)).toBe("data:image/png;base64,aW1hZ2U=");
		expect(read).toHaveBeenCalledWith("assets/a b.png");
		expect(await resolveMarkdownImage("../image.png", "https://example.com/docs", read)).toBe(
			"https://example.com/image.png",
		);
	});
	it("rejects arbitrary schemes and non-image local files", async () => {
		const read = vi.fn();
		for (const source of [
			"javascript:alert(1)",
			"file:///secret.png",
			"notes.txt",
			"data:text/html,<script>1</script>",
		]) {
			await expect(resolveMarkdownImage(source, "/work", read)).rejects.toThrow();
		}
		expect(read).not.toHaveBeenCalled();
	});
	it("retains SVG format for vector export", () =>
		expect(imageFileName("data:image/svg+xml;charset=utf-8,%3Csvg%3E")).toBe("image.svg"));
});
