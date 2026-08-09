import type OpenAI from "openai";
import type { ResponseCreateParamsStreaming, ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { calculateCost } from "../../models.js";
import { AIStreamProtocolError } from "../../protocol/index.js";
import { EmptyProviderStreamError } from "../../provider-kit/index.js";
import type { LanguageModelStreamEvent } from "../../runtime/language-model-adapter.js";
import type {
	Api,
	AssistantMessage,
	Model,
	StopReason,
	TextContent,
	ThinkingContent,
	ToolCall,
	Usage,
} from "../../types.js";
import { parseStreamingJson } from "../../utils/json-parse.js";
import { validateResponsesStreamEvent } from "./response-schema.js";

export interface OpenAIResponsesStreamOptions {
	serviceTier?: ResponseCreateParamsStreaming["service_tier"];
	applyServiceTierPricing?: (
		usage: Usage,
		serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
	) => void;
}

export interface ResponsesEventSink {
	push(event: LanguageModelStreamEvent): void;
}

interface ReasoningItemState {
	readonly kind: "reasoning";
	readonly blockIndex: number;
}

interface MessageItemState {
	readonly kind: "message";
	readonly blockIndex: number;
}

interface ToolItemState {
	readonly kind: "function_call";
	readonly blockIndex: number;
	partialJson: string;
}

type ItemState = ReasoningItemState | MessageItemState | ToolItemState;

export async function processResponsesStream<TApi extends Api>(
	openaiStream: AsyncIterable<unknown>,
	output: AssistantMessage,
	stream: ResponsesEventSink,
	model: Model<TApi>,
	options?: OpenAIResponsesStreamOptions,
): Promise<void> {
	const itemStates = new Map<number, ItemState>();
	let currentOutputIndex: number | undefined;
	let fallbackOutputIndex = 0;
	let receivedProviderEvent = false;
	let receivedTerminalEvent = false;

	for await (const value of openaiStream) {
		if (receivedTerminalEvent) throw protocolError(model, "Provider emitted an event after its terminal response");
		receivedProviderEvent = true;
		const event = validateResponsesStreamEvent(value, model.provider);

		if (event.type === "response.output_item.added") {
			const outputIndex = readOutputIndex(event, fallbackOutputIndex++);
			currentOutputIndex = outputIndex;
			const item = event.item;
			if (item.type === "reasoning") {
				const block: ThinkingContent = { type: "thinking", thinking: "" };
				output.content.push(block);
				itemStates.set(outputIndex, { kind: "reasoning", blockIndex: output.content.length - 1 });
				stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
			} else if (item.type === "message") {
				const block: TextContent = { type: "text", text: "" };
				output.content.push(block);
				itemStates.set(outputIndex, { kind: "message", blockIndex: output.content.length - 1 });
				stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
			} else if (item.type === "function_call") {
				const block: ToolCall = {
					type: "toolCall",
					id: `${item.call_id}|${item.id}`,
					name: item.name,
					arguments: parseStreamingJson(item.arguments || ""),
				};
				output.content.push(block);
				itemStates.set(outputIndex, {
					kind: "function_call",
					blockIndex: output.content.length - 1,
					partialJson: item.arguments || "",
				});
				stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
			}
		} else if (event.type === "response.reasoning_summary_text.delta") {
			const state = requireState(itemStates, event, currentOutputIndex, "reasoning", model);
			const block = output.content[state.blockIndex];
			if (block?.type !== "thinking") throw protocolError(model, "Reasoning block state is inconsistent");
			block.thinking += event.delta;
			stream.push({
				type: "thinking_delta",
				contentIndex: state.blockIndex,
				delta: event.delta,
				partial: output,
			});
		} else if (event.type === "response.reasoning_summary_part.done") {
			const state = requireState(itemStates, event, currentOutputIndex, "reasoning", model);
			const block = output.content[state.blockIndex];
			if (block?.type !== "thinking") throw protocolError(model, "Reasoning block state is inconsistent");
			block.thinking += "\n\n";
			stream.push({
				type: "thinking_delta",
				contentIndex: state.blockIndex,
				delta: "\n\n",
				partial: output,
			});
		} else if (event.type === "response.content_part.added") {
			requireState(itemStates, event, currentOutputIndex, "message", model);
		} else if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
			const state = requireState(itemStates, event, currentOutputIndex, "message", model);
			const block = output.content[state.blockIndex];
			if (block?.type !== "text") throw protocolError(model, "Text block state is inconsistent");
			block.text += event.delta;
			stream.push({ type: "text_delta", contentIndex: state.blockIndex, delta: event.delta, partial: output });
		} else if (event.type === "response.function_call_arguments.delta") {
			const state = requireState(itemStates, event, currentOutputIndex, "function_call", model);
			state.partialJson += event.delta;
			const block = output.content[state.blockIndex];
			if (block?.type !== "toolCall") throw protocolError(model, "Tool call block state is inconsistent");
			block.arguments = parseStreamingJson(state.partialJson);
			stream.push({
				type: "toolcall_delta",
				contentIndex: state.blockIndex,
				delta: event.delta,
				partial: output,
			});
		} else if (event.type === "response.function_call_arguments.done") {
			const state = requireState(itemStates, event, currentOutputIndex, "function_call", model);
			state.partialJson = event.arguments;
			const block = output.content[state.blockIndex];
			if (block?.type !== "toolCall") throw protocolError(model, "Tool call block state is inconsistent");
			block.arguments = parseStreamingJson(event.arguments);
		} else if (event.type === "response.output_item.done") {
			const outputIndex = resolveOutputIndex(event, currentOutputIndex, model);
			const state = itemStates.get(outputIndex);
			if (!state) throw protocolError(model, "Output item completed before it was added", { outputIndex });
			finalizeOutputItem(event, state, output, stream, model);
			itemStates.delete(outputIndex);
		} else if (event.type === "response.completed" || event.type === "response.incomplete") {
			if (itemStates.size > 0) {
				throw protocolError(model, "Response completed with unfinished output items", {
					outputIndexes: [...itemStates.keys()],
				});
			}
			applyCompletedResponse(event.response, output, model, options);
			receivedTerminalEvent = true;
		} else if (event.type === "error") {
			throw new Error(`Error Code ${event.code ?? "unknown"}: ${event.message}`);
		} else if (event.type === "response.failed") {
			const providerMessage = event.response.error?.message;
			throw new Error(providerMessage || "OpenAI Responses request failed");
		}
	}

	if (!receivedProviderEvent) throw new EmptyProviderStreamError();
	if (!receivedTerminalEvent) throw protocolError(model, "Stream ended without a terminal response event");
}

function finalizeOutputItem<TApi extends Api>(
	event: Extract<ResponseStreamEvent, { type: "response.output_item.done" }>,
	state: ItemState,
	output: AssistantMessage,
	stream: ResponsesEventSink,
	model: Model<TApi>,
): void {
	const item = event.item;
	if (item.type === "reasoning" && state.kind === "reasoning") {
		const block = output.content[state.blockIndex];
		if (block?.type !== "thinking") throw protocolError(model, "Reasoning block state is inconsistent");
		block.thinking = item.summary?.map((summary) => summary.text).join("\n\n") || block.thinking;
		block.thinkingSignature = JSON.stringify(item);
		stream.push({ type: "thinking_end", contentIndex: state.blockIndex, content: block.thinking, partial: output });
		return;
	}
	if (item.type === "message" && state.kind === "message") {
		const block = output.content[state.blockIndex];
		if (block?.type !== "text") throw protocolError(model, "Text block state is inconsistent");
		block.text = item.content
			.map((content) =>
				content.type === "output_text" ? content.text : content.type === "refusal" ? content.refusal : "",
			)
			.join("");
		block.textSignature = item.id;
		stream.push({ type: "text_end", contentIndex: state.blockIndex, content: block.text, partial: output });
		return;
	}
	if (item.type === "function_call" && state.kind === "function_call") {
		const toolCall: ToolCall = {
			type: "toolCall",
			id: `${item.call_id}|${item.id}`,
			name: item.name,
			arguments: parseStreamingJson(state.partialJson || item.arguments || "{}"),
		};
		output.content[state.blockIndex] = toolCall;
		stream.push({ type: "toolcall_end", contentIndex: state.blockIndex, toolCall, partial: output });
		return;
	}
	throw protocolError(model, "Output item type changed while streaming", {
		expected: state.kind,
		actual: item.type,
	});
}

function applyCompletedResponse<TApi extends Api>(
	response: Extract<ResponseStreamEvent, { type: "response.completed" | "response.incomplete" }>["response"],
	output: AssistantMessage,
	model: Model<TApi>,
	options?: OpenAIResponsesStreamOptions,
): void {
	if (response.usage) {
		const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
		output.usage = {
			input: (response.usage.input_tokens || 0) - cachedTokens,
			output: response.usage.output_tokens || 0,
			cacheRead: cachedTokens,
			cacheWrite: 0,
			totalTokens: response.usage.total_tokens || 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		};
	}
	calculateCost(model, output.usage);
	options?.applyServiceTierPricing?.(output.usage, response.service_tier ?? options.serviceTier);
	output.stopReason = mapStopReason(response.status);
	if (output.content.some((block) => block.type === "toolCall") && output.stopReason === "stop") {
		output.stopReason = "toolUse";
	}
}

function requireState<TState extends ItemState["kind"], TApi extends Api>(
	itemStates: ReadonlyMap<number, ItemState>,
	event: { readonly output_index?: number; readonly type: string },
	currentOutputIndex: number | undefined,
	kind: TState,
	model: Model<TApi>,
): Extract<ItemState, { kind: TState }> {
	const outputIndex = resolveOutputIndex(event, currentOutputIndex, model);
	const state = itemStates.get(outputIndex);
	if (!state) throw protocolError(model, `${event.type} arrived before response.output_item.added`, { outputIndex });
	if (state.kind !== kind) {
		throw protocolError(model, `${event.type} targeted the wrong output item`, {
			outputIndex,
			expected: kind,
			actual: state.kind,
		});
	}
	return state as Extract<ItemState, { kind: TState }>;
}

function readOutputIndex(event: { readonly output_index?: number }, fallback: number): number {
	return typeof event.output_index === "number" ? event.output_index : fallback;
}

function resolveOutputIndex<TApi extends Api>(
	event: { readonly output_index?: number; readonly type: string },
	currentOutputIndex: number | undefined,
	model: Model<TApi>,
): number {
	if (typeof event.output_index === "number") return event.output_index;
	if (currentOutputIndex !== undefined) return currentOutputIndex;
	throw protocolError(model, `${event.type} did not identify an output item`);
}

function protocolError<TApi extends Api>(
	model: Model<TApi>,
	message: string,
	metadata?: Readonly<Record<string, unknown>>,
): AIStreamProtocolError {
	return new AIStreamProtocolError(message, {
		provider: model.provider,
		modelId: model.id,
		metadata,
	});
}

function mapStopReason(status: OpenAI.Responses.ResponseStatus | undefined): StopReason {
	if (!status) return "stop";
	switch (status) {
		case "completed":
		case "in_progress":
		case "queued":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		default: {
			const exhaustive: never = status;
			throw new Error(`Unhandled stop reason: ${exhaustive}`);
		}
	}
}
