import {
	type AgentContextCheckpointResult,
	type AgentEvent,
	type AgentLoopConfig,
	type AgentMessage,
	type AgentTool,
	AgentToolExecutionError,
	agentLoopContinue,
	type StreamFn,
} from "@vetta/agent-core";
import { type Api, type Message, type Model, type SimpleStreamOptions, Type } from "@vetta/ai";
import type { RuntimeExecutionObservationEvent, RuntimeMessageEnvelope } from "../runtime-execution-observation.js";
import type { RuntimeSessionObservationEvent } from "../session-observation.js";
import type {
	QueuedSessionInput,
	RuntimeSnapshot,
	RuntimeToolDefinition,
	RuntimeToolResult,
	SessionContextRecord,
	TurnEngineContextCheckpointResult,
	TurnEngineEvent,
	TurnEnginePort,
	TurnEngineRequest,
} from "./contracts.js";
import { turnProtocolError } from "./errors.js";
import { composeModelCallSystemPrompt, resolveModelCallFrame } from "./model-call-frame.js";
import { RuntimeToolExecutionError } from "./tool-execution-error.js";

export interface AgentCoreTurnEngineOptions {
	/** 兼容静态组合；生产 Runtime 应通过 TurnEngineRequest.modelBinding 提供模型。 */
	readonly model?: Model<Api>;
	readonly streamOptions?: Omit<SimpleStreamOptions, "sessionId" | "signal">;
	readonly streamFn?: StreamFn;
	readonly getApiKey?: AgentLoopConfig["getApiKey"];
	/** 平台中立的观测端口；Runtime 只透传，不创建或释放具体实现。 */
	readonly tracer?: AgentLoopConfig["tracer"];
	/** Turn 共享的观测策略；实际 Session 身份由 execute 请求覆盖。 */
	readonly tracing?: AgentLoopConfig["tracing"];
	/** 按 Turn binding 的精确模型解析凭证，避免切模后读取另一个模型的凭证。 */
	readonly resolveApiKey?: (model: Model<Api>) => Promise<string | undefined> | string | undefined;
}

export class AgentCoreTurnEngine implements TurnEnginePort {
	private readonly options: AgentCoreTurnEngineOptions;

	constructor(options: AgentCoreTurnEngineOptions) {
		this.options = options;
	}

	async *execute(request: TurnEngineRequest): AsyncIterable<TurnEngineEvent> {
		request.signal.throwIfAborted();
		const contextMessageIdentities = new WeakMap<object, RuntimeMessageEnvelope>();
		const contextMessages = request.contextMessages
			? hydrateAgentMessages(request.contextMessages, contextMessageIdentities)
			: [...request.messages];
		const stream = agentLoopContinue(
			{
				systemPrompt: resolveRequestSystemPrompt(request, request.initialModelCallFrame ?? request.snapshot),
				messages: contextMessages,
				tools: [...(request.initialModelCallFrame?.tools ?? request.snapshot.tools).values()].map((tool) =>
					this.toAgentTool(tool, request, contextMessageIdentities),
				),
			},
			this.createConfig(request, contextMessageIdentities),
			request.signal,
			this.options.streamFn,
		);
		let finalAssistantMessage: Extract<Message, { role: "assistant" }> | undefined;
		let initialMessagesObserved = false;

		for await (const event of stream) {
			if (event.type === "context_checkpoint") {
				yield {
					type: "context_checkpoint",
					request: {
						reason: event.request.reason,
						messages: toRuntimeMessages(event.request.messages, contextMessageIdentities),
						assistantMessage: event.request.assistantMessage,
						recoveryAttempt: event.request.recoveryAttempt,
						complete: (result) => {
							event.request.complete(toAgentCheckpointResult(result, contextMessageIdentities));
						},
						fail: (error) => {
							event.request.fail(error);
						},
					},
				};
				continue;
			}
			const executionObservation = mapAgentCoreEventToExecutionObservation(
				event,
				request.initialMessages ?? [],
				contextMessageIdentities,
			);
			if (executionObservation) {
				yield { type: "execution_observation", observation: executionObservation };
			}
			if (event.type === "turn_start" && !initialMessagesObserved) {
				initialMessagesObserved = true;
				for (const message of request.initialMessages ?? []) {
					yield { type: "execution_observation", observation: { type: "message.start", message } };
					yield { type: "execution_observation", observation: { type: "message.end", message } };
				}
			}
			const observation = mapAgentCoreEventToObservation(event);
			if (observation) {
				yield { type: "observation", observation };
			}
			if (event.type !== "message_end" || !isRuntimeMessage(event.message)) continue;
			if (event.message.role === "assistant") {
				finalAssistantMessage = event.message;
			}
			yield {
				type: "message",
				message: event.message,
			};
		}

		if (!finalAssistantMessage) {
			throw turnProtocolError("agent-core completed without an assistant message");
		}

		yield {
			type: "completed",
			stopReason: finalAssistantMessage.stopReason,
		};
	}

	private createConfig(
		request: TurnEngineRequest,
		contextMessageIdentities: WeakMap<object, RuntimeMessageEnvelope>,
	): AgentLoopConfig {
		const inputQueue = request.inputQueue;
		const contextTransformer = request.snapshot.modelCallContextTransformer;
		let initialModelCallFrame = request.initialModelCallFrame;
		const model = request.modelBinding?.model ?? this.options.model;
		if (!model) {
			throw turnProtocolError("Agent Core turn requires a model binding");
		}
		const getApiKey = this.options.resolveApiKey
			? (_provider: string) => this.options.resolveApiKey?.(model)
			: this.options.getApiKey;
		return {
			...this.options.streamOptions,
			salvageTextToolCalls: request.snapshot.salvageTextToolCalls
				? [...request.snapshot.salvageTextToolCalls]
				: undefined,
			...(request.modelBinding ? { reasoning: request.modelBinding.reasoning } : {}),
			model,
			tracer: this.options.tracer,
			tracing:
				this.options.tracer || this.options.tracing
					? {
							...this.options.tracing,
							sessionId: request.sessionId,
							metadata: {
								...this.options.tracing?.metadata,
								sessionId: request.sessionId,
							},
						}
					: undefined,
			get sessionId() {
				return request.sessionId;
			},
			getApiKey,
			convertToLlm: async (messages) => {
				const runtimeMessages = toRuntimeMessages(messages, contextMessageIdentities);
				return request.snapshot.modelCallMessageFinalizer
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
								request.signal,
							)),
						]
					: runtimeMessages;
			},
			contextCheckpoints: request.contextCheckpoints,
			transformContext: contextTransformer
				? async (messages, signal) => {
						const executionSignal = signal ?? request.signal;
						return [
							...(await contextTransformer.transform(
								{
									sessionId: request.sessionId,
									turnId: request.turnId,
									messages: toRuntimeMessages(messages, contextMessageIdentities),
									messageEnvelopes: toRuntimeMessageEnvelopes(messages, contextMessageIdentities),
									modelBinding: request.modelBinding ?? {
										model,
										reasoning: this.options.streamOptions?.reasoning,
									},
								},
								executionSignal,
							)),
						];
					}
				: undefined,
			getSteeringMessages: inputQueue
				? async () =>
						inputQueue.takeSteeringInputs
							? this.consumeQueuedInputs(inputQueue.takeSteeringInputs(), request, contextMessageIdentities)
							: [...inputQueue.takeSteering()]
				: undefined,
			getContinuationMessages:
				inputQueue || request.snapshot.continuationPolicy
					? async (messages, signal) => {
							const executionSignal = signal ?? request.signal;
							const policyMessages =
								(await request.snapshot.continuationPolicy?.collect({
									sessionId: request.sessionId,
									turnId: request.turnId,
									signal: executionSignal,
									messages: toRuntimeMessages(messages, contextMessageIdentities),
									modelBinding: request.modelBinding,
								})) ?? [];
							if (!inputQueue) return [...policyMessages];
							inputQueue.enqueueFollowUps(policyMessages);
							return inputQueue.takeFollowUpInputs
								? this.consumeQueuedInputs(inputQueue.takeFollowUpInputs(), request, contextMessageIdentities)
								: [...inputQueue.takeFollowUps()];
						}
					: undefined,
			resolveCallContext: async (_context, signal) => {
				const executionSignal = signal ?? request.signal;
				const frame =
					initialModelCallFrame ??
					(await resolveModelCallFrame(request.snapshot, {
						sessionId: request.sessionId,
						turnId: request.turnId,
						signal: executionSignal,
						input: request.input,
						messages: toRuntimeMessages(_context.messages, contextMessageIdentities),
						modelBinding: request.modelBinding ?? {
							model,
							reasoning: this.options.streamOptions?.reasoning,
						},
					}));
				initialModelCallFrame = undefined;
				return {
					systemPrompt: resolveRequestSystemPrompt(request, frame),
					tools: [...frame.tools.values()].map((tool) =>
						this.toAgentTool(tool, request, contextMessageIdentities),
					),
				};
			},
		};
	}

	private async consumeQueuedInputs(
		inputs: readonly QueuedSessionInput[],
		request: TurnEngineRequest,
		contextMessageIdentities: WeakMap<object, RuntimeMessageEnvelope>,
	): Promise<AgentMessage[]> {
		const context = inputs.flatMap((input) => input.context ?? []);
		if (context.length > 0) await request.appendQueuedContext?.(context);
		return inputs.flatMap((input) => {
			const contextMessages = (input.context ?? []).map((record) => {
				const message = contextRecordToUserMessage(record);
				contextMessageIdentities.set(message, {
					kind: "context",
					record,
					timestamp: message.timestamp,
				});
				return message;
			});
			return [...contextMessages, ...(input.message ? [input.message] : [])];
		});
	}

	private toAgentTool(
		tool: RuntimeToolDefinition,
		request: TurnEngineRequest,
		contextMessageIdentities: WeakMap<object, RuntimeMessageEnvelope>,
	): AgentTool<ReturnType<typeof Type.Unsafe<Record<string, unknown>>>, unknown> {
		return {
			name: tool.name,
			label: tool.label,
			description: tool.description,
			parameters: Type.Unsafe<Record<string, unknown>>({ ...tool.inputSchema }),
			async execute(toolCallId, input, signal, onUpdate, context) {
				const executionSignal = signal ?? request.signal;
				executionSignal.throwIfAborted();
				const authorized = await request.snapshot.toolPolicy.authorize(
					{
						sessionId: request.sessionId,
						turnId: request.turnId,
						toolName: tool.name,
						input,
					},
					executionSignal,
				);
				if (!authorized) {
					throw new Error(`Tool execution denied by policy: ${tool.name}`);
				}

				try {
					const result = await tool.execute({
						sessionId: request.sessionId,
						turnId: request.turnId,
						toolCallId,
						input,
						messages: context?.messages
							? toRuntimeMessages(context.messages, contextMessageIdentities)
							: undefined,
						signal: executionSignal,
						onUpdate: onUpdate
							? (update) => {
									onUpdate(toAgentToolResult(update));
								}
							: undefined,
						reportPhase: context?.phase,
					});
					return toAgentToolResult(result);
				} catch (error) {
					if (error instanceof RuntimeToolExecutionError) {
						throw new AgentToolExecutionError(error.message, error.details, { cause: error });
					}
					throw error;
				}
			},
		};
	}
}

function resolveRequestSystemPrompt(request: TurnEngineRequest, frame: Pick<RuntimeSnapshot, "instructions">): string {
	return composeModelCallSystemPrompt({
		instructions: request.instructionOverride ?? frame.instructions,
	});
}

function toAgentCheckpointResult(
	result: TurnEngineContextCheckpointResult | undefined,
	contextMessageIdentities: WeakMap<object, RuntimeMessageEnvelope>,
): AgentContextCheckpointResult | undefined {
	if (!result) return undefined;
	return {
		messages: result.messages,
		contextMessages: result.contextMessageEnvelopes
			? hydrateAgentMessages(result.contextMessageEnvelopes, contextMessageIdentities)
			: result.contextMessages,
		retry: result.retry,
	};
}

function mapAgentCoreEventToExecutionObservation(
	event: AgentEvent,
	initialMessages: readonly RuntimeMessageEnvelope[],
	contextMessageIdentities: WeakMap<object, RuntimeMessageEnvelope>,
): RuntimeExecutionObservationEvent | undefined {
	if (event.type === "agent_start") return { type: "agent.start" };
	if (event.type === "agent_end") {
		return {
			type: "agent.end",
			messages: [
				...initialMessages,
				...event.messages.flatMap((message) => {
					const envelope = toRuntimeMessageEnvelope(message, contextMessageIdentities);
					return envelope ? [envelope] : [];
				}),
			],
		};
	}
	if (event.type === "turn_start") return { type: "turn.start" };
	if (event.type === "turn_end") {
		if (!isRuntimeMessage(event.message)) return undefined;
		return {
			type: "turn.end",
			message: event.message,
			toolResults: [...event.toolResults],
		};
	}
	if (event.type === "message_start") {
		const message = toRuntimeMessageEnvelope(event.message, contextMessageIdentities);
		return message ? { type: "message.start", message } : undefined;
	}
	if (event.type === "message_update") {
		const message = toRuntimeMessageEnvelope(event.message, contextMessageIdentities);
		if (!message) return undefined;
		return {
			type: "message.update",
			message,
			assistantMessageEvent: event.assistantMessageEvent,
		};
	}
	if (event.type === "message_end") {
		const message = toRuntimeMessageEnvelope(event.message, contextMessageIdentities);
		return message ? { type: "message.end", message } : undefined;
	}
	if (event.type === "tool_execution_start") {
		return {
			type: "tool.execution.start",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
			startedAt: event.startedAt,
		};
	}
	if (event.type === "tool_execution_update") {
		return {
			type: "tool.execution.update",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
			partialResult: event.partialResult,
		};
	}
	if (event.type === "tool_execution_phase") {
		return {
			type: "tool.execution.phase",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			label: event.label,
			atMs: event.atMs,
		};
	}
	if (event.type === "tool_execution_end") {
		return {
			type: "tool.execution.end",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			result: event.result,
			isError: event.isError,
			startedAt: event.startedAt,
			durationMs: event.durationMs,
			phases: [...event.phases],
		};
	}
	return undefined;
}

function mapAgentCoreEventToObservation(event: AgentEvent): RuntimeSessionObservationEvent | undefined {
	if (
		event.type === "agent_start" ||
		event.type === "agent_end" ||
		event.type === "turn_start" ||
		event.type === "turn_end"
	) {
		return { type: "lifecycle", phase: event.type, source: "runtime-core" };
	}
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		return { type: "message.delta", delta: event.assistantMessageEvent.delta, source: "agent" };
	}
	if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
		return { type: "thinking.delta", delta: event.assistantMessageEvent.delta, source: "agent" };
	}
	if (event.type === "message_update" && event.assistantMessageEvent.type === "toolcall_start") {
		const toolCall = event.assistantMessageEvent.partial.content[event.assistantMessageEvent.contentIndex];
		if (toolCall?.type !== "toolCall") return undefined;
		return {
			type: "toolcall.start",
			toolCallId: String(toolCall.id ?? ""),
			toolName: String(toolCall.name ?? ""),
			source: "agent",
		};
	}
	if (event.type === "tool_execution_start") {
		return {
			type: "tool.start",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
			startedAt: event.startedAt,
			source: "tool",
		};
	}
	if (event.type === "tool_execution_update") {
		return {
			type: "tool.update",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			partialResult: event.partialResult,
			source: "tool",
		};
	}
	if (event.type === "tool_execution_phase") {
		return {
			type: "tool.phase",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			label: event.label,
			atMs: event.atMs,
			source: "tool",
		};
	}
	if (event.type === "tool_execution_end") {
		return {
			type: "tool.end",
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			isError: event.isError,
			result: event.result,
			startedAt: event.startedAt,
			durationMs: event.durationMs,
			phases: event.phases,
			source: "tool",
		};
	}
	return undefined;
}

function contextRecordToUserMessage(record: SessionContextRecord): Message {
	return {
		role: "user",
		content: record.content,
		timestamp: record.timestamp ?? Date.now(),
	};
}

function toRuntimeMessages(
	messages: readonly AgentMessage[],
	contextMessageIdentities: WeakMap<object, RuntimeMessageEnvelope>,
): Message[] {
	return messages.flatMap((message) => {
		const identity = contextMessageIdentities.get(message);
		if (identity) return envelopeToRuntimeMessages(identity);
		return isRuntimeMessage(message) ? [message] : [];
	});
}

function toRuntimeMessageEnvelopes(
	messages: readonly AgentMessage[],
	contextMessageIdentities: WeakMap<object, RuntimeMessageEnvelope>,
): RuntimeMessageEnvelope[] {
	return messages.flatMap((message) => {
		const identity = contextMessageIdentities.get(message);
		if (identity) return [identity];
		return isRuntimeMessage(message) ? [{ kind: "message", message }] : [];
	});
}

function toRuntimeMessageEnvelope(
	message: AgentMessage,
	contextMessageIdentities: WeakMap<object, RuntimeMessageEnvelope>,
): RuntimeMessageEnvelope | undefined {
	const identity = contextMessageIdentities.get(message);
	if (identity) return identity;
	return isRuntimeMessage(message) ? { kind: "message", message } : undefined;
}

function hydrateAgentMessages(
	envelopes: readonly RuntimeMessageEnvelope[],
	contextMessageIdentities: WeakMap<object, RuntimeMessageEnvelope>,
): AgentMessage[] {
	return envelopes.map((envelope) => {
		const message = envelopeToAgentPlaceholder(envelope);
		if (envelope.kind !== "message") contextMessageIdentities.set(message, envelope);
		return message;
	});
}

function envelopeToAgentPlaceholder(envelope: RuntimeMessageEnvelope): AgentMessage {
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

function isRuntimeMessage(message: AgentMessage): message is Message {
	return (
		"role" in message && (message.role === "user" || message.role === "assistant" || message.role === "toolResult")
	);
}

function toAgentToolResult(result: RuntimeToolResult): {
	readonly content: [...RuntimeToolResult["content"]];
	readonly details: unknown;
} {
	return {
		content: [...result.content],
		details: result.details,
	};
}
