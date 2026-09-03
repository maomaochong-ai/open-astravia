import { describe, expect, it, vi } from "vitest";
import { readPluginServiceResponse } from "./plugin-service-response.js";

describe("readPluginServiceResponse", () => {
	it("limits streamed bodies even without a content-length header", async () => {
		const cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(new Uint8Array(3));
			},
			cancel,
		});
		await expect(readPluginServiceResponse(new Response(stream), 5)).rejects.toThrow("too large");
		expect(cancel).toHaveBeenCalledOnce();
	});
	it("preserves a response exactly at the limit", async () => {
		expect((await readPluginServiceResponse(new Response("hello"), 5)).toString()).toBe("hello");
	});
	it("rejects an oversized declared body before buffering it", async () => {
		await expect(
			readPluginServiceResponse(new Response("hello", { headers: { "content-length": "6" } }), 5),
		).rejects.toThrow("too large");
	});
});
