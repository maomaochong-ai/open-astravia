import {
	type AssistantMessage,
	AssistantMessageEventStream,
	type Message,
	type Model,
	type UserMessage,
} from "@vetta/ai";
import { describe, expect, it } from "vitest";
import {
	AgentCoreTurnEngine,
	type RuntimeSnapshot,
	type RuntimeToolDefinition,
	SessionInputQueue,
	type TurnEngineEvent,
	type TurnEnginePort,
} from "../../src/kernel/index.js";
import { StatelessAgentCoreTurnEngine } from "../../src/kernel/stateless-agent-core-turn-engine.js";

describe("StatelessAgentCoreTurnEngine", () => {
	it("keeps the production facade aligned with the stateless text projection", async () => {
		const response = assistant([{ type: "text", text: "done" }]);
		const legacy = await run(new AgentCoreTurnEngine(options([response])), snapshot());
		const modern = await run(new StatelessAgentCoreTurnEngine(options([response])), snapshot());

		expect(canonicalEvents(modern)).toEqual(canonicalEvents(legacy));
	});

	it("keeps the production facade aligned with the stateless tool-loop projection", async () => {
		const responses = [
			assistant([{ type: "toolCall", id: "call-1", name: "echo", arguments: { value: "hello" } }], "toolUse"),
			assistant([{ type: "text", text: "finished" }]),
		];
		const tool: RuntimeToolDefinition = {
			name: "echo",
			label: "Echo",
			description: "Echo a value",
			inputSchema: {
				type: "object",
				properties: { value: { type: "string" } },
				required: ["value"],
			},
			async execute({ input, onUpdate, reportPhase }) {
				reportPhase?.("reading");
				onUpdate?.({ content: [{ type: "text", text: "partial" }], details: { stage: "reading" } });
				return { content: [{ type: "text", text: String(input.value) }], details: { stage: "done" } };
			},
		};
		const legacy = await run(new AgentCoreTurnEngine(options(responses)), snapshot([tool]));
		const modern = await run(new StatelessAgentCoreTurnEngine(options(responses)), snapshot([tool]));

		expect(canonicalEvents(modern)).toEqual(canonicalEvents(legacy));
	});

	it("keeps checkpoint provider messages separate from subsequent Runtime context", async () => {
		const contexts: Message[][] = [];
		const responses = [
			assistant([{ type: "toolCall", id: "call-1", name: "echo", arguments: { value: "hello" } }], "toolUse"),
			assistant([{ type: "text", text: "done" }]),
		];
		let responseIndex = 0;
		const engine = new StatelessAgentCoreTurnEngine({
			model: model(),
			streamFn: (_model, context) => {
				contexts.push([...context.messages]);
				const response = responses[responseIndex];
				if (!response) throw new Error(`Missing response at index ${responseIndex}`);
				responseIndex += 1;
				return recordedStream(response);
			},
		});
		const durable = user("durable");
		const events: TurnEngineEvent[] = [];
		let modelCheckpoints = 0;
		const tool: RuntimeToolDefinition = {
			name: "echo",
			label: "Echo",
			description: "Echo",
			inputSchema: { type: "object" },
			async execute() {
				return { content: [{ type: "text", text: "echoed" }] };
			},
		};

		for await (const event of engine.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			snapshot: snapshot([tool]),
			messages: [user("initial")],
			signal: new AbortController().signal,
			checkpoint: async ({ reason, messages }) => {
				if (reason !== "model_call") return { messages };
				modelCheckpoints += 1;
				return modelCheckpoints === 1 ? { messages: [user("provider")], contextMessages: [durable] } : { messages };
			},
		})) {
			events.push(event);
		}

		expect(contexts[0]).toEqual([user("provider")]);
		expect(contexts[1]?.map(({ role }) => role)).toEqual(["user", "assistant", "toolResult"]);
		expect(contexts[1]?.[0]).toEqual(durable);
		expect(
			events
				.filter(
					(event): event is Extract<TurnEngineEvent, { type: "execution_observation" }> =>
						event.type === "execution_observation",
				)
				.find(({ observation }) => observation.type === "agent.end"),
		).toMatchObject({
			observation: {
				type: "agent.end",
				messages: [
					{ kind: "message", message: { role: "assistant" } },
					{ kind: "message", message: { role: "toolResult" } },
					{ kind: "message", message: { role: "assistant" } },
				],
			},
		});
	});

	it("rejects provider failures without consuming queued follow-up input", async () => {
		const queue = new SessionInputQueue();
		queue.followUp({ message: user("retry later") });
		const engine = new StatelessAgentCoreTurnEngine({
			model: model(),
			streamFn: () => errorStream(assistant([{ type: "text", text: "failed" }], "error")),
		});

		await expect(run(engine, snapshot(), queue)).rejects.toMatchObject({
			name: "AI_TRANSPORT_FAILED",
			message: "Language model provider failed",
		});
		expect(queue.pendingCount).toBe(1);
	});

	it("propagates cancellation to the provider stream and rejects the turn", async () => {
		const controller = new AbortController();
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const engine = new StatelessAgentCoreTurnEngine({
			model: model(),
			streamFn: (_model, _context, streamOptions) => {
				const stream = new AssistantMessageEventStream();
				streamOptions?.signal?.addEventListener(
					"abort",
					() => stream.push({ type: "error", reason: "aborted", error: assistant([], "aborted") }),
					{ once: true },
				);
				markStarted?.();
				return stream;
			},
		});
		const execution = run(engine, snapshot(), undefined, controller.signal);
		await started;

		controller.abort("cancelled by test");

		await expect(execution).rejects.toMatchObject({ name: "AbortError" });
	});
});

function options(responses: readonly AssistantMessage[]) {
	let index = 0;
	return {
		model: model(),
		streamFn: () => {
			const response = responses[index];
			if (!response) throw new Error(`Missing response at index ${index}`);
			index += 1;
			return recordedStream(response);
		},
	};
}

function recordedStream(message: AssistantMessage): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	queueMicrotask(() => {
		stream.push({
			type: "done",
			reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
			message,
		});
	});
	return stream;
}

function errorStream(message: AssistantMessage): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	queueMicrotask(() => stream.push({ type: "error", reason: "error", error: message }));
	return stream;
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
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8_000,
		maxTokens: 1_000,
	};
}

function snapshot(tools: readonly RuntimeToolDefinition[] = []): RuntimeSnapshot {
	return {
		id: "snapshot-1",
		instructions: [{ id: "base", content: "Base instruction", priority: 0 }],
		tools: new Map(tools.map((tool) => [tool.name, tool])),
		contextProviders: [],
		contextStrategy: {
			async prepare(input) {
				return { messages: input.messages, estimatedTokens: 0 };
			},
		},
		toolPolicy: { authorize: async () => true },
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
		observers: [],
	};
}

function user(content: string): UserMessage {
	return { role: "user", content, timestamp: 1 };
}

function assistant(
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
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 2,
	};
}

async function run(
	engine: TurnEnginePort,
	runtimeSnapshot: RuntimeSnapshot,
	inputQueue?: SessionInputQueue,
	signal: AbortSignal = new AbortController().signal,
): Promise<TurnEngineEvent[]> {
	const events: TurnEngineEvent[] = [];
	for await (const event of engine.execute({
		sessionId: "session-1",
		turnId: "turn-1",
		snapshot: runtimeSnapshot,
		messages: [user("hello")],
		signal,
		inputQueue,
	})) {
		events.push(event);
	}
	return events;
}

function canonicalEvents(events: readonly TurnEngineEvent[]): unknown[] {
	return events.map((event) => {
		if (event.type === "message") {
			return { type: event.type, role: event.message.role, content: event.message.content, origin: event.origin };
		}
		if (event.type === "completed") return event;
		if (event.type === "observation") {
			return {
				type: event.type,
				observation: canonicalObservation(event.observation),
			};
		}
		return {
			type: event.type,
			observation: canonicalObservation(event.observation),
		};
	});
}

function canonicalObservation(
	observation: Exclude<TurnEngineEvent, { type: "message" } | { type: "completed" }>["observation"],
): unknown {
	if (observation.type === "tool.execution.start" || observation.type === "tool.start") {
		return { type: observation.type, toolCallId: observation.toolCallId, toolName: observation.toolName };
	}
	if (observation.type === "tool.execution.update" || observation.type === "tool.update") {
		return { type: observation.type, toolCallId: observation.toolCallId, toolName: observation.toolName };
	}
	if (observation.type === "tool.execution.phase" || observation.type === "tool.phase") {
		return { type: observation.type, toolCallId: observation.toolCallId, label: observation.label };
	}
	if (observation.type === "tool.execution.end" || observation.type === "tool.end") {
		return { type: observation.type, toolCallId: observation.toolCallId, isError: observation.isError };
	}
	if (observation.type === "message.start" || observation.type === "message.end") {
		return { type: observation.type, kind: observation.message.kind };
	}
	if (observation.type === "message.update") return { type: observation.type };
	if (observation.type === "turn.end") {
		return {
			type: observation.type,
			stopReason: observation.message.role === "assistant" ? observation.message.stopReason : undefined,
			tools: observation.toolResults.length,
		};
	}
	if (observation.type === "agent.end") return { type: observation.type, messages: observation.messages.length };
	if (observation.type === "lifecycle") return { type: observation.type, phase: observation.phase };
	return { type: observation.type };
}
