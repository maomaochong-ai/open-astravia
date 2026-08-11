import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
	Type,
} from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { agentLoop } from "../src/agent-loop.js";
import type { AgentLoopConfig, AgentMessage, AgentTool } from "../src/types.js";

describe("tool execution context", () => {
	it("contains the assistant message that triggered the tool call", async () => {
		let executionMessages: readonly AgentMessage[] | undefined;
		const tool: AgentTool = {
			name: "inspect",
			label: "inspect",
			description: "inspect",
			parameters: Type.Object({}),
			async execute(_toolCallId, _input, _signal, _onUpdate, context) {
				executionMessages = context?.messages;
				return { content: [{ type: "text", text: "done" }], details: {} };
			},
		};
		const responses = [assistantToolCall(), assistantText("complete")];
		let responseIndex = 0;
		const config: AgentLoopConfig = {
			model: MODEL,
			convertToLlm: (messages) => messages.filter(isLlmMessage),
		};
		const stream = agentLoop(
			[{ role: "user", content: "inspect", timestamp: 1 }],
			{ systemPrompt: "test", messages: [], tools: [tool] },
			config,
			undefined,
			(_model, _context) => {
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		);

		for await (const _event of stream) {
			// Drain the full run.
		}

		expect(executionMessages?.map(({ role }) => role)).toEqual(["user", "assistant"]);
		expect(executionMessages?.[1]).toMatchObject({
			role: "assistant",
			content: [{ type: "toolCall", id: "call-1", name: "inspect", arguments: {} }],
		});
	});
});

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
			this.push({ type: "done", reason: successfulStopReason(message), message });
		});
	}
}

function isLlmMessage(message: AgentMessage): message is Message {
	return (
		"role" in message && (message.role === "user" || message.role === "assistant" || message.role === "toolResult")
	);
}

function successfulStopReason(message: AssistantMessage): "length" | "stop" | "toolUse" {
	if (message.stopReason === "length" || message.stopReason === "stop" || message.stopReason === "toolUse") {
		return message.stopReason;
	}
	throw new Error(`Recorded assistant message did not complete successfully: ${message.stopReason}`);
}

function assistantToolCall(): AssistantMessage {
	return assistantMessage([{ type: "toolCall", id: "call-1", name: "inspect", arguments: {} }], "toolUse");
}

function assistantText(text: string): AssistantMessage {
	return assistantMessage([{ type: "text", text }], "stop");
}

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 2,
	};
}

const MODEL: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
