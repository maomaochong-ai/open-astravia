import type { NativeImage } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
	createUserMessageClipboardHtml,
	pasteUserMessageClipboard,
	readUserMessageClipboard,
	type UserMessageClipboardDependencies,
	type UserMessageClipboardPasteDependencies,
	writeUserMessageClipboard,
} from "./user-message-clipboard";

function fakeImage(dataUrl: string): NativeImage {
	return {
		isEmpty: () => false,
		toDataURL: vi.fn(() => dataUrl),
	} as unknown as NativeImage;
}

function dependencies(
	images: Record<string, NativeImage>,
	overrides: Partial<UserMessageClipboardDependencies> = {},
): UserMessageClipboardDependencies {
	return {
		clipboard: { write: vi.fn() },
		nativeImage: { createFromDataURL: vi.fn((dataUrl) => images[dataUrl] ?? fakeImage(dataUrl)) },
		readFile: vi.fn(async () => Buffer.from([1, 2, 3])),
		assertPathReadable: vi.fn(),
		...overrides,
	};
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

	it("writes text, rich HTML, and the first native image atomically without re-encoding safe raster data", async () => {
		const first = fakeImage("data:image/png;base64,normalized-first");
		const second = fakeImage("data:image/png;base64,normalized-second");
		const write = vi.fn();
		const testDependencies = dependencies(
			{
				"data:image/png;base64,first": first,
				"data:image/png;base64,second": second,
			},
			{ clipboard: { write } },
		);

		await writeUserMessageClipboard(
			{
				text: "hello",
				images: [
					{ kind: "data-url", dataUrl: "data:image/png;base64,first" },
					{ kind: "data-url", dataUrl: "data:image/png;base64,second" },
				],
			},
			testDependencies,
		);

		expect(write).toHaveBeenCalledOnce();
		expect(write).toHaveBeenCalledWith({
			text: "hello",
			html: expect.stringContaining("data:image/png;base64,second"),
			image: first,
		});
		expect(first.toDataURL).not.toHaveBeenCalled();
		expect(second.toDataURL).not.toHaveBeenCalled();
	});

	it("reads allowed local image files in main and preserves their raster bytes", async () => {
		const write = vi.fn();
		const readFile = vi.fn(async () => Buffer.from([1, 2, 3]));
		const assertPathReadable = vi.fn();
		const testDependencies = dependencies({}, { clipboard: { write }, readFile, assertPathReadable });

		await writeUserMessageClipboard(
			{
				text: "image",
				images: [{ kind: "file-path", path: "C:/images/copied.png" }],
			},
			testDependencies,
		);

		expect(assertPathReadable).toHaveBeenCalledWith("C:/images/copied.png");
		expect(readFile).toHaveBeenCalledWith("C:/images/copied.png");
		expect(write).toHaveBeenCalledWith({
			text: "image",
			html: expect.stringContaining("data:image/png;base64,AQID"),
			image: expect.any(Object),
		});
	});

	it("normalizes markup-capable image formats before embedding them in clipboard HTML", async () => {
		const source = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
		const image = fakeImage("data:image/png;base64,normalized");
		const write = vi.fn();
		const testDependencies = dependencies({ [source]: image }, { clipboard: { write } });

		await writeUserMessageClipboard(
			{ text: "svg", images: [{ kind: "data-url", dataUrl: source }] },
			testDependencies,
		);

		expect(image.toDataURL).toHaveBeenCalledOnce();
		expect(write).toHaveBeenCalledWith({
			text: "svg",
			html: expect.stringContaining("data:image/png;base64,normalized"),
			image,
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

	it("persists rich clipboard images in main and returns only lightweight metadata", async () => {
		const persistImages: UserMessageClipboardPasteDependencies["persistImages"] = vi.fn(async () => [
			{ path: "C:/cache/copied.png", format: "png", sizeBytes: 3, width: 10, height: 20 },
		]);
		const result = await pasteUserMessageClipboard("session-1", {
			clipboard: {
				readHTML: () =>
					'<div data-vetta-user-message="1"><img data-vetta-clipboard-image src="data:image/png;base64,AQID"></div>',
				readText: () => "before @C:/old/copied.png after",
			},
			persistImages,
			createId: () => "generated-id",
		});

		expect(persistImages).toHaveBeenCalledWith("session-1", [
			{ id: "generated-id", data: "AQID", mimeType: "image/png" },
		]);
		expect(result).toEqual({
			text: "before @C:/old/copied.png after",
			images: [{ path: "C:/cache/copied.png", format: "png", sizeBytes: 3, width: 10, height: 20 }],
		});
	});
});
