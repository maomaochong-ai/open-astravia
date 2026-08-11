import { Type } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { agentLoopContinue } from "../src/agent-loop.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentTool } from "../src/types.js";
import {
	createAssistantMessage,
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

async function collect(stream: AsyncIterable<AgentEvent>, onEvent?: (event: AgentEvent) => void): Promise<void> {
	for await (const event of stream) onEvent?.(event);
}

function context(tools: AgentTool[] = []): AgentContext {
	return {
		systemPrompt: "You are helpful.",
		messages: [createUserMessage("hello")],
		tools,
	};
}

function config(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
	return {
		model: createModel(),
		convertToLlm: identityConverter,
		...overrides,
	};
}

function response(content: Parameters<typeof createAssistantMessage>[0], stopReason: "stop" | "toolUse") {
	const stream = new MockAssistantStream();
	queueMicrotask(() => {
		stream.push({ type: "done", reason: stopReason, message: createAssistantMessage(content, stopReason) });
	});
	return stream;
}

function tool(execute: () => void): AgentTool {
	return {
		name: "repeat",
		label: "repeat",
		description: "repeat",
		parameters: Type.Object({}),
		async execute() {
			execute();
			return { content: [{ type: "text", text: "done" }], details: {} };
		},
	};
}

describe("agent loop finite execution limits", () => {
	it("ends a checkpoint that the host never completes", async () => {
		const stream = agentLoopContinue(
			context(),
			config({ contextCheckpoints: true, limits: { contextCheckpointTimeoutMs: 10 } }),
			undefined,
			() => response([{ type: "text", text: "unreachable" }], "stop"),
		);
		const iteration = collect(stream);

		await expect(within(stream.result())).resolves.toEqual([]);
		await expect(within(iteration)).resolves.toBeUndefined();
	});

	it("ends a pending checkpoint when the run is aborted", async () => {
		const controller = new AbortController();
		const stream = agentLoopContinue(context(), config({ contextCheckpoints: true }), controller.signal, () =>
			response([{ type: "text", text: "unreachable" }], "stop"),
		);
		const iteration = collect(stream, (event) => {
			if (event.type === "context_checkpoint") controller.abort("cancelled by test");
		});

		await expect(within(stream.result())).resolves.toEqual([]);
		await expect(within(iteration)).resolves.toBeUndefined();
	});

	it("rejects before exceeding the model-call budget", async () => {
		let modelCalls = 0;
		const repeatTool = tool(() => undefined);
		const stream = agentLoopContinue(
			context([repeatTool]),
			config({ limits: { maxModelCalls: 2 } }),
			undefined,
			() => {
				modelCalls += 1;
				if (modelCalls <= 2) {
					return response(
						[{ type: "toolCall", id: `call-${modelCalls}`, name: "repeat", arguments: {} }],
						"toolUse",
					);
				}
				return response([{ type: "text", text: "legacy loop completed" }], "stop");
			},
		);
		const iteration = collect(stream);

		await expect(within(stream.result())).rejects.toMatchObject({
			code: "AGENT_LOOP_LIMIT_EXCEEDED",
			kind: "model_calls",
			limit: 2,
		});
		await expect(within(iteration)).rejects.toMatchObject({ code: "AGENT_LOOP_LIMIT_EXCEEDED" });
		expect(modelCalls).toBe(2);
	});

	it("rejects a response whose tool calls exceed the tool-call budget", async () => {
		let modelCalls = 0;
		let toolExecutions = 0;
		const repeatTool = tool(() => {
			toolExecutions += 1;
		});
		const stream = agentLoopContinue(
			context([repeatTool]),
			config({ limits: { maxToolCalls: 1 } }),
			undefined,
			() => {
				modelCalls += 1;
				if (modelCalls > 1) return response([{ type: "text", text: "legacy loop completed" }], "stop");
				return response(
					[
						{ type: "toolCall", id: "call-1", name: "repeat", arguments: {} },
						{ type: "toolCall", id: "call-2", name: "repeat", arguments: {} },
					],
					"toolUse",
				);
			},
		);
		const iteration = collect(stream);

		await expect(within(stream.result())).rejects.toMatchObject({
			code: "AGENT_LOOP_LIMIT_EXCEEDED",
			kind: "tool_calls",
			limit: 1,
		});
		await expect(within(iteration)).rejects.toMatchObject({ code: "AGENT_LOOP_LIMIT_EXCEEDED" });
		expect(toolExecutions).toBe(0);
	});
});
