// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { readClipboardImages } from "./clipboard-images";

function clipboardData(options: {
	html?: string;
	text?: string;
	items?: DataTransferItem[];
}): Parameters<typeof readClipboardImages>[0] {
	return {
		items: options.items ?? [],
		getData: (format) => (format === "text/html" ? (options.html ?? "") : (options.text ?? "")),
	};
}

describe("readClipboardImages", () => {
	it("reads every image from a marked Vetta message and ignores the duplicated native first image", () => {
		const duplicatedNativeFile = new File([new Uint8Array([9])], "native.png", { type: "image/png" });
		const result = readClipboardImages(
			clipboardData({
				html: `<div data-vetta-user-message="1"><img data-vetta-clipboard-image src="data:image/png;base64,AQID"><img data-vetta-clipboard-image src="data:image/png;base64,BAUG"></div>`,
				text: "message text",
				items: [
					{
						kind: "file",
						type: "image/png",
						getAsFile: vi.fn(() => duplicatedNativeFile),
					} as unknown as DataTransferItem,
				],
			}),
		);

		expect(result).toEqual({
			kind: "vetta-message",
			messageText: "message text",
			images: [
				{ data: "AQID", mimeType: "image/png", name: "copied-image-1.png" },
				{ data: "BAUG", mimeType: "image/png", name: "copied-image-2.png" },
			],
		});
		expect(duplicatedNativeFile.size).toBe(1);
	});

	it("keeps ordinary image-file paste behavior", () => {
		const file = new File([new Uint8Array([1])], "screenshot.png", { type: "image/png" });
		const result = readClipboardImages(
			clipboardData({
				items: [
					{
						kind: "file",
						type: "image/png",
						getAsFile: () => file,
					} as unknown as DataTransferItem,
				],
			}),
		);

		expect(result).toEqual({ kind: "files", files: [file] });
	});

	it("keeps Vetta image payloads encoded instead of allocating decoded Files", () => {
		const atobSpy = vi.spyOn(globalThis, "atob");
		const payload = "A".repeat(1_000_000);

		const result = readClipboardImages(
			clipboardData({
				html: `<div data-vetta-user-message="1"><img data-vetta-clipboard-image="" src="data:image/png;base64,${payload}" alt=""></div>`,
				text: "large image",
			}),
		);

		expect(result.kind).toBe("vetta-message");
		if (result.kind === "vetta-message") expect(result.images[0]?.data).toBe(payload);
		expect(atobSpy).not.toHaveBeenCalled();
	});
});
