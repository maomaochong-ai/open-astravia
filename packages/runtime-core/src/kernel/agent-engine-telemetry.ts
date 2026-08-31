import type { AgentExecutionEvent, AgentRunResult } from "@vetta/agent-core";
import {
	type Api,
	type AssistantMessage,
	aggregatePromptCacheUsage,
	type Context,
	calculatePromptCacheMetrics,
	type Message,
	type Model,
	type SimpleStreamOptions,
} from "@vetta/ai";
import type { RuntimeObservationPublisher } from "../observation/contracts.js";
import { RUNTIME_EXECUTION_TRACE } from "../observation/execution-trace.js";
import { runtimeObservationFailure } from "../observation/observation.js";
import type { AgentCoreTurnEngineOptions } from "./agent-core-turn-engine-options.js";

type RuntimeTracer = NonNullable<AgentCoreTurnEngineOptions["tracer"]>;
type RuntimeObservation = ReturnType<RuntimeTracer["startObservation"]>;
type TracingOptions = AgentCoreTurnEngineOptions["tracing"];

export interface AgentEngineTelemetryOptions {
	readonly tracer?: AgentCoreTurnEngineOptions["tracer"];
	readonly tracing?: TracingOptions;
	readonly sessionId: string;
	readonly turnId?: string;
	readonly observations?: RuntimeObservationPublisher;
	readonly model: Model<Api>;
	readonly messages: readonly Message[];
	readonly toolCount: number;
}

export interface GenerationTelemetry {
	completed(message: AssistantMessage): void;
	failed(error: unknown): void;
}

export class AgentEngineTelemetry {
	private readonly captureContent: boolean;
	private readonly traceChildren: boolean;
	private readonly deliveredMessages: Message[] = [];
	private readonly openChildren = new Set<TerminalObservation>();
	private readonly toolObservations = new Map<string, TerminalObservation>();
	private readonly agentObservation?: RuntimeObservation;
	private readonly agentTerminal?: TerminalObservation;
	private settled = false;
	private modelCallIndex = 0;

	constructor(private readonly options: AgentEngineTelemetryOptions) {
		this.captureContent = options.tracing?.captureContent === true;
		this.traceChildren = options.tracing?.detail !== "agent";
		this.agentObservation = safely(() =>
			options.tracer?.startObservation(
				"agent.run",
				{
					...traceAttributes(options.tracing, options.sessionId),
					input: this.captureContent
						? { messages: options.messages }
						: { messageCount: options.messages.length, toolCount: options.toolCount },
					metadata: {
						...options.tracing?.metadata,
						sessionId: options.sessionId,
						turnId: options.turnId,
						model: options.model.id,
						provider: options.model.provider,
						api: options.model.api,
						initialMessageCount: options.messages.length,
						toolCount: options.toolCount,
					},
				},
				{ type: "agent" },
			),
		);
		if (this.agentObservation)
			safely(() =>
				options.observations?.record(
					RUNTIME_EXECUTION_TRACE,
					{ spanId: this.agentObservation!.id },
					{ sessionId: options.sessionId, turnId: options.turnId, traceId: this.agentObservation!.traceId },
				),
			);
		this.agentTerminal = this.agentObservation
			? new TerminalObservation(this.agentObservation, () => undefined)
			: undefined;
	}

	startGeneration(context: Context, streamOptions: SimpleStreamOptions | undefined): GenerationTelemetry {
		if (!this.agentObservation || !this.traceChildren) return NOOP_GENERATION;
		const modelCallId = this.options.turnId
			? `${this.options.turnId}:model-call:${++this.modelCallIndex}`
			: undefined;
		const observation = safely(() =>
			this.agentObservation!.startObservation(
				`llm.${this.options.model.provider}.${this.options.model.id}`,
				{
					...traceAttributes(this.options.tracing, this.options.sessionId),
					input: this.captureContent
						? context
						: {
								messageCount: context.messages.length,
								systemPromptLength: context.systemPrompt?.length ?? 0,
								tools: context.tools?.map(({ name }) => name) ?? [],
							},
					model: this.options.model.id,
					modelParameters: modelParameters(streamOptions),
					metadata: {
						turnId: this.options.turnId,
						modelCallId,
						api: this.options.model.api,
						provider: this.options.model.provider,
						messageCount: context.messages.length,
						toolCount: context.tools?.length ?? 0,
					},
				},
				{ type: "generation" },
			),
		);
		if (!observation) return NOOP_GENERATION;
		const terminal = this.track(observation);
		return {
			completed: (message) => terminal.end(assistantUpdate(message, this.captureContent)),
			failed: (error) =>
				terminal.end({ level: "ERROR", statusMessage: this.captureContent ? errorMessage(error) : undefined }),
		};
	}

	observe(event: AgentExecutionEvent): void {
		if (event.type === "assistant_message") this.deliveredMessages.push(event.message);
		if (event.type === "input_message") this.deliveredMessages.push(event.message);
		if (event.type === "tool_execution_start") this.startTool(event);
		if (event.type === "tool_execution_finish") {
			this.deliveredMessages.push(event.result);
			this.finishTool(event);
		}
	}

	finish(result: AgentRunResult): void {
		if (this.settled) return;
		this.settled = true;
		this.closeChildren(this.captureContent ? result.failure?.message : undefined);
		if (this.agentTerminal) {
			const { usage, cost, promptCache } = aggregateAssistantTelemetry(this.deliveredMessages);
			this.agentTerminal.end({
				output: this.captureContent ? { messages: this.deliveredMessages } : messageSummary(this.deliveredMessages),
				level: result.status === "completed" ? "DEFAULT" : "ERROR",
				statusMessage: this.captureContent ? result.failure?.message : undefined,
				usageDetails: usage,
				costDetails: cost,
				metadata: {
					status: result.status,
					code: result.failure?.code,
					messageCount: this.deliveredMessages.length,
					modelCalls: result.modelCalls,
					toolCalls: result.toolCalls,
					recoveryAttempts: result.recoveryAttempts,
					promptCache,
				},
			});
		}
		this.flush();
	}

	fail(error: unknown): void {
		if (this.settled) return;
		this.settled = true;
		const message = this.captureContent ? errorMessage(error) : undefined;
		this.closeChildren(message);
		this.agentTerminal?.end({
			level: "ERROR",
			statusMessage: message,
			metadata: { status: "failed", code: runtimeObservationFailure(error).errorCode },
		});
		this.flush();
	}

	private flush(): void {
		safely(() => {
			void Promise.resolve(this.options.tracer?.flush?.()).catch(() => undefined);
		});
	}

	private startTool(event: Extract<AgentExecutionEvent, { type: "tool_execution_start" }>): void {
		if (!this.agentObservation || !this.traceChildren) return;
		const observation = safely(() =>
			this.agentObservation!.startObservation(
				`tool.${event.call.name}`,
				{
					...traceAttributes(this.options.tracing, this.options.sessionId),
					input: {
						id: event.call.id,
						name: event.call.name,
						arguments: this.captureContent ? event.call.arguments : { keys: Object.keys(event.call.arguments) },
					},
					metadata: { turnId: this.options.turnId, toolCallId: event.call.id, toolName: event.call.name },
				},
				{ type: "tool" },
			),
		);
		if (!observation) return;
		this.toolObservations.set(event.call.id, this.track(observation));
	}

	private finishTool(event: Extract<AgentExecutionEvent, { type: "tool_execution_finish" }>): void {
		const observation = this.toolObservations.get(event.call.id);
		if (!observation) return;
		this.toolObservations.delete(event.call.id);
		observation.end({
			output: this.captureContent
				? { content: event.result.content, details: event.result.details }
				: { contentTypes: event.result.content.map(({ type }) => type) },
			level: event.result.isError ? "ERROR" : "DEFAULT",
			statusMessage: this.captureContent && event.result.isError ? textContent(event.result) : undefined,
			metadata: {
				isError: event.result.isError,
				...(event.result.isError ? { code: "TOOL_RESULT_ERROR" } : {}),
				durationMs: event.durationMs,
				phaseCount: event.phases.length,
				phases: this.captureContent ? event.phases : event.phases.map(({ atMs }) => ({ atMs })),
			},
		});
	}

	private track(observation: RuntimeObservation): TerminalObservation {
		const terminal = new TerminalObservation(observation, () => this.openChildren.delete(terminal));
		this.openChildren.add(terminal);
		return terminal;
	}

	private closeChildren(statusMessage?: string): void {
		for (const observation of [...this.openChildren]) {
			observation.end({
				level: "ERROR",
				statusMessage: statusMessage ?? "Agent run ended before observation completion",
			});
		}
		this.toolObservations.clear();
	}
}

class TerminalObservation {
	private ended = false;

	constructor(
		private readonly observation: RuntimeObservation,
		private readonly onEnd: () => void,
	) {}

	end(update?: Parameters<RuntimeObservation["end"]>[0]): void {
		if (this.ended) return;
		this.ended = true;
		safely(() => this.observation.end(update));
		this.onEnd();
	}
}

const NOOP_GENERATION: GenerationTelemetry = {
	completed() {},
	failed() {},
};

function traceAttributes(tracing: TracingOptions, sessionId: string) {
	return {
		userId: tracing?.userId,
		sessionId,
		traceName: tracing?.traceName,
		tags: tracing?.tags,
		version: tracing?.version,
	};
}

function modelParameters(options: SimpleStreamOptions | undefined): Record<string, string | number> {
	const parameters: Record<string, string | number> = {};
	if (options?.reasoning) parameters.reasoning = options.reasoning;
	if (options?.transport) parameters.transport = options.transport;
	return parameters;
}

function assistantUpdate(message: AssistantMessage, captureContent: boolean) {
	const promptCache = calculatePromptCacheMetrics(message.usage);
	return {
		output: captureContent ? message.content : { contentTypes: message.content.map(({ type }) => type) },
		level: message.stopReason === "error" ? ("ERROR" as const) : ("DEFAULT" as const),
		statusMessage: captureContent ? message.errorMessage : undefined,
		usageDetails: {
			input: message.usage.input,
			output: message.usage.output,
			cacheRead: message.usage.cacheRead,
			cacheWrite: message.usage.cacheWrite,
			totalTokens: message.usage.totalTokens,
		},
		costDetails: {
			input: message.usage.cost.input,
			output: message.usage.cost.output,
			cacheRead: message.usage.cost.cacheRead,
			cacheWrite: message.usage.cost.cacheWrite,
			total: message.usage.cost.total,
		},
		metadata: {
			api: message.api,
			code: message.failure?.code,
			provider: message.provider,
			model: message.model,
			stopReason: message.stopReason,
			promptCache: {
				reporting: message.usage.cacheUsageReporting ?? "unavailable",
				...promptCache,
			},
		},
	};
}

function aggregateAssistantTelemetry(messages: readonly Message[]) {
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
	const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	const promptCacheUsages: AssistantMessage["usage"][] = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		usage.input += message.usage.input;
		usage.output += message.usage.output;
		usage.cacheRead += message.usage.cacheRead;
		usage.cacheWrite += message.usage.cacheWrite;
		usage.totalTokens += message.usage.totalTokens;
		cost.input += message.usage.cost.input;
		cost.output += message.usage.cost.output;
		cost.cacheRead += message.usage.cost.cacheRead;
		cost.cacheWrite += message.usage.cost.cacheWrite;
		cost.total += message.usage.cost.total;
		promptCacheUsages.push(message.usage);
	}
	return { usage, cost, promptCache: aggregatePromptCacheUsage(promptCacheUsages) };
}

function messageSummary(messages: readonly Message[]) {
	return {
		messageCount: messages.length,
		assistantMessageCount: messages.filter(({ role }) => role === "assistant").length,
		toolResultCount: messages.filter(({ role }) => role === "toolResult").length,
	};
}

function textContent(message: Extract<Message, { role: "toolResult" }>): string | undefined {
	const text = message.content
		.filter((block) => block.type === "text")
		.map(({ text }) => text)
		.join("\n");
	return text || undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function safely<T>(operation: () => T): T | undefined {
	try {
		return operation();
	} catch {
		return undefined;
	}
}
