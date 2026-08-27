import type { NativeImage } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
	createUserMessageClipboardHtml,
	readUserMessageClipboard,
	type UserMessageClipboardDependencies,
	writeUserMessageClipboard,
} from "./user-message-clipboard";

function fakeImage(dataUrl: string): NativeImage {
	return {
		isEmpty: () => false,
		toDataURL: () => dataUrl,
	} as unknown as NativeImage;
}

describe("user message clipboard", () => {
	it("marks every image and escapes message text in the HTML format", () => {
		const html = createUserMessageClipboardHtml("<script>alert('x')</script>", [
			"data:image/png;base64,first",
			"data:image/png;base64,second",
		]);

		expect(html).toContain('data-vetta-user-message="1"');
		expect(html.match(/data-vetta-clipboard-image/g)).toHaveLength(2);
		expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
		expect(html).not.toContain("<script>");
	});

	it("writes text, rich HTML, and the first native image atomically", () => {
		const first = fakeImage("data:image/png;base64,normalized-first");
		const second = fakeImage("data:image/png;base64,normalized-second");
		const write = vi.fn();
		const dependencies: UserMessageClipboardDependencies = {
			clipboard: { write },
			nativeImage: {
				createFromDataURL: vi.fn((dataUrl) => (dataUrl.endsWith("first") ? first : second)),
			},
		};

		writeUserMessageClipboard(
			{
				text: "hello",
				images: ["data:image/png;base64,first", "data:image/png;base64,second"],
			},
			dependencies,
		);

		expect(write).toHaveBeenCalledOnce();
		expect(write).toHaveBeenCalledWith({
			text: "hello",
			html: expect.stringContaining("data:image/png;base64,normalized-second"),
			image: first,
		});
	});

	it("reads only marked Vetta rich messages", () => {
		expect(readUserMessageClipboard({ readHTML: () => "<p>ordinary</p>", readText: () => "ordinary" })).toBeNull();
		expect(
			readUserMessageClipboard({
				readHTML: () => '<div data-vetta-user-message="1"></div>',
				readText: () => "hello",
			}),
		).toEqual({ text: "hello", html: '<div data-vetta-user-message="1"></div>' });
	});
});
