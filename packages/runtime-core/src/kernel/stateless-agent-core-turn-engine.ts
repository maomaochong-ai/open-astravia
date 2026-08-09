import {
	type AgentExecutionEvent,
	type AgentRunResult,
	type RuntimeToolDefinition as AgentRuntimeToolDefinition,
	AgentToolExecutionError,
	type AgentTurnRequest,
	runAgentTurn,
	type StreamFn,
	salvageTextToolCalls,
} from "@vetta/agent-core";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	adaptApiProvider,
	type Context,
	type Message,
	type Model,
	streamSimple,
	type Tool,
	Type,
	validateToolArguments,
} from "@vetta/ai";
import type { RuntimeMessageEnvelope } from "../runtime-execution-observation.js";
import type { RuntimeSessionObservationEvent } from "../session-observation.js";
import type { AgentCoreTurnEngineOptions } from "./agent-core-turn-engine-options.js";
import { AgentEngineTelemetry } from "./agent-engine-telemetry.js";
import { AgentEventDeliveryBarrier } from "./agent-event-delivery-barrier.js";
import {
	createContextCompositionLifecycle,
	wrapStreamFnWithModelCallLifecycle,
} from "./context-composition-lifecycle.js";
import type {
	ContinuationMessage,
	ModelCallFrame,
	QueuedSessionInput,
	RuntimeToolDefinition,
	RuntimeToolResult,
	SessionContextRecord,
	TurnEngineEvent,
	TurnEnginePort,
	TurnEngineRequest,
} from "./contracts.js";
import { turnProtocolError } from "./errors.js";
import { composeModelCallSystemPrompt, resolveModelCallFrame } from "./model-call-frame.js";
import { RuntimeToolExecutionError } from "./tool-execution-error.js";

const DEFAULT_MAX_MODEL_CALLS = 100;
const DEFAULT_MAX_TOOL_CALLS = 1_000;
const DEFAULT_CHECKPOINT_TIMEOUT_MS = 300_000;
type RuntimeInputSchema = ReturnType<typeof Type.Unsafe<Record<string, unknown>>>;

export class StatelessAgentCoreTurnEngine implements TurnEnginePort {
	constructor(private readonly options: AgentCoreTurnEngineOptions) {}

	async *execute(request: TurnEngineRequest): AsyncIterable<TurnEngineEvent> {
		request.signal.throwIfAborted();
		const model = request.modelBinding?.model ?? this.options.model;
		if (!model) throw turnProtocolError("Agent Core turn requires a model binding");

		const identities = new WeakMap<object, RuntimeMessageEnvelope>();
		const messages = request.contextMessages
			? hydrateMessages(request.contextMessages, identities)
			: [...request.messages];
		const telemetry = new AgentEngineTelemetry({
			tracer: this.options.tracer,
			tracing: this.options.tracing,
			sessionId: request.sessionId,
			model,
			messages,
			toolCount: (request.initialModelCallFrame?.tools ?? request.snapshot.tools).size,
		});
		const eventDelivery = new AgentEventDeliveryBarrier();
		try {
			const execution = this.createRequest(request, model, messages, identities, telemetry, eventDelivery);
			const run = runAgentTurn(execution);
			const projector = new AgentEventProjector(request.initialMessages ?? [], identities);

			for await (const event of run.events) {
				telemetry.observe(event);
				for (const projected of projector.project(event)) yield projected;
				eventDelivery.recordConsumption();
			}

			const result = await run.result;
			telemetry.finish(result);
			if (result.status !== "completed") throw runFailure(result);
			const assistant = result.lastAssistantMessage;
			if (!assistant) throw turnProtocolError("agent-core completed without an assistant message");
			yield { type: "completed", stopReason: assistant.stopReason };
		} catch (error) {
			telemetry.fail(error);
			throw error;
		}
	}

	private createRequest(
		request: TurnEngineRequest,
		model: Model<Api>,
		messages: readonly Message[],
		identities: WeakMap<object, RuntimeMessageEnvelope>,
		telemetry: AgentEngineTelemetry,
		eventDelivery: AgentEventDeliveryBarrier,
	): AgentTurnRequest {
		let initialFrame = request.initialModelCallFrame;
		let currentFrame = initialFrame;
		const inputQueue = request.inputQueue;
		const frames = new Map<number, ModelCallFrame>();
		const lifecycle = request.snapshot.contextCompositionPublisher
			? createContextCompositionLifecycle({
					turnId: request.turnId,
					snapshotId: request.snapshot.id,
					model,
					publisher: request.snapshot.contextCompositionPublisher,
					readFrame: () => currentFrame,
					input: request.input,
				})
			: undefined;
		const streamFn: StreamFn = lifecycle
			? wrapStreamFnWithModelCallLifecycle(lifecycle, this.options.streamFn)
			: (this.options.streamFn ?? streamSimple);
		const resolveFrame = async (modelCallIndex: number, frameMessages: readonly Message[], signal: AbortSignal) => {
			const frame =
				initialFrame ??
				(await resolveModelCallFrame(request.snapshot, {
					sessionId: request.sessionId,
					turnId: request.turnId,
					signal,
					input: request.input,
					messages: toRuntimeMessages(frameMessages, identities),
					modelBinding: request.modelBinding ?? {
						model,
						reasoning: this.options.streamOptions?.reasoning,
					},
				}));
			initialFrame = undefined;
			currentFrame = frame;
			frames.set(modelCallIndex, frame);
			return frame;
		};

		return {
			messages,
			limits: resolveLimits(this.options.limits),
			signal: request.signal,
			observer: () => eventDelivery.recordEmission(),
			resolveTools: async ({ modelCallIndex, messages: frameMessages, signal }) => {
				const frame = await resolveFrame(modelCallIndex, frameMessages, signal);
				return [...frame.tools.values()].map((tool) => toAgentTool(tool, request, identities));
			},
			resolveModelCall: async ({ modelCallIndex, messages: callMessages, tools, signal }) => {
				const frame = frames.get(modelCallIndex);
				if (!frame) throw turnProtocolError(`Missing model-call frame at index ${modelCallIndex}`);
				currentFrame = frame;
				const runtimeMessages = toRuntimeMessages(callMessages, identities);
				const finalizedMessages = request.snapshot.modelCallMessageFinalizer
					? [
							...(await request.snapshot.modelCallMessageFinalizer.finalize(
								{
									sessionId: request.sessionId,
									turnId: request.turnId,
									messages: runtimeMessages,
									modelBinding: request.modelBinding ?? {
										model,
										reasoning: this.options.streamOptions?.reasoning,
									},
								},
								signal,
							)),
						]
					: runtimeMessages;
				const context: Context = {
					systemPrompt: composeModelCallSystemPrompt({
						instructions: request.instructionOverride ?? frame.instructions,
					}),
					messages: finalizedMessages,
					tools: tools.map(toModelTool),
				};
				const effectiveStreamOptions = {
					...this.options.streamOptions,
					...(request.modelBinding ? { reasoning: request.modelBinding.reasoning } : {}),
					sessionId: request.sessionId,
					signal,
				};
				const generation = telemetry.startGeneration(context, effectiveStreamOptions);
				const apiKey = this.options.resolveApiKey
					? await this.options.resolveApiKey(model)
					: await this.options.getApiKey?.(model.provider);
				const response = await (async () => {
					try {
						const source = await streamFn(model, context, {
							...effectiveStreamOptions,
							apiKey: apiKey || this.options.streamOptions?.apiKey,
						});
						return await adaptApiProvider({
							api: model.api,
							stream: () => source,
							streamSimple: () => source,
						}).stream({ model, context });
					} catch (error) {
						generation.failed(error);
						throw error;
					}
				})();
				return {
					callId: `${request.turnId}:model-call:${modelCallIndex + 1}`,
					snapshotId: request.snapshot.id,
					response: {
						events: response.events,
						result: response.result.then(
							(assistant) => {
								if (request.snapshot.salvageTextToolCalls?.length) {
									salvageTextToolCalls(assistant, context.tools, request.snapshot.salvageTextToolCalls);
								}
								generation.completed(assistant);
								return assistant;
							},
							(error: unknown) => {
								generation.failed(error);
								throw error;
							},
						),
					},
				};
			},
			toolPolicy: {
				authorize: async ({ call, signal }) => {
					const authorized = await request.snapshot.toolPolicy.authorize(
						{
							sessionId: request.sessionId,
							turnId: request.turnId,
							toolName: call.name,
							input: call.arguments,
						},
						signal,
					);
					if (!authorized) throw new Error(`Tool execution denied by policy: ${call.name}`);
				},
			},
			checkpoint:
				request.checkpoint || request.snapshot.modelCallContextTransformer
					? async (checkpointRequest, signal) => {
							await eventDelivery.waitForCurrentDelivery(signal);
							let checkpointMessages = toRuntimeMessages(checkpointRequest.messages, identities);
							if (checkpointRequest.reason === "model_call" && request.snapshot.modelCallContextTransformer) {
								checkpointMessages = [
									...(await request.snapshot.modelCallContextTransformer.transform(
										{
											sessionId: request.sessionId,
											turnId: request.turnId,
											messages: checkpointMessages,
											messageEnvelopes: toRuntimeMessageEnvelopes(checkpointRequest.messages, identities),
											modelBinding: request.modelBinding ?? {
												model,
												reasoning: this.options.streamOptions?.reasoning,
											},
										},
										signal,
									)),
								];
							}
							const result = await request.checkpoint?.(
								{
									reason: checkpointRequest.reason,
									messages: checkpointMessages,
									assistantMessage: checkpointRequest.assistantMessage,
									recoveryAttempt: checkpointRequest.recoveryAttempt,
								},
								signal,
							);
							if (!result) {
								return checkpointRequest.reason === "model_call" ? { messages: checkpointMessages } : undefined;
							}
							return {
								messages: result.messages,
								contextMessages: result.contextMessageEnvelopes
									? hydrateMessages(result.contextMessageEnvelopes, identities)
									: result.contextMessages,
								retry: result.retry,
							};
						}
					: undefined,
			takeSteeringMessages: inputQueue
				? async () =>
						inputQueue.takeSteeringInputs
							? this.consumeQueuedInputs(inputQueue.takeSteeringInputs(), request, identities)
							: [...inputQueue.takeSteering()]
				: undefined,
			takeContinuationMessages:
				inputQueue || request.snapshot.continuationPolicy
					? async ({ messages: continuationMessages, signal }) => {
							const policyEntries =
								(await request.snapshot.continuationPolicy?.collect({
									sessionId: request.sessionId,
									turnId: request.turnId,
									signal,
									messages: toRuntimeMessages(continuationMessages, identities),
									modelBinding: request.modelBinding,
								})) ?? [];
							const policyMessages = policyEntries.map((entry) => {
								if (!isContinuationMessage(entry)) return entry;
								identities.set(entry.message, {
									kind: "message",
									message: entry.message,
									origin: { kind: "continuation", source: entry.source },
								});
								return entry.message;
							});
							if (!inputQueue) return policyMessages;
							inputQueue.enqueueFollowUps(policyMessages);
							return inputQueue.takeFollowUpInputs
								? this.consumeQueuedInputs(inputQueue.takeFollowUpInputs(), request, identities)
								: [...inputQueue.takeFollowUps()];
						}
					: undefined,
		};
	}

	private async consumeQueuedInputs(
		inputs: readonly QueuedSessionInput[],
		request: TurnEngineRequest,
		identities: WeakMap<object, RuntimeMessageEnvelope>,
	): Promise<Message[]> {
		const context = inputs.flatMap((input) => input.context ?? []);
		if (context.length > 0) await request.appendQueuedContext?.(context);
		return inputs.flatMap((input) => {
			const contextMessages = (input.context ?? []).map((record) => {
				const message = contextRecordToUserMessage(record);
				identities.set(message, { kind: "context", record, timestamp: message.timestamp });
				return message;
			});
			return [...contextMessages, ...(input.message ? [input.message] : [])];
		});
	}
}

class AgentEventProjector {
	private currentAssistant?: AssistantMessage;
	private toolResults: Message[] = [];
	private turnStarted = false;
	private assistantMessageStarted = false;
	private readonly runMessages: RuntimeMessageEnvelope[] = [];

	constructor(
		private readonly initialMessages: readonly RuntimeMessageEnvelope[],
		private readonly identities: WeakMap<object, RuntimeMessageEnvelope>,
	) {}

	project(event: AgentExecutionEvent): TurnEngineEvent[] {
		if (event.type === "run_start") {
			this.turnStarted = true;
			return [
				{ type: "execution_observation", observation: { type: "agent.start" } },
				{ type: "observation", observation: lifecycle("agent_start") },
				{ type: "execution_observation", observation: { type: "turn.start" } },
				{ type: "observation", observation: lifecycle("turn_start") },
				...this.initialMessages.flatMap((message) => messageLifecycle(message)),
			];
		}
		if (event.type === "model_call_start") {
			this.assistantMessageStarted = false;
			return this.startNextTurnIfNeeded();
		}
		if (event.type === "model_event") return this.projectModelEvent(event.event);
		if (event.type === "assistant_message") {
			this.currentAssistant = event.message;
			const envelope = toRuntimeMessageEnvelope(event.message, this.identities);
			this.runMessages.push(envelope);
			return [
				...(!this.assistantMessageStarted
					? [{ type: "execution_observation", observation: { type: "message.start", message: envelope } } as const]
					: []),
				...(envelope
					? [{ type: "execution_observation", observation: { type: "message.end", message: envelope } } as const]
					: []),
				{ type: "message", message: event.message, ...messageOrigin(event.message, this.identities) },
			];
		}
		if (event.type === "input_message") {
			const envelope = toRuntimeMessageEnvelope(event.message, this.identities);
			this.runMessages.push(envelope);
			return [
				...this.finishTurn(),
				...this.startTurn(),
				...(envelope ? messageLifecycle(envelope) : []),
				{ type: "message", message: event.message, ...messageOrigin(event.message, this.identities) },
			];
		}
		if (event.type === "tool_execution_start") {
			return [
				{
					type: "execution_observation",
					observation: {
						type: "tool.execution.start",
						toolCallId: event.call.id,
						toolName: event.call.name,
						args: event.call.arguments,
						startedAt: event.startedAt,
					},
				},
				{
					type: "observation",
					observation: {
						type: "tool.start",
						toolCallId: event.call.id,
						toolName: event.call.name,
						args: event.call.arguments,
						startedAt: event.startedAt,
						source: "tool",
					},
				},
			];
		}
		if (event.type === "tool_execution_update") {
			return [
				{
					type: "execution_observation",
					observation: {
						type: "tool.execution.update",
						toolCallId: event.call.id,
						toolName: event.call.name,
						args: event.call.arguments,
						partialResult: event.update,
					},
				},
				{
					type: "observation",
					observation: {
						type: "tool.update",
						toolCallId: event.call.id,
						toolName: event.call.name,
						partialResult: event.update,
						source: "tool",
					},
				},
			];
		}
		if (event.type === "tool_execution_phase") {
			return [
				{
					type: "execution_observation",
					observation: {
						type: "tool.execution.phase",
						toolCallId: event.call.id,
						toolName: event.call.name,
						label: event.phase.label,
						atMs: event.phase.atMs,
					},
				},
				{
					type: "observation",
					observation: {
						type: "tool.phase",
						toolCallId: event.call.id,
						toolName: event.call.name,
						label: event.phase.label,
						atMs: event.phase.atMs,
						source: "tool",
					},
				},
			];
		}
		if (event.type === "tool_execution_finish") {
			this.toolResults.push(event.result);
			const result: RuntimeToolResult = { content: event.result.content, details: event.result.details };
			const envelope = toRuntimeMessageEnvelope(event.result, this.identities);
			this.runMessages.push(envelope);
			return [
				{
					type: "execution_observation",
					observation: {
						type: "tool.execution.end",
						toolCallId: event.call.id,
						toolName: event.call.name,
						result,
						isError: event.result.isError,
						startedAt: event.startedAt,
						durationMs: event.durationMs,
						phases: event.phases,
					},
				},
				{
					type: "observation",
					observation: {
						type: "tool.end",
						toolCallId: event.call.id,
						toolName: event.call.name,
						isError: event.result.isError,
						result,
						startedAt: event.startedAt,
						durationMs: event.durationMs,
						phases: event.phases,
						source: "tool",
					},
				},
				...(envelope ? messageLifecycle(envelope) : []),
				{ type: "message", message: event.result },
			];
		}
		if (event.type === "run_finish") {
			return [
				...this.finishTurn(),
				{
					type: "execution_observation",
					observation: {
						type: "agent.end",
						messages: [...this.initialMessages, ...this.runMessages],
					},
				},
				{ type: "observation", observation: lifecycle("agent_end") },
			];
		}
		return [];
	}

	private projectModelEvent(event: AssistantMessageEvent): TurnEngineEvent[] {
		if (event.type === "start") {
			this.assistantMessageStarted = true;
			const envelope = toRuntimeMessageEnvelope(event.partial, this.identities);
			return envelope
				? [{ type: "execution_observation", observation: { type: "message.start", message: envelope } }]
				: [];
		}
		if (
			event.type === "text_start" ||
			event.type === "text_delta" ||
			event.type === "text_end" ||
			event.type === "thinking_start" ||
			event.type === "thinking_delta" ||
			event.type === "thinking_end" ||
			event.type === "toolcall_start" ||
			event.type === "toolcall_delta" ||
			event.type === "toolcall_end"
		) {
			const envelope = toRuntimeMessageEnvelope(event.partial, this.identities);
			const projected: TurnEngineEvent[] = envelope
				? [
						{
							type: "execution_observation",
							observation: { type: "message.update", message: envelope, assistantMessageEvent: event },
						},
					]
				: [];
			if (event.type === "text_delta") {
				projected.push({
					type: "observation",
					observation: { type: "message.delta", delta: event.delta, source: "agent" },
				});
			} else if (event.type === "thinking_delta") {
				projected.push({
					type: "observation",
					observation: { type: "thinking.delta", delta: event.delta, source: "agent" },
				});
			} else if (event.type === "toolcall_start") {
				const call = event.partial.content[event.contentIndex];
				if (call?.type === "toolCall") {
					projected.push({
						type: "observation",
						observation: {
							type: "toolcall.start",
							toolCallId: call.id,
							toolName: call.name,
							source: "agent",
						},
					});
				}
			}
			return projected;
		}
		return [];
	}

	private startNextTurnIfNeeded(): TurnEngineEvent[] {
		if (!this.currentAssistant) return [];
		return [...this.finishTurn(), ...this.startTurn()];
	}

	private startTurn(): TurnEngineEvent[] {
		this.turnStarted = true;
		return [
			{ type: "execution_observation", observation: { type: "turn.start" } },
			{ type: "observation", observation: lifecycle("turn_start") },
		];
	}

	private finishTurn(): TurnEngineEvent[] {
		if (!this.turnStarted || !this.currentAssistant) return [];
		const message = this.currentAssistant;
		const toolResults = this.toolResults.filter(
			(result): result is Extract<Message, { role: "toolResult" }> => result.role === "toolResult",
		);
		this.currentAssistant = undefined;
		this.toolResults = [];
		this.turnStarted = false;
		return [
			{
				type: "execution_observation",
				observation: { type: "turn.end", message, toolResults },
			},
			{ type: "observation", observation: lifecycle("turn_end") },
		];
	}
}

function toAgentTool(
	tool: RuntimeToolDefinition,
	request: TurnEngineRequest,
	identities: WeakMap<object, RuntimeMessageEnvelope>,
): AgentRuntimeToolDefinition<RuntimeInputSchema, unknown | undefined> {
	const modelTool: Tool<RuntimeInputSchema> = {
		name: tool.name,
		description: tool.description,
		parameters: Type.Unsafe<Record<string, unknown>>({ ...tool.inputSchema }),
	};
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: modelTool.parameters,
		validateInput: (input) =>
			validateToolArguments(modelTool, {
				type: "toolCall",
				id: "runtime-validation",
				name: tool.name,
				arguments: input,
			}),
		async execute(input, context) {
			try {
				const result = await tool.execute({
					sessionId: request.sessionId,
					turnId: request.turnId,
					toolCallId: context.toolCallId,
					input,
					messages: toRuntimeMessages(context.messages, identities),
					signal: context.signal,
					onUpdate: (update) => context.onUpdate({ content: update.content, details: update.details }),
					reportPhase: context.reportPhase,
				});
				return { content: [...result.content], details: result.details };
			} catch (error) {
				if (error instanceof RuntimeToolExecutionError) {
					throw new AgentToolExecutionError(error.message, error.details, { cause: error });
				}
				throw error;
			}
		},
	};
}

function toModelTool(tool: AgentRuntimeToolDefinition): Tool {
	return { name: tool.name, description: tool.description, parameters: tool.inputSchema };
}

function resolveLimits(limits: AgentCoreTurnEngineOptions["limits"]): AgentTurnRequest["limits"] {
	const maxModelCalls = limits?.maxModelCalls ?? DEFAULT_MAX_MODEL_CALLS;
	return {
		maxModelCalls,
		maxToolCalls: limits?.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
		maxRecoveryAttempts: maxModelCalls,
		checkpointTimeoutMs: limits?.contextCheckpointTimeoutMs ?? DEFAULT_CHECKPOINT_TIMEOUT_MS,
	};
}

function runFailure(result: AgentRunResult): Error {
	const error = new Error(result.failure?.message ?? `Agent run ended with status: ${result.status}`);
	error.name = result.failure?.code ?? "AgentRunError";
	return error;
}

function lifecycle(phase: "agent_start" | "turn_start" | "turn_end" | "agent_end"): RuntimeSessionObservationEvent {
	return { type: "lifecycle", phase, source: "runtime-core" };
}

function messageLifecycle(message: RuntimeMessageEnvelope): TurnEngineEvent[] {
	return [
		{ type: "execution_observation", observation: { type: "message.start", message } },
		{ type: "execution_observation", observation: { type: "message.end", message } },
	];
}

function contextRecordToUserMessage(record: SessionContextRecord): Message {
	return { role: "user", content: record.content, timestamp: record.timestamp ?? Date.now() };
}

function toRuntimeMessages(
	messages: readonly Message[],
	identities: WeakMap<object, RuntimeMessageEnvelope>,
): Message[] {
	return messages.flatMap((message) => {
		const identity = identities.get(message);
		if (identity) return envelopeToRuntimeMessages(identity);
		return [message];
	});
}

function toRuntimeMessageEnvelopes(
	messages: readonly Message[],
	identities: WeakMap<object, RuntimeMessageEnvelope>,
): RuntimeMessageEnvelope[] {
	return messages.map((message) => identities.get(message) ?? { kind: "message", message });
}

function toRuntimeMessageEnvelope(
	message: Message,
	identities: WeakMap<object, RuntimeMessageEnvelope>,
): RuntimeMessageEnvelope {
	return identities.get(message) ?? { kind: "message", message };
}

function hydrateMessages(
	envelopes: readonly RuntimeMessageEnvelope[],
	identities: WeakMap<object, RuntimeMessageEnvelope>,
): Message[] {
	return envelopes.map((envelope) => {
		const message = envelopeToPlaceholder(envelope);
		if (envelope.kind !== "message" || envelope.origin) identities.set(message, envelope);
		return message;
	});
}

function messageOrigin(
	message: Message,
	identities: WeakMap<object, RuntimeMessageEnvelope>,
): Pick<Extract<TurnEngineEvent, { readonly type: "message" }>, "origin"> | Record<never, never> {
	const envelope = identities.get(message);
	return envelope?.kind === "message" && envelope.origin ? { origin: envelope.origin } : {};
}

function isContinuationMessage(
	value: ContinuationMessage["message"] | ContinuationMessage,
): value is ContinuationMessage {
	return "message" in value && "source" in value;
}

function envelopeToPlaceholder(envelope: RuntimeMessageEnvelope): Message {
	if (envelope.kind === "message") return envelope.message;
	if (envelope.kind === "opaque" && envelope.modelMessage) return envelope.modelMessage;
	if (envelope.kind === "context") return contextRecordToUserMessage(envelope.record);
	return { role: "user", content: [], timestamp: envelope.timestamp };
}

function envelopeToRuntimeMessages(envelope: RuntimeMessageEnvelope): Message[] {
	if (envelope.kind === "message") return [envelope.message];
	if (envelope.kind === "opaque") return envelope.modelMessage ? [envelope.modelMessage] : [];
	if (!envelope.record.modelVisible) return [];
	return [
		{
			role: "user",
			content: envelope.record.content,
			timestamp: envelope.timestamp,
		},
	];
}
