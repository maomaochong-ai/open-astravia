// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyUserMessageToClipboard } from "./user-message-clipboard";

describe("copyUserMessageToClipboard", () => {
	beforeEach(() => {
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: vi.fn(async () => undefined) },
		});
	});

	it("loads persisted image URLs and forwards data URLs to the native clipboard", async () => {
		const writeUserMessage = vi.fn(async () => undefined);
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { clipboard: { writeUserMessage } },
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
			})),
		);

		await copyUserMessageToClipboard("hello", ["vetta-file://attachment.png"]);

		expect(writeUserMessage).toHaveBeenCalledWith({
			text: "hello",
			images: ["data:image/png;base64,AQID"],
		});
		expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
	});
});
