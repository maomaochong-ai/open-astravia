import { type AssistantMessage, type Context, type EventStream, streamSimple } from "@vetta/ai";
import type { RuntimeObservation, RuntimeObservationUpdate } from "@vetta/runtime-telemetry";
import { salvageTextToolCalls } from "../salvage-text-tool-calls.js";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, StreamFn } from "../types.js";
import { requestContextCheckpoint } from "./context-checkpoint.js";
import type { DEFAULT_AGENT_LOOP_LIMITS } from "./limits.js";
import {
	assistantTelemetryUpdate,
	generationInput,
	getErrorMessage,
	telemetryModelParameters,
	traceAttributes,
} from "./telemetry.js";

export async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
	traceParent?: RuntimeObservation,
	limits?: typeof DEFAULT_AGENT_LOOP_LIMITS,
): Promise<AssistantMessage> {
	if (config.resolveCallContext) {
		signal?.throwIfAborted();
		const resolved = await config.resolveCallContext(
			{ systemPrompt: context.systemPrompt, messages: context.messages, tools: context.tools },
			signal,
		);
		context.systemPrompt = resolved.systemPrompt;
		context.tools = resolved.tools ? [...resolved.tools] : undefined;
	}

	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	if (config.contextCheckpoints) {
		if (!limits) throw new Error("Agent loop limits are required for context checkpoints");
		const prepared = await requestContextCheckpoint("model_call", messages, 0, stream, {
			signal,
			timeoutMs: limits.contextCheckpointTimeoutMs,
		});
		if (prepared) {
			messages = [...prepared.messages];
			if (prepared.contextMessages) context.messages = [...prepared.contextMessages];
		}
	}

	const llmMessages = await config.convertToLlm(messages);
	const llmContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: llmMessages,
		tools: context.tools,
	};

	const streamFunction = streamFn || streamSimple;
	await config.modelCallLifecycle?.prepared(llmContext, signal);
	let failureReported = false;
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
		if (generationEnded) return;
		generationEnded = true;
		generationObservation?.end(update);
	};

	try {
		const resolvedApiKey =
			(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;
		const response = await streamFunction(config.model, llmContext, { ...config, apiKey: resolvedApiKey, signal });

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
						stream.push({ type: "message_update", assistantMessageEvent: event, message: { ...partialMessage } });
					}
					break;
				case "done":
				case "error": {
					const finalMessage = await response.result();
					if (event.type === "done" && config.salvageTextToolCalls?.length) {
						salvageTextToolCalls(finalMessage, llmContext.tools, config.salvageTextToolCalls);
					}
					if (addedPartial) context.messages[context.messages.length - 1] = finalMessage;
					else context.messages.push(finalMessage);
					if (!addedPartial) stream.push({ type: "message_start", message: { ...finalMessage } });
					stream.push({ type: "message_end", message: finalMessage });
					failureReported = await reportModelCallTerminal(config, llmContext, finalMessage, signal);
					endGeneration(assistantTelemetryUpdate(finalMessage, config.tracing?.captureContent === true));
					return finalMessage;
				}
			}
		}

		const finalMessage = await response.result();
		failureReported = await reportModelCallTerminal(config, llmContext, finalMessage, signal);
		endGeneration(assistantTelemetryUpdate(finalMessage, config.tracing?.captureContent === true));
		return finalMessage;
	} catch (error) {
		if (!failureReported) await config.modelCallLifecycle?.failed(llmContext, error, signal);
		endGeneration({ level: "ERROR", statusMessage: getErrorMessage(error) });
		throw error;
	}
}

async function reportModelCallTerminal(
	config: AgentLoopConfig,
	context: Readonly<Context>,
	message: Readonly<AssistantMessage>,
	signal: AbortSignal | undefined,
): Promise<boolean> {
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		await config.modelCallLifecycle?.failed(context, message, signal);
		return true;
	}
	await config.modelCallLifecycle?.completed(context, message, signal);
	return false;
}
