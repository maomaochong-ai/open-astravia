import { describe, expect, it, vi } from "vitest";
import type { Context, Model } from "../src/types.js";

const mockState = vi.hoisted(() => ({
	constructorOpts: undefined as Record<string, unknown> | undefined,
	streamParams: undefined as Record<string, unknown> | undefined,
}));

const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-4",
	name: "Claude Sonnet 4",
	api: "anthropic-messages",
	provider: "github-copilot",
	baseUrl: "https://api.githubcopilot.com",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 16_384,
	headers: {
		"User-Agent": "GitHubCopilotChat/0.26.7",
		"Copilot-Integration-Id": "vscode-chat",
	},
};

vi.mock("@anthropic-ai/sdk", () => {
	const fakeStream = {
		async *[Symbol.asyncIterator]() {
			yield {
				type: "message_start",
				message: {
					usage: { input_tokens: 10, output_tokens: 0 },
				},
			};
			yield {
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 5 },
			};
		},
		finalMessage: async () => ({
			usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
		}),
	};

	class FakeAnthropic {
		constructor(opts: Record<string, unknown>) {
			mockState.constructorOpts = opts;
		}
		messages = {
			stream: (params: Record<string, unknown>) => {
				mockState.streamParams = params;
				return fakeStream;
			},
		};
	}

	return { default: FakeAnthropic };
});

describe("Copilot Claude via Anthropic Messages", () => {
	const context: Context = {
		systemPrompt: "You are a helpful assistant.",
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};

	it("uses Bearer auth, Copilot headers, and valid Anthropic Messages payload", async () => {
		expect(model.api).toBe("anthropic-messages");

		const { streamAnthropic } = await import("../src/providers/anthropic.js");
		const s = streamAnthropic(model, context, { apiKey: "tid_copilot_session_test_token" });
		for await (const event of s) {
			if (event.type === "error") break;
		}

		const opts = mockState.constructorOpts!;
		expect(opts).toBeDefined();

		// Auth: apiKey null, authToken for Bearer
		expect(opts.apiKey).toBeNull();
		expect(opts.authToken).toBe("tid_copilot_session_test_token");
		const headers = opts.defaultHeaders as Record<string, string>;

		// Copilot static headers from model.headers
		expect(headers["User-Agent"]).toContain("GitHubCopilotChat");
		expect(headers["Copilot-Integration-Id"]).toBe("vscode-chat");

		// Dynamic headers
		expect(headers["X-Initiator"]).toBe("user");
		expect(headers["Openai-Intent"]).toBe("conversation-edits");

		// No fine-grained-tool-streaming (Copilot doesn't support it)
		const beta = headers["anthropic-beta"] ?? "";
		expect(beta).not.toContain("fine-grained-tool-streaming");

		// Payload is valid Anthropic Messages format
		const params = mockState.streamParams!;
		expect(params.model).toBe("claude-sonnet-4");
		expect(params.stream).toBe(true);
		expect(params.max_tokens).toBeGreaterThan(0);
		expect(Array.isArray(params.messages)).toBe(true);
	});

	it("includes interleaved-thinking beta when reasoning is enabled", async () => {
		const { streamAnthropic } = await import("../src/providers/anthropic.js");
		const s = streamAnthropic(model, context, {
			apiKey: "tid_copilot_session_test_token",
			interleavedThinking: true,
		});
		for await (const event of s) {
			if (event.type === "error") break;
		}

		const headers = mockState.constructorOpts!.defaultHeaders as Record<string, string>;
		expect(headers["anthropic-beta"]).toContain("interleaved-thinking-2025-05-14");
	});
});
