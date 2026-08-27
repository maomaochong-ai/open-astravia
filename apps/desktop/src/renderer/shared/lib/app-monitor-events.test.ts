// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordInputImagesAdded } from "./app-monitor-events";

describe("app monitor image events", () => {
	const recordEvent = vi.fn();

	beforeEach(() => {
		recordEvent.mockClear();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { appMonitor: { recordEvent } },
		});
	});

	it("records persisted metadata synchronously without decoding pixels or forwarding paths", () => {
		const imageConstructor = vi.spyOn(globalThis, "Image");
		const persisted = {
			path: "C:/private/cache/copied.png",
			format: "png",
			sizeBytes: 100.9,
			width: 863.8,
			height: 862.2,
		};

		recordInputImagesAdded("paste", [persisted]);

		expect(imageConstructor).not.toHaveBeenCalled();
		expect(recordEvent).toHaveBeenCalledWith({
			type: "input.attachments.added",
			source: "paste",
			images: [{ format: "png", sizeBytes: 100, width: 863, height: 862 }],
		});
		imageConstructor.mockRestore();
	});
});
