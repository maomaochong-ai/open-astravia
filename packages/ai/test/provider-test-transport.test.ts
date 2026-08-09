import { describe, expect, it } from "vitest";
import {
	createControlledSseResponse,
	createProviderTestTransport,
	emptySseResponse,
	errorResponse,
	jsonResponse,
	sseResponse,
} from "../src/testing/provider-test-transport.js";

describe("provider test transport", () => {
	it("returns JSON and records the normalized request", async () => {
		const transport = createProviderTestTransport([jsonResponse({ ok: true })]);

		const response = await transport.fetch("https://provider.test/v1/messages", {
			method: "POST",
			headers: { authorization: "Bearer secret", "content-type": "application/json" },
			body: JSON.stringify({ prompt: "hello" }),
		});

		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(transport.requests).toHaveLength(1);
		expect(transport.requests[0]).toMatchObject({
			url: "https://provider.test/v1/messages",
			method: "POST",
			body: '{"prompt":"hello"}',
		});
		expect(transport.requests[0]?.headers.get("authorization")).toBe("Bearer secret");
		expect(transport.remaining).toBe(0);
	});

	it("encodes static and empty SSE responses", async () => {
		const stream = sseResponse([{ event: "message", data: { text: "hello" } }, { data: "[DONE]" }]);

		expect(stream.headers.get("content-type")).toBe("text/event-stream");
		await expect(stream.text()).resolves.toBe('event: message\ndata: {"text":"hello"}\n\ndata: [DONE]\n\n');
		await expect(emptySseResponse().text()).resolves.toBe("");
	});

	it("creates deterministic HTTP errors", async () => {
		const response = errorResponse(429, { error: { message: "rate limited" } }, { headers: { "retry-after": "1" } });

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("1");
		await expect(response.json()).resolves.toEqual({ error: { message: "rate limited" } });
	});

	it("allows tests to control SSE delivery", async () => {
		const controlled = createControlledSseResponse();
		const body = controlled.response.text();
		controlled.emit({ event: "delta", data: { text: "a" } });
		controlled.emit({ event: "delta", data: { text: "b" } });
		controlled.close();

		await expect(body).resolves.toBe('event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n\n');
	});

	it("rejects aborted and exhausted requests with structured errors", async () => {
		const controller = new AbortController();
		controller.abort();
		const transport = createProviderTestTransport([]);

		await expect(transport.fetch("https://provider.test", { signal: controller.signal })).rejects.toMatchObject({
			code: "AI_ABORTED",
		});
		await expect(transport.fetch("https://provider.test")).rejects.toMatchObject({
			code: "AI_INVALID_REQUEST",
			metadata: { callIndex: 0, url: "https://provider.test/" },
		});
	});
});
