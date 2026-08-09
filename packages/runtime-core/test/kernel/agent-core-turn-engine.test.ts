import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	EventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@vetta/ai";
import { describe, expect, it } from "vitest";
import type { ContextCompositionReport } from "../../src/context-composition/index.js";
import {
	AgentCoreTurnEngine,
	type ContextCompositionPublisher,
	type ContinuationPolicy,
	type ModelCallContextTransformer,
	type ModelCallFrameComposer,
	type ModelCallMessageFinalizer,
	type RuntimeSnapshot,
	type RuntimeToolDefinition,
	RuntimeToolExecutionError,
	SessionInputQueue,
	type ToolPolicyRequest,
	type TurnEngineEvent,
	type TurnInputQueue,
} from "../../src/kernel/index.js";

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
			this.push({
				type: "done",
				reason: message.stopReason,
				message,
			});
		});
	}
}

class ManualAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected assistant event");
			},
		);
	}
}

function model(): Model<"openai-responses"> {
	return {
		id: "recorded-model",
		name: "Recorded Model",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 8_000,
		maxTokens: 1_000,
	};
}

function userMessage(text: string): UserMessage {
	return {
		role: "user",
		content: text,
		timestamp: 1,
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
		model: "recorded-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason,
		timestamp: 2,
	};
}

function snapshot(options?: {
	readonly tools?: readonly RuntimeToolDefinition[];
	readonly salvageTextToolCalls?: readonly string[];
	readonly authorize?: (request: ToolPolicyRequest, signal: AbortSignal) => Promise<boolean>;
	readonly modelCallFrameComposer?: ModelCallFrameComposer;
	readonly continuationPolicy?: ContinuationPolicy;
	readonly modelCallContextTransformer?: ModelCallContextTransformer;
	readonly modelCallMessageFinalizer?: ModelCallMessageFinalizer;
	readonly contextCompositionPublisher?: ContextCompositionPublisher;
}): RuntimeSnapshot {
	return {
		id: "snapshot-1",
		salvageTextToolCalls: options?.salvageTextToolCalls,
		instructions: [
			{ id: "base", content: "Base instruction", priority: 0 },
			{ id: "feature", content: "Feature instruction", priority: 1 },
		],
		tools: new Map((options?.tools ?? []).map((tool) => [tool.name, tool])),
		modelCallFrameComposer: options?.modelCallFrameComposer,
		continuationPolicy: options?.continuationPolicy,
		modelCallContextTransformer: options?.modelCallContextTransformer,
		modelCallMessageFinalizer: options?.modelCallMessageFinalizer,
		contextCompositionPublisher: options?.contextCompositionPublisher,
		contextProviders: [],
		contextStrategy: {
			async prepare(input) {
				return {
					messages: input.messages,
					estimatedTokens: 0,
				};
			},
		},
		toolPolicy: {
			authorize:
				options?.authorize ??
				(async (_request, signal) => {
					signal.throwIfAborted();
					return true;
				}),
		},
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
		observers: [],
	};
}

async function collect(
	engine: AgentCoreTurnEngine,
	runtimeSnapshot: RuntimeSnapshot,
	signal: AbortSignal = new AbortController().signal,
	inputQueue?: TurnInputQueue,
): Promise<TurnEngineEvent[]> {
	const events: TurnEngineEvent[] = [];
	for await (const event of engine.execute({
		sessionId: "session-1",
		turnId: "turn-1",
		snapshot: runtimeSnapshot,
		messages: [userMessage("hello")],
		signal,
		inputQueue,
	})) {
		events.push(event);
	}
	return events;
}

describe("AgentCoreTurnEngine", () => {
	it("publishes prepared and completed reports for the exact model call", async () => {
		const reports: ContextCompositionReport[] = [];
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }])),
		});
		const runtimeSnapshot = snapshot({
			contextCompositionPublisher: {
				publishContextComposition(report) {
					reports.push(report);
				},
			},
			modelCallFrameComposer: {
				async compose(context) {
					return {
						...context.frame,
						contextCompositionSections: [
							{
								id: "instruction:base",
								kind: "instruction",
								source: { owner: "core", id: "base" },
								content: "Base instruction\n\nFeature instruction",
							},
						],
					};
				},
			},
		});

		await collect(engine, runtimeSnapshot);

		expect(reports.map(({ phase }) => phase)).toEqual(["prepared", "completed"]);
		expect(reports[1]).toMatchObject({
			callId: "turn-1:model-call:1",
			providerReportedInputTokens: 1,
			sections: [
				{ id: "instruction:base", source: { owner: "core", id: "base" } },
				{ id: "message:0", kind: "history" },
			],
		});
		expect(JSON.stringify(reports)).not.toContain("Base instruction");
		expect(JSON.stringify(reports)).not.toContain("hello");
	});

	it("passes the product salvage whitelist to Agent Core", async () => {
		const progressCalls: unknown[] = [];
		const progress: RuntimeToolDefinition = {
			name: "progress",
			label: "Progress",
			description: "Update progress",
			inputSchema: {
				type: "object",
				properties: { label: { type: "string" } },
			},
			async execute(request) {
				progressCalls.push(request.input);
				return { content: [{ type: "text", text: "updated" }] };
			},
		};
		const responses = [
			assistantMessage([{ type: "text", text: '{"label":"working"}' }]),
			assistantMessage([{ type: "text", text: "done" }]),
		];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => {
				const response = responses[responseIndex++];
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});

		await collect(engine, snapshot({ tools: [progress], salvageTextToolCalls: ["progress"] }));

		expect(progressCalls).toEqual([{ label: "working" }]);
	});

	it("maps immutable runtime input to agent-core and emits canonical terminal events", async () => {
		const contexts: Context[] = [];
		const sessionIds: Array<string | undefined> = [];
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamOptions: {
				temperature: 0.2,
			},
			streamFn: (_model, context, options) => {
				contexts.push(context);
				sessionIds.push(options?.sessionId);
				expect(options?.temperature).toBe(0.2);
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});

		const events = await collect(engine, snapshot());

		expect(contexts).toHaveLength(1);
		expect(contexts[0].systemPrompt).toBe("Base instruction\n\nFeature instruction");
		expect(contexts[0].messages).toEqual([userMessage("hello")]);
		expect(sessionIds).toEqual(["session-1"]);
		expect(
			events
				.filter((event): event is Extract<TurnEngineEvent, { type: "observation" }> => event.type === "observation")
				.map((event) =>
					event.observation.type === "lifecycle" ? event.observation.phase : event.observation.type,
				),
		).toEqual(["agent_start", "turn_start", "turn_end", "agent_end"]);
		expect(
			events
				.filter(
					(event): event is Extract<TurnEngineEvent, { type: "execution_observation" }> =>
						event.type === "execution_observation",
				)
				.map(({ observation }) => observation.type),
		).toEqual(["agent.start", "turn.start", "message.start", "message.end", "turn.end", "agent.end"]);
		expect(events.filter((event) => event.type !== "observation" && event.type !== "execution_observation")).toEqual([
			{
				type: "message",
				message: assistantMessage([{ type: "text", text: "done" }]),
			},
			{
				type: "completed",
				stopReason: "stop",
			},
		]);
	});

	it("runs the agent-core tool loop through runtime policy and execution contracts", async () => {
		const policyRequests: ToolPolicyRequest[] = [];
		const executionInputs: Readonly<Record<string, unknown>>[] = [];
		const phases: string[] = [];
		const tool: RuntimeToolDefinition = {
			name: "echo",
			label: "Echo",
			description: "Echo a value",
			inputSchema: {
				type: "object",
				properties: {
					value: { type: "string" },
				},
				required: ["value"],
				additionalProperties: false,
			},
			async execute(request) {
				executionInputs.push(request.input);
				request.onUpdate?.({
					content: [{ type: "text", text: "working" }],
				});
				request.reportPhase?.("executing");
				phases.push("executed");
				return {
					content: [{ type: "text", text: `echo:${String(request.input.value)}` }],
					details: { echoed: request.input.value },
				};
			},
		};
		const responses = [
			assistantMessage(
				[
					{
						type: "toolCall",
						id: "tool-call-1",
						name: "echo",
						arguments: { value: "hello" },
					},
				],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "finished" }]),
		];
		const contexts: Context[] = [];
		const composerMessages: string[][] = [];
		const composerModels: string[] = [];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: (_model, context) => {
				contexts.push({
					...context,
					messages: [...context.messages],
				});
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});

		const events = await collect(
			engine,
			snapshot({
				tools: [tool],
				modelCallFrameComposer: {
					async compose(context) {
						composerMessages.push(context.messages.map(({ role }) => role));
						if (context.modelBinding) composerModels.push(context.modelBinding.model.id);
						return context.frame;
					},
				},
				async authorize(request, signal) {
					signal.throwIfAborted();
					policyRequests.push(request);
					return true;
				},
			}),
		);

		expect(policyRequests).toEqual([
			{
				sessionId: "session-1",
				turnId: "turn-1",
				toolName: "echo",
				input: { value: "hello" },
			},
		]);
		expect(executionInputs).toEqual([{ value: "hello" }]);
		expect(phases).toEqual(["executed"]);
		expect(contexts).toHaveLength(2);
		expect(composerMessages).toEqual([["user"], ["user", "assistant", "toolResult"]]);
		expect(composerModels).toEqual(["recorded-model", "recorded-model"]);
		expect(contexts[1].messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult"]);
		expect(
			events
				.filter((event) => event.type !== "observation" && event.type !== "execution_observation")
				.map((event) => (event.type === "message" ? event.message.role : event.type)),
		).toEqual(["assistant", "toolResult", "assistant", "completed"]);
		expect(
			events
				.filter(
					(event): event is Extract<TurnEngineEvent, { type: "execution_observation" }> =>
						event.type === "execution_observation",
				)
				.map(({ observation }) => observation.type),
		).toEqual([
			"agent.start",
			"turn.start",
			"message.start",
			"message.end",
			"tool.execution.start",
			"tool.execution.update",
			"tool.execution.phase",
			"tool.execution.end",
			"message.start",
			"message.end",
			"turn.end",
			"turn.start",
			"message.start",
			"message.end",
			"turn.end",
			"agent.end",
		]);
		expect(
			events
				.filter((event): event is Extract<TurnEngineEvent, { type: "observation" }> => event.type === "observation")
				.map((event) => event.observation.type),
		).toEqual([
			"lifecycle",
			"lifecycle",
			"tool.start",
			"tool.update",
			"tool.phase",
			"tool.end",
			"lifecycle",
			"lifecycle",
			"lifecycle",
			"lifecycle",
		]);
		expect(events.at(-1)).toEqual({
			type: "completed",
			stopReason: "stop",
		});
	});

	it("preserves explicit-run message identity and order in execution observations", async () => {
		const response = assistantMessage([{ type: "text", text: "done" }]);
		const input = userMessage("hello");
		const initialMessages = [
			{
				kind: "context" as const,
				record: {
					type: "prompt_attachment_context",
					content: "attachment",
					modelVisible: true,
					display: true,
					metadata: { path: "README.md" },
				},
				timestamp: 10,
			},
			{ kind: "message" as const, message: input },
		];
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => new RecordedAssistantStream(response),
		});
		const executionEvents: Extract<TurnEngineEvent, { type: "execution_observation" }>["observation"][] = [];

		for await (const event of engine.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			snapshot: snapshot(),
			messages: [input],
			initialMessages,
			signal: new AbortController().signal,
		})) {
			if (event.type === "execution_observation") executionEvents.push(event.observation);
		}

		expect(executionEvents.map(({ type }) => type)).toEqual([
			"agent.start",
			"turn.start",
			"message.start",
			"message.end",
			"message.start",
			"message.end",
			"message.start",
			"message.end",
			"turn.end",
			"agent.end",
		]);
		expect(executionEvents.slice(2, 6)).toEqual([
			{ type: "message.start", message: initialMessages[0] },
			{ type: "message.end", message: initialMessages[0] },
			{ type: "message.start", message: initialMessages[1] },
			{ type: "message.end", message: initialMessages[1] },
		]);
		expect(executionEvents.at(-1)).toEqual({
			type: "agent.end",
			messages: [...initialMessages, { kind: "message", message: response }],
		});
	});

	it("reuses the prepared first Frame while keeping the Run Prompt fixed across a tool loop", async () => {
		const contexts: Context[] = [];
		const composerMessages: string[][] = [];
		const responses = [
			assistantMessage(
				[{ type: "toolCall", id: "tool-call-1", name: "echo", arguments: { value: "hello" } }],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "finished" }]),
		];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: (_model, context) => {
				contexts.push({ ...context, messages: [...context.messages] });
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		const tool: RuntimeToolDefinition = {
			name: "echo",
			label: "Echo",
			description: "Echo",
			inputSchema: { type: "object" },
			async execute() {
				return { content: [{ type: "text", text: "echoed" }] };
			},
		};
		const runtimeSnapshot = snapshot({
			tools: [tool],
			modelCallFrameComposer: {
				async compose(context) {
					composerMessages.push(context.messages.map(({ role }) => role));
					return context.frame;
				},
			},
		});

		for await (const _event of engine.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			snapshot: runtimeSnapshot,
			messages: [userMessage("hello")],
			initialModelCallFrame: {
				instructions: [{ id: "prepared", content: "prepared prompt", priority: 0 }],
				tools: new Map([["echo", tool]]),
			},
			instructionOverride: [{ id: "override", content: "run prompt", priority: 0 }],
			signal: new AbortController().signal,
		})) {
			// Exhaust the engine stream.
		}

		expect(contexts.map(({ systemPrompt }) => systemPrompt)).toEqual(["run prompt", "run prompt"]);
		expect(composerMessages).toEqual([["user", "assistant", "toolResult"]]);
	});

	it("applies the session context transformer before every model call without mutating persisted messages", async () => {
		const transformedRoles: string[][] = [];
		const contexts: Context[] = [];
		const responses = [
			assistantMessage(
				[{ type: "toolCall", id: "tool-call-1", name: "echo", arguments: { value: "hello" } }],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "finished" }]),
		];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: (_model, context) => {
				contexts.push({ ...context, messages: [...context.messages] });
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		const runtimeSnapshot = snapshot({
			tools: [
				{
					name: "echo",
					label: "Echo",
					description: "Echo",
					inputSchema: { type: "object" },
					async execute() {
						return { content: [{ type: "text", text: "echoed" }] };
					},
				},
			],
			modelCallContextTransformer: {
				async transform(input) {
					transformedRoles.push(input.messages.map(({ role }) => role));
					return [
						{ role: "user", content: `transformed-${transformedRoles.length}`, timestamp: 0 },
						...input.messages.slice(1),
					];
				},
			},
		});

		const events = await collect(engine, runtimeSnapshot);

		expect(transformedRoles).toEqual([["user"], ["user", "assistant", "toolResult"]]);
		expect(contexts.map(({ messages }) => messageText(messages[0] as Message))).toEqual([
			"transformed-1",
			"transformed-2",
		]);
		expect(
			events
				.filter((event): event is Extract<TurnEngineEvent, { type: "message" }> => event.type === "message")
				.map(({ message }) => message.role),
		).toEqual(["assistant", "toolResult", "assistant"]);
	});

	it("passes lossless identities to the transformer and finalizes only the model-visible call messages", async () => {
		const transformerEnvelopes: string[][] = [];
		const finalizedMessages: Message[][] = [];
		const contexts: Context[] = [];
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: (_model, context) => {
				contexts.push({ ...context, messages: [...context.messages] });
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});
		const runtimeSnapshot = snapshot({
			modelCallContextTransformer: {
				async transform(input) {
					transformerEnvelopes.push((input.messageEnvelopes ?? []).map(({ kind }) => kind));
					return input.messages;
				},
			},
			modelCallMessageFinalizer: {
				async finalize(input) {
					finalizedMessages.push([...input.messages]);
					return [userMessage("finalized")];
				},
			},
		});
		const visible = userMessage("visible");

		for await (const _event of engine.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			snapshot: runtimeSnapshot,
			messages: [visible],
			contextMessages: [
				{ kind: "opaque", identity: { type: "visible" }, modelMessage: visible, timestamp: 1 },
				{ kind: "opaque", identity: { type: "hidden" }, timestamp: 2 },
			],
			signal: new AbortController().signal,
			checkpoint: async (checkpointRequest) => ({ messages: checkpointRequest.messages }),
		})) {
			// Exhaust the engine stream.
		}

		expect(transformerEnvelopes).toEqual([["opaque", "opaque"]]);
		expect(finalizedMessages).toEqual([[visible]]);
		expect(contexts[0].messages).toEqual([userMessage("finalized")]);
	});

	it("bridges ordered model-call checkpoints without changing the default engine path", async () => {
		const responses = [
			assistantMessage(
				[{ type: "toolCall", id: "tool-call-1", name: "echo", arguments: { value: "hello" } }],
				"toolUse",
			),
			assistantMessage([{ type: "text", text: "finished" }]),
		];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => {
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});
		const runtimeSnapshot = snapshot({
			tools: [
				{
					name: "echo",
					label: "Echo",
					description: "Echo",
					inputSchema: { type: "object" },
					async execute() {
						return { content: [{ type: "text", text: "echoed" }] };
					},
				},
			],
		});
		const order: string[] = [];

		for await (const event of engine.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			snapshot: runtimeSnapshot,
			messages: [userMessage("hello")],
			signal: new AbortController().signal,
			checkpoint: async (checkpointRequest) => {
				order.push(`checkpoint:${checkpointRequest.messages.map(({ role }) => role).join(",")}`);
				return { messages: checkpointRequest.messages };
			},
		})) {
			if (event.type === "message") {
				order.push(event.message.role);
				continue;
			}
			if (event.type === "completed") order.push("completed");
		}

		expect(order).toEqual([
			"checkpoint:user",
			"assistant",
			"toolResult",
			"checkpoint:user,assistant,toolResult",
			"assistant",
			"checkpoint:user,assistant,toolResult,assistant",
			"completed",
		]);
	});

	it("turns policy rejection into a tool error without calling the implementation", async () => {
		let executionCount = 0;
		const tool: RuntimeToolDefinition = {
			name: "write",
			label: "Write",
			description: "Write a value",
			inputSchema: {
				type: "object",
			},
			async execute() {
				executionCount += 1;
				return { content: [] };
			},
		};
		const responses = [
			assistantMessage([{ type: "toolCall", id: "tool-call-1", name: "write", arguments: {} }], "toolUse"),
			assistantMessage([{ type: "text", text: "not written" }]),
		];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => {
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});

		const events = await collect(
			engine,
			snapshot({
				tools: [tool],
				async authorize() {
					return false;
				},
			}),
		);

		expect(executionCount).toBe(0);
		const messages = events
			.filter((event): event is Extract<TurnEngineEvent, { type: "message" }> => event.type === "message")
			.map(({ message }) => message);
		const toolResult = messages.find(
			(message): message is Extract<Message, { role: "toolResult" }> => message.role === "toolResult",
		);
		expect(toolResult).toMatchObject({
			isError: true,
			content: [{ type: "text", text: "Tool execution denied by policy: write" }],
		});
	});

	it("bridges structured runtime tool errors into agent tool results", async () => {
		const tool: RuntimeToolDefinition = {
			name: "dynamic",
			label: "Dynamic",
			description: "Dynamic tool",
			inputSchema: { type: "object" },
			async execute() {
				throw new RuntimeToolExecutionError("Dynamic tool was revoked", {
					code: "dynamic_tool_revoked",
					retryable: false,
					metadata: { toolName: "dynamic" },
				});
			},
		};
		const responses = [
			assistantMessage([{ type: "toolCall", id: "tool-call-1", name: "dynamic", arguments: {} }], "toolUse"),
			assistantMessage([{ type: "text", text: "recovered" }]),
		];
		let responseIndex = 0;
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => {
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});

		const events = await collect(engine, snapshot({ tools: [tool] }));
		const toolResult = events.find(
			(
				event,
			): event is Extract<TurnEngineEvent, { type: "message" }> & {
				readonly message: Extract<Message, { role: "toolResult" }>;
			} => event.type === "message" && event.message.role === "toolResult",
		)?.message;

		expect(toolResult).toMatchObject({
			isError: true,
			content: [{ type: "text", text: "Dynamic tool was revoked" }],
			details: {
				code: "dynamic_tool_revoked",
				retryable: false,
				metadata: { toolName: "dynamic" },
			},
		});
	});

	it("forwards the request cancellation signal and rejects the turn", async () => {
		const controller = new AbortController();
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: (_model, _context, options) => {
				expect(options?.signal).toBe(controller.signal);
				const stream = new ManualAssistantStream();
				options?.signal?.addEventListener(
					"abort",
					() => {
						stream.push({
							type: "error",
							reason: "aborted",
							error: assistantMessage([{ type: "text", text: "cancelled" }], "aborted"),
						});
					},
					{ once: true },
				);
				markStarted?.();
				return stream;
			},
		});

		const result = collect(engine, snapshot(), controller.signal);
		await started;
		controller.abort("cancelled by test");

		await expect(result).rejects.toMatchObject({ name: "AbortError" });
	});

	it("delivers steering before follow-up input and emits delivered user messages", async () => {
		const queue = new SessionInputQueue();
		const firstStream = new ManualAssistantStream();
		const responses = [
			assistantMessage([{ type: "text", text: "after steer" }]),
			assistantMessage([{ type: "text", text: "after follow-up" }]),
		];
		const contexts: Context[] = [];
		let callIndex = 0;
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: (_model, context) => {
				contexts.push({ ...context, messages: [...context.messages] });
				if (callIndex === 0) {
					callIndex += 1;
					markStarted?.();
					return firstStream;
				}
				const response = responses[callIndex - 1];
				callIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});

		const result = collect(engine, snapshot(), new AbortController().signal, queue);
		await started;
		queue.steer({ message: userMessage("steer") });
		queue.followUp({ message: userMessage("follow-up") });
		firstStream.push({
			type: "done",
			reason: "stop",
			message: assistantMessage([{ type: "text", text: "first" }]),
		});

		const events = await result;
		expect(contexts).toHaveLength(3);
		expect(contexts[1].messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
		expect(contexts[2].messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
			"user",
		]);
		expect(
			events
				.filter((event) => event.type !== "observation" && event.type !== "execution_observation")
				.map((event) => (event.type === "message" ? event.message.role : event.type)),
		).toEqual(["assistant", "user", "assistant", "user", "assistant", "completed"]);
		expect(queue.pendingCount).toBe(0);
	});

	it("keeps queued visible and hidden context identity without exposing hidden context to the model", async () => {
		const queue = new SessionInputQueue();
		queue.steer({
			context: [
				{ type: "visible-context", content: "visible", modelVisible: true, display: true, timestamp: 10 },
				{ type: "hidden-context", content: "hidden", modelVisible: false, display: false, timestamp: 11 },
			],
			message: userMessage("steer"),
		});
		const contexts: Context[] = [];
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: (_model, context) => {
				contexts.push({ ...context, messages: [...context.messages] });
				return new RecordedAssistantStream(assistantMessage([{ type: "text", text: "done" }]));
			},
		});

		const events = await collect(engine, snapshot(), new AbortController().signal, queue);
		const executionEvents = events
			.filter(
				(event): event is Extract<TurnEngineEvent, { type: "execution_observation" }> =>
					event.type === "execution_observation",
			)
			.map(({ observation }) => observation);

		expect(contexts[0].messages.map(messageText)).toEqual(["hello", "visible", "steer"]);
		expect(
			executionEvents
				.filter(({ type }) => type === "message.end")
				.map((event) => (event.type === "message.end" ? event.message : undefined)),
		).toMatchObject([
			{ kind: "context", record: { type: "visible-context", modelVisible: true } },
			{ kind: "context", record: { type: "hidden-context", modelVisible: false } },
			{ kind: "message", message: { role: "user", content: "steer" } },
			{ kind: "message", message: { role: "assistant" } },
		]);
		expect(executionEvents.at(-1)).toMatchObject({
			type: "agent.end",
			messages: [
				{ kind: "context", record: { type: "visible-context" } },
				{ kind: "context", record: { type: "hidden-context" } },
				{ kind: "message", message: { role: "user", content: "steer" } },
				{ kind: "message", message: { role: "assistant" } },
			],
		});
	});

	it("rejects an error terminal without consuming follow-up input", async () => {
		const queue = new SessionInputQueue();
		queue.followUp({ message: userMessage("retry later") });
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: () => new RecordedAssistantStream(assistantMessage([{ type: "text", text: "failed" }], "error")),
		});

		await expect(collect(engine, snapshot(), new AbortController().signal, queue)).rejects.toMatchObject({
			name: "AI_TRANSPORT_FAILED",
			message: "Language model provider failed",
		});

		expect(queue.pendingCount).toBe(1);
		expect(queue.followUpInputs.map(({ message }) => message.content)).toEqual(["retry later"]);
	});

	it("appends policy continuations behind user follow-ups and preserves one-at-a-time delivery", async () => {
		const queue = new SessionInputQueue();
		queue.followUp({ message: userMessage("user follow-up") });
		const policyContexts: Message[][] = [];
		let policyDelivered = false;
		const responses = [
			assistantMessage([{ type: "text", text: "first" }]),
			assistantMessage([{ type: "text", text: "after user" }]),
			assistantMessage([{ type: "text", text: "after policy" }]),
		];
		let responseIndex = 0;
		const contexts: Context[] = [];
		const engine = new AgentCoreTurnEngine({
			model: model(),
			streamFn: (_model, context) => {
				contexts.push({ ...context, messages: [...context.messages] });
				const response = responses[responseIndex];
				responseIndex += 1;
				if (!response) throw new Error("Missing recorded response");
				return new RecordedAssistantStream(response);
			},
		});

		await collect(
			engine,
			snapshot({
				continuationPolicy: {
					async collect(context) {
						policyContexts.push([...context.messages]);
						if (policyDelivered) return [];
						policyDelivered = true;
						return [userMessage("policy follow-up")];
					},
				},
			}),
			new AbortController().signal,
			queue,
		);

		expect(contexts.map(({ messages }) => messages.map((message) => messageText(message)))).toEqual([
			["hello"],
			["hello", "first", "user follow-up"],
			["hello", "first", "user follow-up", "after user", "policy follow-up"],
		]);
		expect(policyContexts[0]?.map(({ role }) => role)).toEqual(["user", "assistant"]);
		expect(queue.pendingCount).toBe(0);
	});
});

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((block): block is Extract<(typeof message.content)[number], { type: "text" }> => block.type === "text")
		.map(({ text }) => text)
		.join("");
}
