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
	readonly outputIndex: number;
	readonly itemId?: string;
}

interface MessageItemState {
	readonly kind: "message";
	readonly blockIndex: number;
	readonly outputIndex: number;
	readonly itemId?: string;
}

interface ToolItemState {
	readonly kind: "function_call";
	readonly blockIndex: number;
	readonly outputIndex: number;
	readonly itemId?: string;
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
	const itemTracker = new ResponsesItemTracker(model);
	let receivedProviderEvent = false;
	let receivedTerminalEvent = false;

	for await (const value of openaiStream) {
		if (receivedTerminalEvent) throw protocolError(model, "Provider emitted an event after its terminal response");
		receivedProviderEvent = true;
		const event = validateResponsesStreamEvent(value, model.provider);

		if (event.type === "response.output_item.added") {
			const item = event.item;
			if (item.type === "reasoning") {
				const block: ThinkingContent = { type: "thinking", thinking: "" };
				output.content.push(block);
				itemTracker.add(event, { kind: "reasoning", blockIndex: output.content.length - 1 });
				stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
			} else if (item.type === "message") {
				const block: TextContent = { type: "text", text: "" };
				output.content.push(block);
				itemTracker.add(event, { kind: "message", blockIndex: output.content.length - 1 });
				stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
			} else if (item.type === "function_call") {
				const block: ToolCall = {
					type: "toolCall",
					id: `${item.call_id}|${item.id}`,
					name: item.name,
					arguments: parseStreamingJson(item.arguments || ""),
				};
				output.content.push(block);
				itemTracker.add(event, {
					kind: "function_call",
					blockIndex: output.content.length - 1,
					partialJson: item.arguments || "",
				});
				stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
			}
		} else if (event.type === "response.reasoning_summary_text.delta") {
			const state = itemTracker.require(event, "reasoning");
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
			const state = itemTracker.require(event, "reasoning");
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
			itemTracker.require(event, "message");
		} else if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
			const state = itemTracker.require(event, "message");
			const block = output.content[state.blockIndex];
			if (block?.type !== "text") throw protocolError(model, "Text block state is inconsistent");
			block.text += event.delta;
			stream.push({ type: "text_delta", contentIndex: state.blockIndex, delta: event.delta, partial: output });
		} else if (event.type === "response.function_call_arguments.delta") {
			const state = itemTracker.require(event, "function_call");
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
			const state = itemTracker.require(event, "function_call");
			state.partialJson = event.arguments;
			const block = output.content[state.blockIndex];
			if (block?.type !== "toolCall") throw protocolError(model, "Tool call block state is inconsistent");
			block.arguments = parseStreamingJson(event.arguments);
		} else if (event.type === "response.output_item.done") {
			const state = itemTracker.take(event);
			finalizeOutputItem(event, state, output, stream, model);
		} else if (event.type === "response.completed" || event.type === "response.incomplete") {
			if (itemTracker.size > 0) {
				throw protocolError(model, "Response completed with unfinished output items", {
					outputIndexes: itemTracker.outputIndexes,
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
		const reportedCachedTokens = response.usage.input_tokens_details?.cached_tokens;
		const cachedTokens = reportedCachedTokens || 0;
		output.usage = {
			input: (response.usage.input_tokens || 0) - cachedTokens,
			output: response.usage.output_tokens || 0,
			cacheRead: cachedTokens,
			cacheWrite: 0,
			totalTokens: response.usage.total_tokens || 0,
			cacheUsageReporting: reportedCachedTokens === undefined ? "unavailable" : "read-only",
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

type PendingItemState =
	| Omit<ReasoningItemState, "outputIndex" | "itemId">
	| Omit<MessageItemState, "outputIndex" | "itemId">
	| Omit<ToolItemState, "outputIndex" | "itemId">;

interface ResponsesItemEvent {
	readonly type: string;
	readonly output_index?: number;
	readonly item_id?: string;
	readonly item?: { readonly id?: string };
}

class ResponsesItemTracker<TApi extends Api> {
	private readonly byOutputIndex = new Map<number, ItemState>();
	private readonly byItemId = new Map<string, ItemState>();
	private nextFallbackOutputIndex = -1;

	constructor(private readonly model: Model<TApi>) {}

	get size(): number {
		return this.byOutputIndex.size;
	}

	get outputIndexes(): readonly number[] {
		return [...this.byOutputIndex.keys()];
	}

	add(event: ResponsesItemEvent, pending: PendingItemState): void {
		const outputIndex = this.allocateOutputIndex(event.output_index);
		const itemId = readItemId(event);
		if (this.byOutputIndex.has(outputIndex) || (itemId !== undefined && this.byItemId.has(itemId))) {
			throw protocolError(this.model, "Provider added the same output item more than once", { outputIndex, itemId });
		}
		const state = { ...pending, outputIndex, ...(itemId === undefined ? {} : { itemId }) } as ItemState;
		this.byOutputIndex.set(outputIndex, state);
		if (itemId !== undefined) this.byItemId.set(itemId, state);
	}

	require<TKind extends ItemState["kind"]>(
		event: ResponsesItemEvent,
		kind: TKind,
	): Extract<ItemState, { kind: TKind }> {
		const state = this.resolve(event, kind);
		if (state.kind !== kind) {
			throw protocolError(this.model, `${event.type} targeted the wrong output item`, {
				outputIndex: state.outputIndex,
				itemId: state.itemId,
				expected: kind,
				actual: state.kind,
			});
		}
		return state as Extract<ItemState, { kind: TKind }>;
	}

	take(event: ResponsesItemEvent): ItemState {
		const state = this.resolve(event);
		this.byOutputIndex.delete(state.outputIndex);
		if (state.itemId !== undefined) this.byItemId.delete(state.itemId);
		return state;
	}

	private resolve(event: ResponsesItemEvent, expectedKind?: ItemState["kind"]): ItemState {
		const itemId = readItemId(event);
		const byId = itemId === undefined ? undefined : this.byItemId.get(itemId);
		const byIndex = typeof event.output_index === "number" ? this.byOutputIndex.get(event.output_index) : undefined;
		if (byId && byIndex && byId !== byIndex) {
			throw protocolError(this.model, `${event.type} identified conflicting output items`, {
				outputIndex: event.output_index,
				itemId,
			});
		}
		const identified = byId ?? byIndex;
		if (identified) return identified;
		if (itemId !== undefined || typeof event.output_index === "number") {
			throw protocolError(this.model, `${event.type} arrived before response.output_item.added`, {
				outputIndex: event.output_index,
				itemId,
			});
		}

		const candidates = [...this.byOutputIndex.values()].filter(
			(state) => expectedKind === undefined || state.kind === expectedKind,
		);
		if (candidates.length === 1) return candidates[0]!;
		throw protocolError(
			this.model,
			candidates.length === 0
				? `${event.type} arrived before response.output_item.added`
				: `${event.type} did not unambiguously identify an output item`,
			{ expected: expectedKind, activeOutputIndexes: this.outputIndexes },
		);
	}

	private allocateOutputIndex(explicit: number | undefined): number {
		if (explicit !== undefined) return explicit;
		return this.nextFallbackOutputIndex--;
	}
}

function readItemId(event: ResponsesItemEvent): string | undefined {
	if (typeof event.item_id === "string" && event.item_id.length > 0) return event.item_id;
	return typeof event.item?.id === "string" && event.item.id.length > 0 ? event.item.id : undefined;
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
