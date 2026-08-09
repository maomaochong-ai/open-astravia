import { Type } from "@sinclair/typebox";
import {
	AIError,
	type AssistantMessage,
	LanguageModelStream,
	type Message,
	type ModelStreamResponse,
	type ToolCall,
} from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { runAgentTurn } from "../src/engine/run-agent-turn.js";
import type {
	AgentExecutionEvent,
	AgentTurnRequest,
	ResolvedModelCall,
	RuntimeToolDefinition,
} from "../src/engine/types.js";

const DEFAULT_LIMITS = {
	maxModelCalls: 10,
	maxToolCalls: 10,
	maxRecoveryAttempts: 2,
	checkpointTimeoutMs: 50,
} as const;

describe("runAgentTurn", () => {
	it("completes a text-only run with a finite event and result lifecycle", async () => {
		const run = runAgentTurn(request([successResponse(assistant([{ type: "text", text: "done" }]))]));
		const events = await collect(run.events);
		const result = await within(run.result);

		expect(result).toMatchObject({ status: "completed", modelCalls: 1, toolCalls: 0, recoveryAttempts: 0 });
		expect(events.map((event) => event.type)).toEqual([
			"run_start",
			"model_call_start",
			"model_event",
			"model_event",
			"model_call_finish",
			"assistant_message",
			"run_finish",
		]);
	});

	it("validates, authorizes, and executes a typed tool before the next model call", async () => {
		const schema = Type.Object({ value: Type.String() });
		const executions: string[] = [];
		const authorizations: string[] = [];
		const tool: RuntimeToolDefinition<typeof schema> = {
			name: "echo",
			description: "Echo a value",
			inputSchema: schema,
			async execute(input) {
				executions.push(input.value);
				return { content: [{ type: "text", text: input.value }], details: { value: input.value } };
			},
		};
		const modelContexts: readonly Message[][] = [];
		const contexts: Message[][] = modelContexts as Message[][];
		const run = runAgentTurn({
			...request([
				successResponse(assistant([toolCall("call-1", "echo", { value: "hello" })], "toolUse")),
				successResponse(assistant([{ type: "text", text: "finished" }])),
			]),
			resolveTools: async () => [tool],
			toolPolicy: {
				async authorize({ call }) {
					authorizations.push(call.id);
				},
			},
			resolveModelCall: scriptedResolver(
				[
					successResponse(assistant([toolCall("call-1", "echo", { value: "hello" })], "toolUse")),
					successResponse(assistant([{ type: "text", text: "finished" }])),
				],
				(context) => contexts.push([...context.messages]),
			),
		});

		const result = await run.result;

		expect(result).toMatchObject({ status: "completed", modelCalls: 2, toolCalls: 1 });
		expect(executions).toEqual(["hello"]);
		expect(authorizations).toEqual(["call-1"]);
		expect(contexts[1]?.at(-1)).toMatchObject({ role: "toolResult", toolCallId: "call-1", isError: false });
	});

	it.each([
		["unknown tool", undefined, toolCall("unknown-1", "missing", {}), "AGENT_TOOL_NOT_FOUND"],
		[
			"invalid input",
			typedTool(() => undefined),
			toolCall("invalid-1", "typed", { value: 1 }),
			"AGENT_TOOL_INPUT_INVALID",
		],
	] as const)("returns a model-visible error for %s without executing", async (_name, tool, call, code) => {
		let executions = 0;
		const resolvedTool = tool
			? typedTool(() => {
					executions += 1;
				})
			: undefined;
		const contexts: Message[][] = [];
		const run = runAgentTurn({
			...request([]),
			resolveTools: async () => (resolvedTool ? [resolvedTool] : []),
			resolveModelCall: scriptedResolver(
				[
					successResponse(assistant([call], "toolUse")),
					successResponse(assistant([{ type: "text", text: "done" }])),
				],
				(context) => contexts.push([...context.messages]),
			),
		});

		const result = await run.result;

		expect(result.status).toBe("completed");
		expect(executions).toBe(0);
		expect(contexts[1]?.at(-1)).toMatchObject({ role: "toolResult", isError: true, details: { code } });
	});

	it("converts tool execution failures into tool results", async () => {
		const failingTool = typedTool(() => {
			throw new Error("tool failed");
		});
		const contexts: Message[][] = [];
		const run = runAgentTurn({
			...request([]),
			resolveTools: async () => [failingTool],
			resolveModelCall: scriptedResolver(
				[
					successResponse(assistant([toolCall("failure-1", "typed", { value: "x" })], "toolUse")),
					successResponse(assistant([{ type: "text", text: "recovered" }])),
				],
				(context) => contexts.push([...context.messages]),
			),
		});

		await expect(run.result).resolves.toMatchObject({ status: "completed", toolCalls: 1 });
		expect(contexts[1]?.at(-1)).toMatchObject({
			role: "toolResult",
			isError: true,
			content: [{ type: "text", text: "tool failed" }],
		});
	});

	it("lets a host validate and decode a non-TypeBox schema dialect", async () => {
		const schema = Type.Object({ value: Type.Number() });
		const executions: number[] = [];
		const tool: RuntimeToolDefinition<typeof schema> = {
			name: "decode",
			description: "Decode input",
			inputSchema: schema,
			validateInput(input) {
				if (typeof input.value !== "string") throw new Error("value must be a numeric string");
				return { value: Number(input.value) };
			},
			async execute(input) {
				executions.push(input.value);
				return { content: [{ type: "text", text: String(input.value) }], details: {} };
			},
		};
		const run = runAgentTurn({
			...request([
				successResponse(assistant([toolCall("decode-1", "decode", { value: "7" })], "toolUse")),
				successResponse(assistant([])),
			]),
			resolveTools: async () => [tool],
		});

		await expect(run.result).resolves.toMatchObject({ status: "completed" });
		expect(executions).toEqual([7]);
	});

	it("retries a failed model call only through the checkpoint callback", async () => {
		const checkpointReasons: string[] = [];
		const run = runAgentTurn({
			...request([failedResponse(new AIError("AI_TRANSPORT_FAILED", "network")), successResponse(assistant([]))]),
			checkpoint: async ({ reason }) => {
				checkpointReasons.push(reason);
				return reason === "assistant_error" ? { retry: true } : undefined;
			},
		});

		await expect(run.result).resolves.toMatchObject({
			status: "completed",
			modelCalls: 2,
			recoveryAttempts: 1,
		});
		expect(checkpointReasons).toEqual(["model_call", "assistant_error", "model_call", "assistant_result"]);
	});

	it("ends with recovery_exhausted after the configured retry budget", async () => {
		const run = runAgentTurn({
			...request([
				failedResponse(new Error("first")),
				failedResponse(new Error("second")),
				failedResponse(new Error("unreachable")),
			]),
			limits: { ...DEFAULT_LIMITS, maxRecoveryAttempts: 1 },
			checkpoint: async ({ reason }) => (reason === "assistant_error" ? { retry: true } : undefined),
		});

		await expect(run.result).resolves.toMatchObject({
			status: "recovery_exhausted",
			modelCalls: 2,
			recoveryAttempts: 1,
			failure: { message: "second" },
		});
	});

	it("ends a checkpoint callback that never settles", async () => {
		const run = runAgentTurn({
			...request([successResponse(assistant([]))]),
			limits: { ...DEFAULT_LIMITS, checkpointTimeoutMs: 5 },
			checkpoint: () => new Promise(() => undefined),
		});

		await expect(within(run.result)).resolves.toMatchObject({
			status: "failed",
			failure: { message: "Agent checkpoint exceeded 5ms" },
		});
		await expect(within(collect(run.events))).resolves.toBeDefined();
	});

	it("stops an infinite tool loop at the model-call budget", async () => {
		let callIndex = 0;
		let executions = 0;
		const run = runAgentTurn({
			...request([]),
			limits: { ...DEFAULT_LIMITS, maxModelCalls: 2 },
			resolveTools: async () => [
				typedTool(() => {
					executions += 1;
				}),
			],
			resolveModelCall: async () => {
				callIndex += 1;
				return resolveResponse(
					successResponse(assistant([toolCall(`loop-${callIndex}`, "typed", { value: "x" })], "toolUse")),
					callIndex,
				);
			},
		});

		await expect(run.result).resolves.toMatchObject({ status: "max_model_calls", modelCalls: 2, toolCalls: 2 });
		expect(executions).toBe(2);
	});

	it("rejects a tool batch before executing beyond the tool-call budget", async () => {
		let executions = 0;
		const run = runAgentTurn({
			...request([
				successResponse(
					assistant(
						[toolCall("one", "typed", { value: "1" }), toolCall("two", "typed", { value: "2" })],
						"toolUse",
					),
				),
			]),
			limits: { ...DEFAULT_LIMITS, maxToolCalls: 1 },
			resolveTools: async () => [
				typedTool(() => {
					executions += 1;
				}),
			],
		});

		await expect(run.result).resolves.toMatchObject({ status: "max_tool_calls", modelCalls: 1, toolCalls: 0 });
		expect(executions).toBe(0);
	});

	it("aborts while a tool is running and settles both outputs", async () => {
		const controller = new AbortController();
		const blockingTool = typedTool(async () => await new Promise<void>(() => undefined));
		const run = runAgentTurn({
			...request([successResponse(assistant([toolCall("blocked", "typed", { value: "x" })], "toolUse"))]),
			signal: controller.signal,
			resolveTools: async () => [blockingTool],
			observer: (event) => {
				if (event.type === "tool_execution_start") controller.abort("cancelled by test");
			},
		});

		await expect(within(run.result)).resolves.toMatchObject({ status: "aborted" });
		await expect(within(collect(run.events))).resolves.toBeDefined();
	});

	it("preserves the request signal identity when no deadline is configured", async () => {
		const controller = new AbortController();
		let observedSignal: AbortSignal | undefined;
		const run = runAgentTurn({
			...request([]),
			signal: controller.signal,
			resolveModelCall: scriptedResolver([successResponse(assistant([]))], ({ signal }) => {
				observedSignal = signal;
			}),
		});

		await expect(run.result).resolves.toMatchObject({ status: "completed" });
		expect(observedSignal).toBe(controller.signal);
	});

	it("uses a linked signal for deadlines and propagates parent cancellation", async () => {
		const controller = new AbortController();
		let observedSignal: AbortSignal | undefined;
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const run = runAgentTurn({
			...request([]),
			signal: controller.signal,
			limits: { ...DEFAULT_LIMITS, deadlineMs: 10_000 },
			resolveModelCall: async ({ signal }) => {
				observedSignal = signal;
				markStarted?.();
				return await new Promise<ResolvedModelCall>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("resolver aborted")), { once: true });
				});
			},
		});
		await started;

		expect(observedSignal).not.toBe(controller.signal);
		controller.abort("cancelled by test");

		await expect(run.result).resolves.toMatchObject({ status: "aborted" });
		expect(observedSignal?.aborted).toBe(true);
	});

	it("uses one immutable tool snapshot per model call", async () => {
		const first = typedTool(() => undefined, "first");
		const second = typedTool(() => undefined, "second");
		const observedTools: string[][] = [];
		let resolution = 0;
		const run = runAgentTurn({
			...request([]),
			resolveTools: async () => (resolution++ === 0 ? [first] : [second]),
			resolveModelCall: async (context) => {
				observedTools.push(context.tools.map((tool) => tool.name));
				return resolveResponse(
					context.modelCallIndex === 0
						? successResponse(assistant([toolCall("first-call", "first", { value: "x" })], "toolUse"))
						: successResponse(assistant([{ type: "text", text: "done" }])),
					context.modelCallIndex,
				);
			},
		});

		await expect(run.result).resolves.toMatchObject({ status: "completed" });
		expect(observedTools).toEqual([["first"], ["second"]]);
	});

	it("delivers steering before the next model call and skips remaining tool calls", async () => {
		const executions: string[] = [];
		const steering = { role: "user", content: "change direction", timestamp: 2 } as const;
		const steeringBatches: Message[][] = [[], [steering], []];
		const contexts: Message[][] = [];
		const run = runAgentTurn({
			...request([]),
			resolveTools: async () => [
				typedTool((value) => {
					executions.push(value);
				}),
			],
			resolveModelCall: scriptedResolver(
				[
					successResponse(
						assistant(
							[toolCall("first", "typed", { value: "one" }), toolCall("second", "typed", { value: "two" })],
							"toolUse",
						),
					),
					successResponse(assistant([{ type: "text", text: "redirected" }])),
				],
				(context) => contexts.push([...context.messages]),
			),
			takeSteeringMessages: async () => steeringBatches.shift() ?? [],
		});
		const events = await collect(run.events);
		const result = await run.result;

		expect(result).toMatchObject({ status: "completed", modelCalls: 2, toolCalls: 2 });
		expect(executions).toEqual(["one"]);
		expect(contexts[1]?.slice(-3)).toMatchObject([
			{ role: "toolResult", toolCallId: "first", isError: false },
			{
				role: "toolResult",
				toolCallId: "second",
				isError: true,
				content: [{ type: "text", text: "Skipped due to queued user message." }],
			},
			steering,
		]);
		expect(events).toContainEqual({ type: "input_message", kind: "steering", message: steering });
	});

	it("takes continuation input only after a natural stop", async () => {
		const continuation = { role: "user", content: "continue", timestamp: 2 } as const;
		const continuationBatches: Message[][] = [[continuation], []];
		const contexts: Message[][] = [];
		const run = runAgentTurn({
			...request([]),
			resolveModelCall: scriptedResolver(
				[
					successResponse(assistant([{ type: "text", text: "first" }])),
					successResponse(assistant([{ type: "text", text: "second" }])),
				],
				(context) => contexts.push([...context.messages]),
			),
			takeContinuationMessages: async () => continuationBatches.shift() ?? [],
		});
		const events = await collect(run.events);

		await expect(run.result).resolves.toMatchObject({ status: "completed", modelCalls: 2 });
		expect(contexts[1]?.slice(-2)).toEqual([assistant([{ type: "text", text: "first" }]), continuation]);
		expect(events).toContainEqual({ type: "input_message", kind: "continuation", message: continuation });
	});

	it("does not consume continuation input after a model failure", async () => {
		let continuationCalls = 0;
		const run = runAgentTurn({
			...request([failedResponse(new Error("failed"))]),
			takeContinuationMessages: async () => {
				continuationCalls += 1;
				return [{ role: "user", content: "retry later", timestamp: 2 }];
			},
		});

		await expect(run.result).resolves.toMatchObject({ status: "failed" });
		expect(continuationCalls).toBe(0);
	});

	it("emits tool updates, phases, and timing from the execution context", async () => {
		const schema = Type.Object({ value: Type.String() });
		const tool: RuntimeToolDefinition<typeof schema, { stage: string }> = {
			name: "progress",
			description: "Reports progress",
			inputSchema: schema,
			async execute(input, context) {
				context.reportPhase("reading");
				context.onUpdate({ content: [{ type: "text", text: "partial" }], details: { stage: "reading" } });
				return { content: [{ type: "text", text: input.value }], details: { stage: "done" } };
			},
		};
		const run = runAgentTurn({
			...request([
				successResponse(assistant([toolCall("progress-1", "progress", { value: "done" })], "toolUse")),
				successResponse(assistant([])),
			]),
			resolveTools: async () => [tool],
		});
		const events = await collect(run.events);

		await expect(run.result).resolves.toMatchObject({ status: "completed" });
		expect(events).toContainEqual({
			type: "tool_execution_update",
			call: toolCall("progress-1", "progress", { value: "done" }),
			update: { content: [{ type: "text", text: "partial" }], details: { stage: "reading" } },
		});
		expect(events).toContainEqual({
			type: "tool_execution_phase",
			call: toolCall("progress-1", "progress", { value: "done" }),
			phase: { label: "reading", atMs: expect.any(Number) },
		});
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "tool_execution_finish",
				call: toolCall("progress-1", "progress", { value: "done" }),
				durationMs: expect.any(Number),
				phases: [{ label: "reading", atMs: expect.any(Number) }],
			}),
		);
	});

	it("emits assistant_result checkpoints only for natural stops", async () => {
		const reasons: string[] = [];
		const run = runAgentTurn({
			...request([
				successResponse(assistant([toolCall("call-1", "typed", { value: "x" })], "toolUse")),
				successResponse(assistant([])),
			]),
			resolveTools: async () => [typedTool(() => undefined)],
			checkpoint: async ({ reason }) => {
				reasons.push(reason);
				return undefined;
			},
		});

		await expect(run.result).resolves.toMatchObject({ status: "completed" });
		expect(reasons).toEqual(["model_call", "model_call", "assistant_result"]);
	});

	it("separates the current model-call view from subsequent run context", async () => {
		const providerView = { role: "user", content: "provider view", timestamp: 2 } as const;
		const durableView = { role: "user", content: "durable view", timestamp: 3 } as const;
		const modelContexts: Message[][] = [];
		const run = runAgentTurn({
			...request([]),
			resolveModelCall: scriptedResolver([successResponse(assistant([{ type: "text", text: "done" }]))], (context) =>
				modelContexts.push([...context.messages]),
			),
			checkpoint: async ({ reason }) =>
				reason === "model_call" ? { messages: [providerView], contextMessages: [durableView] } : undefined,
		});
		const result = await run.result;

		expect(modelContexts).toEqual([[providerView]]);
		expect(result.messages).toEqual([durableView, assistant([{ type: "text", text: "done" }])]);
	});

	it("isolates observer failures and emits diagnostics", async () => {
		const run = runAgentTurn({
			...request([successResponse(assistant([]))]),
			observer: (event) => {
				if (event.type === "model_event") throw new Error("observer failed");
			},
		});
		const events = await collect(run.events);

		await expect(run.result).resolves.toMatchObject({ status: "completed" });
		expect(events).toContainEqual({ type: "diagnostic", source: "observer", message: "observer failed" });
	});
});

function request(responses: readonly ModelStreamResponse[]): AgentTurnRequest {
	return {
		messages: [{ role: "user", content: "start", timestamp: 1 }],
		resolveModelCall: scriptedResolver(responses),
		resolveTools: async () => [],
		toolPolicy: { authorize: async () => undefined },
		limits: DEFAULT_LIMITS,
		signal: new AbortController().signal,
	};
}

function scriptedResolver(
	responses: readonly ModelStreamResponse[],
	onCall?: (context: Parameters<AgentTurnRequest["resolveModelCall"]>[0]) => void,
): AgentTurnRequest["resolveModelCall"] {
	let index = 0;
	return async (context) => {
		onCall?.(context);
		const response = responses[index];
		if (!response) throw new Error(`No response at index ${index}`);
		index += 1;
		return resolveResponse(response, index);
	};
}

function resolveResponse(response: ModelStreamResponse, index: number): ResolvedModelCall {
	return { callId: `call-${index}`, snapshotId: `snapshot-${index}`, response };
}

function successResponse(message: AssistantMessage): ModelStreamResponse {
	const stream = new LanguageModelStream();
	stream.push({ type: "start", partial: message });
	stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
	return { events: stream, result: stream.result() };
}

function failedResponse(error: unknown): ModelStreamResponse {
	const stream = new LanguageModelStream();
	stream.fail(error);
	return { events: stream, result: stream.result() };
}

function assistant(content: AssistantMessage["content"], stopReason: "stop" | "toolUse" = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "test-api",
		provider: "test-provider",
		model: "test-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

function toolCall(id: string, name: string, argumentsValue: Record<string, unknown>): ToolCall {
	return { type: "toolCall", id, name, arguments: argumentsValue };
}

function typedTool(
	execute: (value: string) => void | Promise<void>,
	name = "typed",
): RuntimeToolDefinition<ReturnType<typeof typedSchema>> {
	const schema = typedSchema();
	return {
		name,
		description: "Typed tool",
		inputSchema: schema,
		async execute(input) {
			await execute(input.value);
			return { content: [{ type: "text", text: input.value }], details: {} };
		},
	};
}

function typedSchema() {
	return Type.Object({ value: Type.String() });
}

async function collect(events: AsyncIterable<AgentExecutionEvent>): Promise<AgentExecutionEvent[]> {
	const result: AgentExecutionEvent[] = [];
	for await (const event of events) result.push(event);
	return result;
}

async function within<T>(promise: Promise<T>, timeoutMs = 100): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error("Agent run did not settle")), timeoutMs);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
