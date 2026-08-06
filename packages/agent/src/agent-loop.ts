/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import {
	type AssistantMessage,
	type Context,
	EventStream,
	streamSimple,
	type Tool,
	type ToolResultMessage,
	validateToolArguments,
} from "@vetta/ai";
import type { RuntimeObservation, RuntimeObservationUpdate } from "@vetta/runtime-telemetry";
import { salvageTextToolCalls } from "./salvage-text-tool-calls.js";
import { AgentToolExecutionError } from "./tool-execution-error.js";
import type {
	AgentContext,
	AgentContextCheckpointReason,
	AgentContextCheckpointResult,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolResult,
	StreamFn,
} from "./types.js";

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	const stream = createAgentStream();

	(async () => {
		const newMessages: AgentMessage[] = [...prompts];
		const currentContext: AgentContext = {
			...context,
			messages: [...context.messages, ...prompts],
		};

		stream.push({ type: "agent_start" });
		stream.push({ type: "turn_start" });
		for (const prompt of prompts) {
			stream.push({ type: "message_start", message: prompt });
			stream.push({ type: "message_end", message: prompt });
		}

		await runLoop(currentContext, newMessages, config, signal, stream, streamFn);
	})();

	return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const stream = createAgentStream();

	(async () => {
		const newMessages: AgentMessage[] = [];
		const currentContext: AgentContext = { ...context };

		stream.push({ type: "agent_start" });
		stream.push({ type: "turn_start" });

		await runLoop(currentContext, newMessages, config, signal, stream, streamFn);
	})();

	return stream;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
	currentContext: AgentContext,
	newMessages: AgentMessage[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
): Promise<void> {
	const traceChildren = config.tracing?.detail !== "agent";
	const captureTraceContent = config.tracing?.captureContent === true;
	const agentObservation = config.tracer?.startObservation(
		"agent.run",
		{
			...traceAttributes(config.tracing),
			input: agentRunInput(currentContext, newMessages, config, captureTraceContent),
			metadata: {
				...config.tracing?.metadata,
				model: config.model.id,
				provider: config.model.provider,
				api: config.model.api,
				initialMessageCount: currentContext.messages.length,
				toolCount: currentContext.tools?.length ?? 0,
			},
		},
		{ type: "agent" },
	);
	let firstTurn = true;
	let recoveryAttempt = 0;
	// Check for steering messages at start (user may have typed while waiting)
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

	try {
		// Outer loop: continues when queued follow-up messages arrive after agent would stop
		while (true) {
			let hasMoreToolCalls = true;
			let steeringAfterTools: AgentMessage[] | null = null;

			// Inner loop: process tool calls and steering messages
			while (hasMoreToolCalls || pendingMessages.length > 0) {
				if (!firstTurn) {
					stream.push({ type: "turn_start" });
				} else {
					firstTurn = false;
				}

				// 每轮重新取工具集/系统提示词：本轮内的改动（如 tool_search 激活 MCP 工具）
				// 必须马上对下一次请求生效，而不是等下一次 run。
				if (config.getTools) currentContext.tools = config.getTools();
				if (config.getSystemPrompt) currentContext.systemPrompt = config.getSystemPrompt();

				// Process pending messages (inject before next assistant response)
				if (pendingMessages.length > 0) {
					for (const message of pendingMessages) {
						stream.push({ type: "message_start", message });
						stream.push({ type: "message_end", message });
						currentContext.messages.push(message);
						newMessages.push(message);
					}
					pendingMessages = [];
				}

				// Stream assistant response
				const message = await streamAssistantResponse(
					currentContext,
					config,
					signal,
					stream,
					streamFn,
					traceChildren ? agentObservation : undefined,
				);
				newMessages.push(message);

				// User-initiated abort always halts immediately, no recovery.
				if (message.stopReason === "aborted") {
					stream.push({ type: "turn_end", message, toolResults: [] });
					stream.push({ type: "agent_end", messages: newMessages });
					stream.end(newMessages);
					return;
				}

				if (message.stopReason === "error") {
					stream.push({ type: "turn_end", message, toolResults: [] });
					if (config.contextCheckpoints) {
						const recovery = await requestContextCheckpoint(
							"assistant_error",
							currentContext.messages,
							recoveryAttempt,
							stream,
							message,
						);
						if (recovery?.retry) {
							recoveryAttempt += 1;
							currentContext.messages = [...(recovery.contextMessages ?? recovery.messages)];
							pendingMessages = (await config.getSteeringMessages?.()) || [];
							continue;
						}
					}
					stream.push({ type: "agent_end", messages: newMessages });
					stream.end(newMessages);
					return;
				}

				// Check for tool calls
				const toolCalls = message.content.filter((c) => c.type === "toolCall");
				hasMoreToolCalls = toolCalls.length > 0;

				const toolResults: ToolResultMessage[] = [];
				if (hasMoreToolCalls) {
					const toolExecution = await executeToolCalls(
						currentContext.tools,
						currentContext.messages,
						message,
						signal,
						stream,
						config.getSteeringMessages,
						traceChildren ? agentObservation : undefined,
						config.tracing,
					);
					toolResults.push(...toolExecution.toolResults);
					steeringAfterTools = toolExecution.steeringMessages ?? null;

					for (const result of toolResults) {
						currentContext.messages.push(result);
						newMessages.push(result);
					}
				}

				stream.push({ type: "turn_end", message, toolResults });

				if (signal?.aborted) {
					stream.push({ type: "agent_end", messages: newMessages });
					stream.end(newMessages);
					return;
				}

				if (!hasMoreToolCalls && config.contextCheckpoints) {
					const result = await requestContextCheckpoint(
						"assistant_result",
						currentContext.messages,
						recoveryAttempt,
						stream,
						message,
					);
					if (result?.contextMessages) {
						currentContext.messages = [...result.contextMessages];
					}
					if (result?.retry) {
						recoveryAttempt += 1;
						currentContext.messages = [...(result.contextMessages ?? result.messages)];
						pendingMessages = (await config.getSteeringMessages?.()) || [];
						hasMoreToolCalls = true;
						continue;
					}
				}

				// Get steering messages after turn completes
				if (steeringAfterTools && steeringAfterTools.length > 0) {
					pendingMessages = steeringAfterTools;
					steeringAfterTools = null;
				} else {
					pendingMessages = (await config.getSteeringMessages?.()) || [];
				}
			}

			// The agent reached a natural stopping point. Check whether queued
			// follow-ups or an automatic continuation policy require another turn.
			const continuationMessages =
				(await config.getContinuationMessages?.([...currentContext.messages], signal)) || [];
			if (continuationMessages.length > 0) {
				// Set as pending so inner loop processes them
				pendingMessages = continuationMessages;
				continue;
			}

			// No more messages, exit
			break;
		}

		stream.push({ type: "agent_end", messages: newMessages });
		stream.end(newMessages);
	} catch (error) {
		agentObservation?.update({
			level: "ERROR",
			statusMessage: getErrorMessage(error),
		});
		if (error instanceof AgentContextCheckpointFailure) {
			stream.push({ type: "agent_end", messages: newMessages });
			stream.end(newMessages);
			return;
		}
		throw error;
	} finally {
		const usageDetails = aggregateUsage(newMessages);
		const costDetails = aggregateCost(newMessages);
		agentObservation?.end({
			output: agentRunOutput(newMessages, captureTraceContent),
			usageDetails,
			costDetails,
			metadata: {
				messageCount: newMessages.length,
				assistantMessageCount: newMessages.filter((message) => message.role === "assistant").length,
				toolResultCount: newMessages.filter((message) => message.role === "toolResult").length,
				toolCallCount: countToolCalls(newMessages),
			},
		});
		config.tracer?.flush?.().catch(() => undefined);
	}
}

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
	traceParent?: RuntimeObservation,
): Promise<AssistantMessage> {
	if (config.resolveCallContext) {
		signal?.throwIfAborted();
		const resolved = await config.resolveCallContext(
			{
				systemPrompt: context.systemPrompt,
				messages: context.messages,
				tools: context.tools,
			},
			signal,
		);
		context.systemPrompt = resolved.systemPrompt;
		context.tools = resolved.tools ? [...resolved.tools] : undefined;
	}

	// Apply context transform if configured (AgentMessage[] → AgentMessage[])
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	if (config.contextCheckpoints) {
		const prepared = await requestContextCheckpoint("model_call", messages, 0, stream);
		if (prepared) {
			messages = [...prepared.messages];
			if (prepared.contextMessages) {
				context.messages = [...prepared.contextMessages];
			}
		}
	}

	// Convert to LLM-compatible messages (AgentMessage[] → Message[])
	const llmMessages = await config.convertToLlm(messages);

	// Build LLM context
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: llmMessages,
		tools: context.tools,
	};

	const streamFunction = streamFn || streamSimple;
	const generationObservation = traceParent?.startObservation(
		`llm.${config.model.provider}.${config.model.id}`,
		{
			...traceAttributes(config.tracing),
			input: generationInput(llmContext, messages, config.tracing?.captureContent === true),
			model: config.model.id,
			modelParameters: telemetryModelParameters(config),
			metadata: {
				api: config.model.api,
				provider: config.model.provider,
				messageCount: llmMessages.length,
				toolCount: context.tools?.length ?? 0,
			},
		},
		{ type: "generation" },
	);
	let generationEnded = false;
	const endGeneration = (update: RuntimeObservationUpdate) => {
		if (generationEnded) {
			return;
		}
		generationEnded = true;
		generationObservation?.end(update);
	};

	try {
		// Resolve API key (important for expiring tokens)
		const resolvedApiKey =
			(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

		const response = await streamFunction(config.model, llmContext, {
			...config,
			apiKey: resolvedApiKey,
			signal,
		});

		let partialMessage: AssistantMessage | null = null;
		let addedPartial = false;

		for await (const event of response) {
			switch (event.type) {
				case "start":
					partialMessage = event.partial;
					context.messages.push(partialMessage);
					addedPartial = true;
					stream.push({ type: "message_start", message: { ...partialMessage } });
					break;

				case "text_start":
				case "text_delta":
				case "text_end":
				case "thinking_start":
				case "thinking_delta":
				case "thinking_end":
				case "toolcall_start":
				case "toolcall_delta":
				case "toolcall_end":
					if (partialMessage) {
						partialMessage = event.partial;
						context.messages[context.messages.length - 1] = partialMessage;
						stream.push({
							type: "message_update",
							assistantMessageEvent: event,
							message: { ...partialMessage },
						});
					}
					break;

				case "done":
				case "error": {
					const finalMessage = await response.result();
					if (event.type === "done" && config.salvageTextToolCalls?.length) {
						salvageTextToolCalls(finalMessage, llmContext.tools, config.salvageTextToolCalls);
					}
					if (addedPartial) {
						context.messages[context.messages.length - 1] = finalMessage;
					} else {
						context.messages.push(finalMessage);
					}
					if (!addedPartial) {
						stream.push({ type: "message_start", message: { ...finalMessage } });
					}
					stream.push({ type: "message_end", message: finalMessage });
					endGeneration(assistantTelemetryUpdate(finalMessage, config.tracing?.captureContent === true));
					return finalMessage;
				}
			}
		}

		const finalMessage = await response.result();
		endGeneration(assistantTelemetryUpdate(finalMessage, config.tracing?.captureContent === true));
		return finalMessage;
	} catch (error) {
		endGeneration({
			level: "ERROR",
			statusMessage: getErrorMessage(error),
		});
		throw error;
	}
}

class AgentContextCheckpointFailure extends Error {
	constructor(cause: unknown) {
		super("Agent context checkpoint failed", { cause });
		this.name = "AgentContextCheckpointFailure";
	}
}

function requestContextCheckpoint(
	reason: AgentContextCheckpointReason,
	messages: readonly AgentMessage[],
	recoveryAttempt: number,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	assistantMessage?: AssistantMessage,
): Promise<AgentContextCheckpointResult | undefined> {
	return new Promise((resolve, reject) => {
		let settled = false;
		stream.push({
			type: "context_checkpoint",
			request: {
				reason,
				messages: [...messages],
				assistantMessage,
				recoveryAttempt,
				complete(result) {
					if (settled) return;
					settled = true;
					resolve(result);
				},
				fail(error) {
					if (settled) return;
					settled = true;
					reject(new AgentContextCheckpointFailure(error));
				},
			},
		});
	});
}

/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(
	tools: AgentTool<any>[] | undefined,
	messages: readonly AgentMessage[],
	assistantMessage: AssistantMessage,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	getSteeringMessages?: AgentLoopConfig["getSteeringMessages"],
	traceParent?: RuntimeObservation,
	tracing?: AgentLoopConfig["tracing"],
): Promise<{ toolResults: ToolResultMessage[]; steeringMessages?: AgentMessage[] }> {
	const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
	const results: ToolResultMessage[] = [];
	let steeringMessages: AgentMessage[] | undefined;

	for (let index = 0; index < toolCalls.length; index++) {
		const toolCall = toolCalls[index];
		const tool = tools?.find((t) => t.name === toolCall.name);

		const startedAt = Date.now();
		const phases: import("./types.js").ToolPhase[] = [];
		const toolObservation = traceParent?.startObservation(
			`tool.${toolCall.name}`,
			{
				...traceAttributes(tracing),
				input: toolCallInput(tool, toolCall, tracing?.captureContent === true),
				metadata: {
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					argumentKeys: objectKeys(toolCall.arguments),
					toolExists: tool !== undefined,
				},
			},
			{ type: "tool" },
		);

		stream.push({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
			startedAt,
		});

		let result: AgentToolResult<any>;
		let isError = false;

		try {
			if (!tool) throw new Error(`Tool ${toolCall.name} not found`);

			const validatedArgs = validateToolArguments(tool, toolCall);

			result = await tool.execute(
				toolCall.id,
				validatedArgs,
				signal,
				(partialResult) => {
					stream.push({
						type: "tool_execution_update",
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						args: toolCall.arguments,
						partialResult,
					});
				},
				{
					phase: (label: string) => {
						const atMs = Date.now() - startedAt;
						phases.push({ label, atMs });
						stream.push({
							type: "tool_execution_phase",
							toolCallId: toolCall.id,
							toolName: toolCall.name,
							label,
							atMs,
						});
					},
					messages: [...messages],
				},
			);
		} catch (e) {
			result = {
				content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
				details: e instanceof AgentToolExecutionError ? e.details : {},
			};
			isError = true;
		}

		stream.push({
			type: "tool_execution_end",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			result,
			isError,
			startedAt,
			durationMs: Date.now() - startedAt,
			phases,
		});
		toolObservation?.end({
			output: tracing?.captureContent ? result : undefined,
			level: isError ? "ERROR" : "DEFAULT",
			statusMessage: isError ? textFromToolResult(result) : undefined,
			metadata: {
				isError,
				durationMs: Date.now() - startedAt,
				phaseCount: phases.length,
				phases,
			},
		});

		const toolResultMessage: ToolResultMessage = {
			role: "toolResult",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			content: result.content,
			details: result.details,
			isError,
			timestamp: Date.now(),
		};

		results.push(toolResultMessage);
		stream.push({ type: "message_start", message: toolResultMessage });
		stream.push({ type: "message_end", message: toolResultMessage });

		// Check for steering messages - skip remaining tools if user interrupted
		if (getSteeringMessages) {
			const steering = await getSteeringMessages();
			if (steering.length > 0) {
				steeringMessages = steering;
				const remainingCalls = toolCalls.slice(index + 1);
				for (const skipped of remainingCalls) {
					results.push(skipToolCall(skipped, stream, traceParent, tracing));
				}
				break;
			}
		}
	}

	return { toolResults: results, steeringMessages };
}

function skipToolCall(
	toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }>,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	traceParent?: RuntimeObservation,
	tracing?: AgentLoopConfig["tracing"],
): ToolResultMessage {
	const result: AgentToolResult<any> = {
		content: [{ type: "text", text: "Skipped due to queued user message." }],
		details: {},
	};

	const startedAt = Date.now();
	const toolObservation = traceParent?.startObservation(
		`tool.${toolCall.name}`,
		{
			...traceAttributes(tracing),
			input: toolCallInput(undefined, toolCall, tracing?.captureContent === true),
			metadata: {
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				skipped: true,
			},
		},
		{ type: "tool" },
	);
	stream.push({
		type: "tool_execution_start",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		args: toolCall.arguments,
		startedAt,
	});
	stream.push({
		type: "tool_execution_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result,
		isError: true,
		startedAt,
		durationMs: 0,
		phases: [],
	});
	toolObservation?.end({
		output: tracing?.captureContent ? result : undefined,
		level: "WARNING",
		statusMessage: "Skipped due to queued user message.",
		metadata: {
			isError: true,
			durationMs: 0,
			skipped: true,
		},
	});

	const toolResultMessage: ToolResultMessage = {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: result.content,
		details: {},
		isError: true,
		timestamp: Date.now(),
	};

	stream.push({ type: "message_start", message: toolResultMessage });
	stream.push({ type: "message_end", message: toolResultMessage });

	return toolResultMessage;
}

function assistantTelemetryUpdate(message: AssistantMessage, captureContent: boolean): RuntimeObservationUpdate {
	const errorMessage =
		"errorMessage" in message && typeof message.errorMessage === "string" ? message.errorMessage : undefined;
	return {
		output: captureContent ? message.content : summarizeMessage(message),
		level: message.stopReason === "error" ? "ERROR" : "DEFAULT",
		statusMessage: errorMessage,
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
			provider: message.provider,
			model: message.model,
			stopReason: message.stopReason,
			content: summarizeMessage(message),
		},
	};
}

function traceAttributes(
	tracing: AgentLoopConfig["tracing"],
): Pick<RuntimeObservationUpdate, "userId" | "sessionId" | "traceName" | "tags" | "version"> {
	return {
		userId: tracing?.userId,
		sessionId: tracing?.sessionId,
		traceName: tracing?.traceName,
		tags: tracing?.tags,
		version: tracing?.version,
	};
}

function agentRunInput(
	context: AgentContext,
	newMessages: AgentMessage[],
	config: AgentLoopConfig,
	captureContent: boolean,
): Record<string, unknown> {
	return {
		triggerMessages: captureContent ? newMessages : summarizeMessages(newMessages),
		messages: captureContent ? context.messages : undefined,
		existingMessageCount: Math.max(context.messages.length - newMessages.length, 0),
		systemPrompt: captureContent ? context.systemPrompt : summarizeText(context.systemPrompt),
		tools: captureContent ? context.tools?.map(serializeTool) : summarizeTools(context.tools),
		model: {
			id: config.model.id,
			provider: config.model.provider,
			api: config.model.api,
		},
	};
}

function agentRunOutput(messages: AgentMessage[], captureContent: boolean): Record<string, unknown> {
	const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
	return {
		messageCount: messages.length,
		assistantMessageCount: messages.filter((message) => message.role === "assistant").length,
		toolResultCount: messages.filter((message) => message.role === "toolResult").length,
		toolCallCount: countToolCalls(messages),
		usageDetails: aggregateUsage(messages),
		costDetails: aggregateCost(messages),
		messages: captureContent ? messages : summarizeMessages(messages),
		finalAssistant: lastAssistant ? (captureContent ? lastAssistant : summarizeMessage(lastAssistant)) : undefined,
	};
}

function generationInput(
	context: Context,
	agentMessages: AgentMessage[],
	captureContent: boolean,
): Record<string, unknown> {
	return {
		systemPrompt: captureContent ? context.systemPrompt : summarizeText(context.systemPrompt),
		messages: captureContent ? context.messages : summarizeMessages(agentMessages),
		tools: captureContent ? context.tools?.map(serializeTool) : summarizeTools(context.tools),
	};
}

function toolCallInput(
	tool: AgentTool | undefined,
	toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }>,
	captureContent: boolean,
): Record<string, unknown> {
	return {
		call: {
			id: toolCall.id,
			name: toolCall.name,
			arguments: captureContent ? toolCall.arguments : { keys: objectKeys(toolCall.arguments) },
		},
		tool: tool ? (captureContent ? serializeTool(tool) : summarizeTool(tool)) : undefined,
	};
}

function serializeTool(tool: Tool): Record<string, unknown> {
	return {
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	};
}

function summarizeTools(tools: Tool[] | undefined): Array<Record<string, unknown>> {
	return tools?.map(summarizeTool) ?? [];
}

function summarizeTool(tool: Tool): Record<string, unknown> {
	return {
		name: tool.name,
		description: summarizeText(tool.description),
		parameterKeys: objectKeys(tool.parameters?.properties),
		required: Array.isArray(tool.parameters?.required) ? tool.parameters.required : [],
	};
}

function summarizeText(value: string | undefined): Record<string, unknown> {
	return {
		present: typeof value === "string" && value.length > 0,
		length: value?.length ?? 0,
	};
}

function telemetryModelParameters(config: AgentLoopConfig): Record<string, string | number> {
	const parameters: Record<string, string | number> = {};
	if (config.reasoning) {
		parameters.reasoning = config.reasoning;
	}
	if (config.transport) {
		parameters.transport = config.transport;
	}
	return parameters;
}

function aggregateUsage(messages: AgentMessage[]): Record<string, number> {
	const usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
	};
	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}
		usage.input += message.usage.input;
		usage.output += message.usage.output;
		usage.cacheRead += message.usage.cacheRead;
		usage.cacheWrite += message.usage.cacheWrite;
		usage.totalTokens += message.usage.totalTokens;
	}
	return usage;
}

function aggregateCost(messages: AgentMessage[]): Record<string, number> {
	const cost = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	};
	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}
		cost.input += message.usage.cost.input;
		cost.output += message.usage.cost.output;
		cost.cacheRead += message.usage.cost.cacheRead;
		cost.cacheWrite += message.usage.cost.cacheWrite;
		cost.total += message.usage.cost.total;
	}
	return cost;
}

function countToolCalls(messages: AgentMessage[]): number {
	let count = 0;
	for (const message of messages) {
		if (message.role !== "assistant") {
			continue;
		}
		count += message.content.filter((block) => block.type === "toolCall").length;
	}
	return count;
}

function summarizeMessages(messages: AgentMessage[]): Array<Record<string, unknown>> {
	return messages.map(summarizeMessage);
}

function summarizeMessage(message: AgentMessage): Record<string, unknown> {
	const summary: Record<string, unknown> = {};
	if ("role" in message) {
		summary.role = message.role;
	}
	if ("content" in message && Array.isArray(message.content)) {
		summary.contentBlocks = message.content.map((block) =>
			typeof block === "object" && block !== null && "type" in block ? block.type : typeof block,
		);
		summary.toolCalls = message.content
			.filter((block): block is Extract<AssistantMessage["content"][number], { type: "toolCall" }> => {
				return typeof block === "object" && block !== null && "type" in block && block.type === "toolCall";
			})
			.map((block) => ({ id: block.id, name: block.name }));
	}
	if ("stopReason" in message) {
		summary.stopReason = message.stopReason;
	}
	if ("isError" in message) {
		summary.isError = message.isError;
	}
	return summary;
}

function objectKeys(value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return [];
	}
	return Object.keys(value);
}

function textFromToolResult(result: AgentToolResult<unknown>): string | undefined {
	const text = result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return text || undefined;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
