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

		expect(result.messageText).toBe("message text");
		expect(result.files).toHaveLength(2);
		expect(result.files.map((file) => file.name)).toEqual(["copied-image-1.png", "copied-image-2.png"]);
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

		expect(result).toEqual({ files: [file] });
	});
});
