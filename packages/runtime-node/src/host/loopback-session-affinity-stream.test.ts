import { createAssistantMessageEventStream, type Model, type SimpleStreamFunction } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import { createLoopbackSessionAffinityStream } from "./loopback-session-affinity-stream.js";

const CONTEXT = { messages: [] };

describe("createLoopbackSessionAffinityStream", () => {
	it.each([
		"http://localhost:8317/v1",
		"http://127.0.0.1:8317/v1",
		"http://127.23.45.67:8317/v1",
		"http://[::1]:8317/v1",
	])("adds session affinity to loopback gateway requests at %s", (baseUrl) => {
		const downstream = vi.fn<SimpleStreamFunction>(() => createAssistantMessageEventStream());
		const stream = createLoopbackSessionAffinityStream(downstream);

		stream(model(baseUrl), CONTEXT, { sessionId: "  conversation-42  ", headers: { "X-Trace": "trace" } });

		expect(downstream).toHaveBeenCalledWith(
			model(baseUrl),
			CONTEXT,
			expect.objectContaining({
				sessionId: "  conversation-42  ",
				headers: { "X-Trace": "trace", "X-Session-ID": "conversation-42" },
			}),
		);
	});

	it("uses the effective local gateway instead of the upstream base URL", () => {
		const downstream = vi.fn<SimpleStreamFunction>(() => createAssistantMessageEventStream());
		const targetModel = { ...model("https://api.example.com/v1"), gatewayUrl: "http://localhost:8317/v1" };

		createLoopbackSessionAffinityStream(downstream)(targetModel, CONTEXT, { sessionId: "conversation-42" });

		expect(downstream.mock.calls[0]?.[2]?.headers).toEqual({ "X-Session-ID": "conversation-42" });
	});

	it.each([
		["remote endpoint", model("https://api.example.com/v1"), { sessionId: "conversation-42" }],
		["missing session", model("http://localhost:8317/v1"), { maxTokens: 100 }],
		["invalid endpoint", model("not a url"), { sessionId: "conversation-42" }],
		[
			"remote gateway",
			{ ...model("http://localhost:8317/v1"), gatewayUrl: "https://api.example.com/v1" },
			{ sessionId: "conversation-42" },
		],
	] as const)("leaves options unchanged for %s", (_name, targetModel, options) => {
		const downstream = vi.fn<SimpleStreamFunction>(() => createAssistantMessageEventStream());
		const stream = createLoopbackSessionAffinityStream(downstream);

		stream(targetModel, CONTEXT, options);

		expect(downstream).toHaveBeenCalledWith(targetModel, CONTEXT, options);
		expect(downstream.mock.calls[0]?.[2]).toBe(options);
	});

	it.each([
		[
			"request options",
			model("http://localhost:8317/v1"),
			{ sessionId: "generated", headers: { "x-session-id": "explicit" } },
		],
		[
			"model configuration",
			{ ...model("http://localhost:8317/v1"), headers: { "X-SESSION-ID": "configured" } },
			{ sessionId: "generated" },
		],
	] as const)("preserves an explicit case-insensitive header from %s", (_name, targetModel, options) => {
		const downstream = vi.fn<SimpleStreamFunction>(() => createAssistantMessageEventStream());
		const stream = createLoopbackSessionAffinityStream(downstream);

		stream(targetModel, CONTEXT, options);

		expect(downstream).toHaveBeenCalledWith(targetModel, CONTEXT, options);
		expect(downstream.mock.calls[0]?.[2]).toBe(options);
	});
});

function model(baseUrl: string): Model<"openai-responses"> {
	return {
		api: "openai-responses",
		provider: "openai",
		id: "test-model",
		name: "Test Model",
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
	};
}
