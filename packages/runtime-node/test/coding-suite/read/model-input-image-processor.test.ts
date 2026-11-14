import { describe, expect, it } from "vitest";
import { createNodeModelInputImageProcessor } from "../../../src/coding/model-input-image-processor.js";
import type { ImageResizeResult } from "../../../src/coding/tools/read/image-resize.js";

const RESIZED: ImageResizeResult = {
	data: "cmVzaXplZA==",
	mimeType: "image/jpeg",
	originalWidth: 4000,
	originalHeight: 3000,
	width: 1280,
	height: 960,
	wasResized: true,
};

function countingProcessor() {
	const calls: string[] = [];
	const processor = createNodeModelInputImageProcessor({
		resize: async (bytes) => {
			calls.push(Buffer.from(bytes).toString("base64"));
			return RESIZED;
		},
	});
	return { calls, processor };
}

describe("node model input image processor", () => {
	// 同一张历史图片会在一轮里的每次模型调用中重复出现；超限图片每次都重新缩放会反复阻塞 Electron 主进程。
	it("reuses the processed result when the same image appears in later model calls", async () => {
		const { calls, processor } = countingProcessor();
		const signal = new AbortController().signal;

		const first = await processor.resize("aW1hZ2UtYQ==", "image/png", signal);
		const second = await processor.resize("aW1hZ2UtYQ==", "image/png", signal);

		expect(second).toEqual(first);
		expect(second).toMatchObject({ data: RESIZED.data, mimeType: "image/jpeg" });
		expect(calls).toHaveLength(1);
	});

	it("processes the image again when the resize options change", async () => {
		const { calls, processor } = countingProcessor();
		const signal = new AbortController().signal;

		await processor.resize("aW1hZ2UtYQ==", "image/png", signal, { maxWidth: 1280 });
		await processor.resize("aW1hZ2UtYQ==", "image/png", signal, { maxWidth: 640 });
		await processor.resize("aW1hZ2UtYg==", "image/png", signal, { maxWidth: 640 });

		expect(calls).toHaveLength(3);
	});

	it("forgets the least recently used image once the limit is reached", async () => {
		const calls: string[] = [];
		const processor = createNodeModelInputImageProcessor({
			maxEntries: 2,
			resize: async (bytes) => {
				calls.push(Buffer.from(bytes).toString("base64"));
				return RESIZED;
			},
		});
		const signal = new AbortController().signal;

		await processor.resize("YQ==", "image/png", signal);
		await processor.resize("Yg==", "image/png", signal);
		await processor.resize("YQ==", "image/png", signal);
		await processor.resize("Yw==", "image/png", signal);
		await processor.resize("YQ==", "image/png", signal);
		await processor.resize("Yg==", "image/png", signal);

		expect(calls).toEqual(["YQ==", "Yg==", "Yw==", "Yg=="]);
	});

	it("does not remember a failed attempt so the next model call can retry", async () => {
		let attempts = 0;
		const processor = createNodeModelInputImageProcessor({
			resize: async () => {
				attempts += 1;
				if (attempts === 1) throw new Error("transient");
				return RESIZED;
			},
		});
		const signal = new AbortController().signal;

		await expect(processor.resize("aW1hZ2UtYQ==", "image/png", signal)).rejects.toThrow("transient");
		await expect(processor.resize("aW1hZ2UtYQ==", "image/png", signal)).resolves.toMatchObject({
			data: RESIZED.data,
		});
	});

	it("rejects an already aborted call without processing", async () => {
		const { calls, processor } = countingProcessor();
		const controller = new AbortController();
		controller.abort();

		await expect(processor.resize("aW1hZ2UtYQ==", "image/png", controller.signal)).rejects.toThrow();
		expect(calls).toHaveLength(0);
	});
});
