import { describe, expect, it } from "vitest";
import { agentLoop, agentLoopContinue } from "../src/agent-loop.js";
import type { AgentContext, AgentEvent, AgentLoopConfig } from "../src/types.js";
import {
	createModel,
	createUserMessage,
	identityConverter,
	MockAssistantStream,
} from "./support/agent-loop-fixtures.js";

async function within<T>(promise: Promise<T>, timeoutMs = 100): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error("Agent stream did not settle")), timeoutMs);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<void> {
	for await (const _event of stream) {
		// Consume the complete execution stream.
	}
}

describe("agent loop failure contract", () => {
	it("rejects iteration and result when the model stream factory throws", async () => {
		const context: AgentContext = {
			systemPrompt: "You are helpful.",
			messages: [createUserMessage("hello")],
			tools: [],
		};
		const config: AgentLoopConfig = {
			model: createModel(),
			convertToLlm: identityConverter,
		};
		const failure = new Error("model stream factory failed");
		const stream = agentLoopContinue(context, config, undefined, async () => {
			throw failure;
		});

		const iteration = collect(stream);

		await expect(within(iteration)).rejects.toBe(failure);
		await expect(within(stream.result())).rejects.toBe(failure);
	});

	it("rejects both channels from the new-prompt loop entry", async () => {
		const failure = new Error("new prompt failed");
		const stream = agentLoop(
			[createUserMessage("hello")],
			{ systemPrompt: "You are helpful.", messages: [], tools: [] },
			{ model: createModel(), convertToLlm: identityConverter },
			undefined,
			async () => {
				throw failure;
			},
		);
		const iteration = collect(stream);

		await expect(within(iteration)).rejects.toBe(failure);
		await expect(within(stream.result())).rejects.toBe(failure);
	});

	it("rejects when initial steering resolution fails", async () => {
		const failure = new Error("steering failed");
		const stream = agentLoopContinue(
			{ systemPrompt: "You are helpful.", messages: [createUserMessage("hello")], tools: [] },
			{
				model: createModel(),
				convertToLlm: identityConverter,
				getSteeringMessages: async () => {
					throw failure;
				},
			},
		);
		const iteration = collect(stream);

		await expect(within(iteration)).rejects.toBe(failure);
		await expect(within(stream.result())).rejects.toBe(failure);
	});

	it("propagates a model stream failure", async () => {
		const failure = new Error("model stream failed");
		const stream = agentLoopContinue(
			{ systemPrompt: "You are helpful.", messages: [createUserMessage("hello")], tools: [] },
			{ model: createModel(), convertToLlm: identityConverter },
			undefined,
			() => {
				const response = new MockAssistantStream();
				queueMicrotask(() => response.fail(failure));
				return response;
			},
		);
		const iteration = collect(stream);

		await expect(within(iteration)).rejects.toBe(failure);
		await expect(within(stream.result())).rejects.toBe(failure);
	});

	it("rejects when the model stream ends without a terminal result", async () => {
		const stream = agentLoopContinue(
			{ systemPrompt: "You are helpful.", messages: [createUserMessage("hello")], tools: [] },
			{ model: createModel(), convertToLlm: identityConverter },
			undefined,
			() => {
				const response = new MockAssistantStream();
				queueMicrotask(() => response.end());
				return response;
			},
		);
		const iteration = collect(stream);

		const expectedError = {
			code: "AI_STREAM_PROTOCOL_FAILED",
			metadata: { reason: "ended_without_result" },
		};
		await expect(within(iteration)).rejects.toMatchObject(expectedError);
		await expect(within(stream.result())).rejects.toMatchObject(expectedError);
	});
});
