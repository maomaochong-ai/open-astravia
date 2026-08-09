import { type AssistantMessage, AssistantMessageEventStream, type Model, type UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import {
	AgentCoreTurnEngine,
	type AgentCoreTurnEngineOptions,
	type RuntimeSnapshot,
	type RuntimeToolDefinition,
} from "../../src/kernel/index.js";

type RuntimeTracer = NonNullable<AgentCoreTurnEngineOptions["tracer"]>;
type RuntimeObservation = ReturnType<RuntimeTracer["startObservation"]>;
type ObservationUpdate = Parameters<RuntimeObservation["end"]>[0];
type ObservationStart = Parameters<RuntimeTracer["startObservation"]>[1];
type ObservationOptions = Parameters<RuntimeTracer["startObservation"]>[2];

describe("StatelessAgentCoreTurnEngine telemetry", () => {
	it("closes agent, generation, and tool observations exactly once without capturing content by default", async () => {
		const tracer = new RecordingTracer();
		const responses = [
			assistant([{ type: "toolCall", id: "call-1", name: "echo", arguments: { value: "secret-input" } }], "toolUse"),
			assistant([{ type: "text", text: "finished" }]),
		];
		const tool: RuntimeToolDefinition = {
			name: "echo",
			label: "Echo",
			description: "Echo a value",
			inputSchema: { type: "object" },
			async execute() {
				return { content: [{ type: "text", text: "secret-output" }] };
			},
		};

		await execute(
			{
				model: model(),
				streamFn: sequenceStream(responses),
				tracer,
				tracing: { metadata: { tenant: "test", sessionId: "stale-session" } },
			},
			snapshot([tool]),
			"secret-user",
		);

		expect(tracer.observations.map(({ name, type }) => `${type}:${name}`).sort()).toEqual([
			"agent:agent.run",
			"generation:llm.openai.recorded-model",
			"generation:llm.openai.recorded-model",
			"tool:tool.echo",
		]);
		expect(tracer.observations.every(({ ends }) => ends.length === 1)).toBe(true);
		expect(tracer.flushCount).toBe(1);
		const tracePayload = serializeObservations(tracer.observations);
		expect(tracePayload).not.toContain("secret-user");
		expect(tracePayload).not.toContain("secret-input");
		expect(tracePayload).not.toContain("secret-output");
		expect(tracer.observations[0]?.ends[0]).toMatchObject({
			level: "DEFAULT",
			usageDetails: { input: 2, output: 2, totalTokens: 4 },
		});
		expect(tracer.observations[0]?.start?.metadata).toMatchObject({
			tenant: "test",
			sessionId: "session-1",
		});
	});

	it("ends agent and generation observations once when the provider fails", async () => {
		const tracer = new RecordingTracer();
		const engine = new AgentCoreTurnEngine({
			model: model(),
			tracer,
			streamFn: () => errorStream(assistant([{ type: "text", text: "failed" }], "error")),
		});

		await expect(executeEngine(engine, snapshot())).rejects.toMatchObject({ name: "AI_TRANSPORT_FAILED" });

		expect(tracer.observations.map(({ type }) => type)).toEqual(["agent", "generation"]);
		for (const observation of tracer.observations) {
			expect(observation.ends).toHaveLength(1);
			expect(observation.ends[0]).toMatchObject({ level: "ERROR" });
		}
		expect(tracer.flushCount).toBe(1);
	});

	it("closes observations once when cancellation races the provider result", async () => {
		const tracer = new RecordingTracer();
		const controller = new AbortController();
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		const engine = new AgentCoreTurnEngine({
			model: model(),
			tracer,
			streamFn: (_model, _context, options) => {
				const stream = new AssistantMessageEventStream();
				options?.signal?.addEventListener(
					"abort",
					() => stream.push({ type: "error", reason: "aborted", error: assistant([], "aborted") }),
					{ once: true },
				);
				markStarted?.();
				return stream;
			},
		});
		const execution = executeEngine(engine, snapshot(), controller.signal);
		await started;

		controller.abort("cancelled by test");

		await expect(execution).rejects.toMatchObject({ name: "AbortError" });
		expect(tracer.observations.map(({ type }) => type)).toEqual(["agent", "generation"]);
		expect(tracer.observations.every(({ ends }) => ends.length === 1)).toBe(true);
		expect(tracer.observations.every(({ ends }) => ends[0]?.level === "ERROR")).toBe(true);
		expect(tracer.flushCount).toBe(1);
	});

	it("supports agent-only tracing and explicit content capture", async () => {
		const tracer = new RecordingTracer();

		await execute(
			{
				model: model(),
				streamFn: sequenceStream([assistant([{ type: "text", text: "visible-output" }])]),
				tracer,
				tracing: { detail: "agent", captureContent: true },
			},
			snapshot(),
			"visible-input",
		);

		expect(tracer.observations).toHaveLength(1);
		expect(tracer.observations[0]).toMatchObject({ name: "agent.run", type: "agent" });
		const tracePayload = serializeObservations(tracer.observations);
		expect(tracePayload).toContain("visible-input");
		expect(tracePayload).toContain("visible-output");
	});
});

class RecordingTracer implements RuntimeTracer {
	readonly observations: RecordingObservation[] = [];
	flushCount = 0;

	startObservation(name: string, update?: ObservationStart, options?: ObservationOptions): RuntimeObservation {
		return this.createObservation(name, update, options);
	}

	flush(): Promise<void> {
		this.flushCount += 1;
		return Promise.resolve();
	}

	createObservation(name: string, update?: ObservationStart, options?: ObservationOptions): RecordingObservation {
		const observation = new RecordingObservation(this, name, update, options);
		this.observations.push(observation);
		return observation;
	}
}

class RecordingObservation implements RuntimeObservation {
	readonly id: string;
	readonly traceId = "trace-1";
	readonly type: RuntimeObservation["type"];
	readonly ends: ObservationUpdate[] = [];
	readonly updates: Exclude<ObservationUpdate, undefined>[] = [];

	constructor(
		private readonly tracer: RecordingTracer,
		readonly name: string,
		readonly start?: ObservationStart,
		options?: ObservationOptions,
	) {
		this.id = `observation-${tracer.observations.length + 1}`;
		this.type = options?.type ?? "span";
	}

	startObservation(name: string, update?: ObservationStart, options?: ObservationOptions): RuntimeObservation {
		return this.tracer.createObservation(name, update, options);
	}

	update(update: Exclude<ObservationUpdate, undefined>): void {
		this.updates.push(update);
	}

	end(update?: ObservationUpdate): void {
		this.ends.push(update);
	}
}

function serializeObservations(observations: readonly RecordingObservation[]): string {
	return JSON.stringify(
		observations.map(({ name, type, start, updates, ends }) => ({ name, type, start, updates, ends })),
	);
}

function sequenceStream(messages: readonly AssistantMessage[]): NonNullable<AgentCoreTurnEngineOptions["streamFn"]> {
	let index = 0;
	return () => {
		const message = messages[index];
		if (!message) throw new Error(`Missing response at index ${index}`);
		index += 1;
		return recordedStream(message);
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

function user(content: string): UserMessage {
	return { role: "user", content, timestamp: 1 };
}

async function execute(
	options: AgentCoreTurnEngineOptions,
	runtimeSnapshot: RuntimeSnapshot,
	content: string,
): Promise<void> {
	await executeEngine(new AgentCoreTurnEngine(options), runtimeSnapshot, undefined, content);
}

async function executeEngine(
	engine: AgentCoreTurnEngine,
	runtimeSnapshot: RuntimeSnapshot,
	signal: AbortSignal = new AbortController().signal,
	content = "hello",
): Promise<void> {
	for await (const _event of engine.execute({
		sessionId: "session-1",
		turnId: "turn-1",
		snapshot: runtimeSnapshot,
		messages: [user(content)],
		signal,
	})) {
		// Consume the turn to completion.
	}
}
