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

	it("forwards persisted image paths without reading or encoding them in the renderer", async () => {
		const writeUserMessage = vi.fn(async () => undefined);
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { clipboard: { writeUserMessage } },
		});
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await copyUserMessageToClipboard("hello", ["vetta-file://local/C:/attachments/attachment.png"]);

		expect(writeUserMessage).toHaveBeenCalledWith({
			text: "hello",
			images: [{ kind: "file-path", path: "C:/attachments/attachment.png" }],
		});
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
	});
});
