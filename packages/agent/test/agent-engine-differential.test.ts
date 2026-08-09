import { Type } from "@sinclair/typebox";
import type { AssistantMessage, Message, ModelStreamResponse, ToolCall } from "@vetta/ai";
import { LanguageModelStream } from "@vetta/ai";
import { canonicalizeAssistantMessage, canonicalizeJsonValue } from "@vetta/ai/testkit";
import { describe, expect, it } from "vitest";
import { agentLoopContinue } from "../src/agent-loop.js";
import { runAgentTurn } from "../src/engine/run-agent-turn.js";
import type { AgentTurnRequest, RuntimeToolDefinition } from "../src/engine/types.js";
import type { AgentContext, AgentLoopConfig, AgentTool } from "../src/types.js";
import {
	createAssistantMessage,
	createModel,
	createUserMessage,
	identityConverter,
	MockAssistantStream,
} from "./support/agent-loop-fixtures.js";

const limits = {
	maxModelCalls: 10,
	maxToolCalls: 10,
	maxRecoveryAttempts: 1,
	checkpointTimeoutMs: 50,
} as const;
const echoSchema = Type.Object({ value: Type.String() });

describe("agent engine canonical differential", () => {
	it("preserves the text-only conversation outcome", async () => {
		const output = createAssistantMessage([{ type: "text", text: "hello" }]);
		const legacy = await runLegacy([legacyResponse(output)]);
		const modern = await runModern([modelResponse(output)]);

		expect(canonicalMessages(modern.messages.slice(1))).toEqual(canonicalMessages(legacy));
		expect(modern.status).toBe("completed");
	});

	it("preserves tool execution and model-visible tool results", async () => {
		const call: ToolCall = { type: "toolCall", id: "call-1", name: "echo", arguments: { value: "hello" } };
		const first = createAssistantMessage([call], "toolUse");
		const second = createAssistantMessage([{ type: "text", text: "done" }]);
		let legacyExecutions = 0;
		let modernExecutions = 0;
		const legacy = await runLegacy([legacyResponse(first), legacyResponse(second)], {
			tool: legacyTool(() => {
				legacyExecutions += 1;
			}),
		});
		const modern = await runModern([modelResponse(first), modelResponse(second)], {
			tool: modernTool(() => {
				modernExecutions += 1;
			}),
		});

		expect(canonicalMessages(modern.messages.slice(1))).toEqual(canonicalMessages(legacy));
		expect(modern.toolCalls).toBe(1);
		expect(modernExecutions).toBe(legacyExecutions);
	});

	it("preserves steering interruption and skipped tool results", async () => {
		const first = createAssistantMessage(
			[
				{ type: "toolCall", id: "call-1", name: "echo", arguments: { value: "one" } },
				{ type: "toolCall", id: "call-2", name: "echo", arguments: { value: "two" } },
			],
			"toolUse",
		);
		const second = createAssistantMessage([{ type: "text", text: "redirected" }]);
		const steering = createUserMessage("change direction");
		let legacyExecutions = 0;
		let modernExecutions = 0;
		const legacy = await runLegacy([legacyResponse(first), legacyResponse(second)], {
			tool: legacyTool(() => {
				legacyExecutions += 1;
			}),
			steering: [[], [steering], []],
		});
		const modern = await runModern([modelResponse(first), modelResponse(second)], {
			tool: modernTool(() => {
				modernExecutions += 1;
			}),
			steering: [[], [steering], []],
		});

		expect(canonicalMessages(modern.messages.slice(1))).toEqual(canonicalMessages(legacy));
		expect(modernExecutions).toBe(1);
		expect(modernExecutions).toBe(legacyExecutions);
	});

	it("preserves continuation ordering after a natural stop", async () => {
		const first = createAssistantMessage([{ type: "text", text: "first" }]);
		const second = createAssistantMessage([{ type: "text", text: "continued" }]);
		const continuation = createUserMessage("continue");
		const legacy = await runLegacy([legacyResponse(first), legacyResponse(second)], {
			continuation: [[continuation], []],
		});
		const modern = await runModern([modelResponse(first), modelResponse(second)], {
			continuation: [[continuation], []],
		});

		expect(canonicalMessages(modern.messages.slice(1))).toEqual(canonicalMessages(legacy));
		expect(modern.modelCalls).toBe(2);
	});
});

interface LegacyRunOptions {
	readonly tool?: AgentTool<typeof echoSchema>;
	readonly steering?: readonly (readonly Message[])[];
	readonly continuation?: readonly (readonly Message[])[];
}

interface ModernRunOptions {
	readonly tool?: RuntimeToolDefinition;
	readonly steering?: readonly (readonly Message[])[];
	readonly continuation?: readonly (readonly Message[])[];
}

async function runLegacy(
	responses: readonly MockAssistantStream[],
	options: LegacyRunOptions = {},
): Promise<Message[]> {
	const steering = options.steering?.map((batch) => [...batch]);
	const continuation = options.continuation?.map((batch) => [...batch]);
	const context: AgentContext = {
		systemPrompt: "test",
		messages: [createUserMessage("start")],
		tools: options.tool ? [options.tool] : [],
	};
	const config: AgentLoopConfig = {
		model: createModel(),
		convertToLlm: identityConverter,
		...(steering ? { getSteeringMessages: async () => steering.shift() ?? [] } : {}),
		...(continuation ? { getContinuationMessages: async () => continuation.shift() ?? [] } : {}),
	};
	let index = 0;
	const stream = agentLoopContinue(context, config, undefined, () => {
		const response = responses[index];
		if (!response) throw new Error(`No legacy response at index ${index}`);
		index += 1;
		return response;
	});
	for await (const _event of stream) {
		// Drain the legacy stream so iterator and result are both exercised.
	}
	return (await stream.result()) as Message[];
}

async function runModern(responses: readonly ModelStreamResponse[], options: ModernRunOptions = {}) {
	const steering = options.steering?.map((batch) => [...batch]);
	const continuation = options.continuation?.map((batch) => [...batch]);
	let index = 0;
	const request: AgentTurnRequest = {
		messages: [createUserMessage("start")],
		resolveTools: async () => (options.tool ? [options.tool] : []),
		resolveModelCall: async () => {
			const response = responses[index];
			if (!response) throw new Error(`No modern response at index ${index}`);
			index += 1;
			return { callId: `call-${index}`, snapshotId: `snapshot-${index}`, response };
		},
		toolPolicy: { authorize: async () => undefined },
		...(steering ? { takeSteeringMessages: async () => steering.shift() ?? [] } : {}),
		...(continuation ? { takeContinuationMessages: async () => continuation.shift() ?? [] } : {}),
		limits,
		signal: new AbortController().signal,
	};
	const run = runAgentTurn(request);
	for await (const _event of run.events) {
		// Drain the new stream so iterator and result are both exercised.
	}
	return await run.result;
}

function legacyResponse(message: AssistantMessage): MockAssistantStream {
	const stream = new MockAssistantStream();
	stream.push({
		type: "done",
		reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
		message,
	});
	return stream;
}

function modelResponse(message: AssistantMessage): ModelStreamResponse {
	const stream = new LanguageModelStream();
	stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
	return { events: stream, result: stream.result() };
}

function legacyTool(onExecute: () => void): AgentTool<typeof echoSchema> {
	return {
		name: "echo",
		label: "Echo",
		description: "Echo a value",
		parameters: echoSchema,
		async execute(_toolCallId, input) {
			onExecute();
			return { content: [{ type: "text", text: input.value }], details: { value: input.value } };
		},
	};
}

function modernTool(onExecute: () => void): RuntimeToolDefinition<typeof echoSchema> {
	return {
		name: "echo",
		description: "Echo a value",
		inputSchema: echoSchema,
		async execute(input) {
			onExecute();
			return { content: [{ type: "text", text: input.value }], details: { value: input.value } };
		},
	};
}

function canonicalMessages(messages: readonly Message[]): unknown[] {
	return messages.map((message) => {
		if (message.role === "assistant") return canonicalizeAssistantMessage(message);
		if (message.role === "user") return { role: "user", content: canonicalizeJsonValue(message.content) };
		return {
			role: "toolResult",
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			content: canonicalizeJsonValue(message.content),
			details: canonicalizeJsonValue(message.details),
			isError: message.isError,
		};
	});
}
