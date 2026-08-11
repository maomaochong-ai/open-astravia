import { Type } from "@sinclair/typebox";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, type Message, type Model } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { agentLoopContinue } from "../src/agent-loop.js";
import { AgentToolExecutionError } from "../src/tool-execution-error.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.js";

class RecordedAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected assistant event");
			},
		);
		queueMicrotask(() => {
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				this.push({ type: "error", reason: message.stopReason, error: message });
				return;
			}
			this.push({ type: "done", reason: message.stopReason, message });
		});
	}
}

describe("dynamic call context", () => {
	it("resolves prompt and tools before every model call", async () => {
		const toolSchema = Type.Object({});
		let toolExecutions = 0;
		const echo: AgentTool<typeof toolSchema, Record<string, never>> = {
			name: "echo",
			label: "Echo",
			description: "Echo",
			parameters: toolSchema,
			async execute() {
				toolExecutions += 1;
				return { content: [{ type: "text", text: "echo" }], details: {} };
			},
		};
		const context: AgentContext = {
			systemPrompt: "initial",
			messages: [{ role: "user", content: "start", timestamp: 1 }],
			tools: [],
		};
		let resolutionIndex = 0;
		const config: AgentLoopConfig = {
			model: model(),
			convertToLlm,
			async resolveCallContext() {
				const index = resolutionIndex;
				resolutionIndex += 1;
				return {
					systemPrompt: `prompt-${index + 1}`,
					tools: index === 0 ? [echo] : [],
				};
			},
		};
		const observedContexts: Array<{ readonly prompt: string; readonly tools: readonly string[] }> = [];
		let responseIndex = 0;
		const stream = agentLoopContinue(context, config, undefined, (_model, callContext) => {
			observedContexts.push({
				prompt: callContext.systemPrompt ?? "",
				tools: (callContext.tools ?? []).map(({ name }) => name),
			});
			const response =
				responseIndex === 0
					? assistantMessage([{ type: "toolCall", id: "tool-call-1", name: "echo", arguments: {} }], "toolUse")
					: assistantMessage([{ type: "text", text: "done" }]);
			responseIndex += 1;
			return new RecordedAssistantStream(response);
		});

		for await (const _event of stream) {
			// Consume the loop.
		}

		expect(observedContexts).toEqual([
			{ prompt: "prompt-1", tools: ["echo"] },
			{ prompt: "prompt-2", tools: [] },
		]);
		expect(toolExecutions).toBe(1);
		expect(resolutionIndex).toBe(2);
	});

	it("preserves structured tool error details in the tool result", async () => {
		const toolSchema = Type.Object({});
		const tool: AgentTool<typeof toolSchema, Record<string, never>> = {
			name: "failing",
			label: "Failing",
			description: "Fails with structured details",
			parameters: toolSchema,
			async execute() {
				throw new AgentToolExecutionError("Capability is unavailable", {
					code: "capability_unavailable",
					retryable: true,
					metadata: { capabilityId: "failing" },
				});
			},
		};
		const context: AgentContext = {
			systemPrompt: "",
			messages: [{ role: "user", content: "start", timestamp: 1 }],
			tools: [tool],
		};
		const config: AgentLoopConfig = {
			model: model(),
			convertToLlm,
		};
		let responseIndex = 0;
		const stream = agentLoopContinue(context, config, undefined, () => {
			const response =
				responseIndex === 0
					? assistantMessage([{ type: "toolCall", id: "tool-call-1", name: "failing", arguments: {} }], "toolUse")
					: assistantMessage([{ type: "text", text: "recovered" }]);
			responseIndex += 1;
			return new RecordedAssistantStream(response);
		});
		const events: AgentEvent[] = [];

		for await (const event of stream) {
			events.push(event);
		}

		const toolResult = events.find((event) => event.type === "message_end" && event.message.role === "toolResult");
		expect(toolResult).toMatchObject({
			message: {
				isError: true,
				content: [{ type: "text", text: "Capability is unavailable" }],
				details: {
					code: "capability_unavailable",
					retryable: true,
					metadata: { capabilityId: "failing" },
				},
			},
		});
	});
});

function model(): Model<"openai-responses"> {
	return {
		id: "mock",
		name: "mock",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8_192,
		maxTokens: 2_048,
	};
}

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 2,
	};
}

function convertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message): message is Message =>
			message.role === "user" || message.role === "assistant" || message.role === "toolResult",
	);
}
