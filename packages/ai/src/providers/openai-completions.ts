import OpenAI from "openai";
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionChunk,
	ChatCompletionContentPart,
	ChatCompletionContentPartImage,
	ChatCompletionContentPartText,
	ChatCompletionMessageParam,
	ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions.js";
import { getEnvApiKey } from "../env-api-keys.js";
import { calculateCost } from "../models.js";
import type {
	AssistantMessage,
	Context,
	Message,
	Model,
	OpenAICompletionsCompat,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from "./github-copilot-headers.js";
import { buildBaseOptions } from "./simple-options.js";
import { type ThinkingTagSegment, ThinkingTagSplitter } from "./thinking-tag-splitter.js";
import { transformMessages } from "./transform-messages.js";

/**
 * Normalize tool call ID for Mistral.
 * Mistral requires tool IDs to be exactly 9 alphanumeric characters (a-z, A-Z, 0-9).
 */
function normalizeMistralToolId(id: string): string {
	// Remove non-alphanumeric characters
	let normalized = id.replace(/[^a-zA-Z0-9]/g, "");
	// Mistral requires exactly 9 characters
	if (normalized.length < 9) {
		// Pad with deterministic characters based on original ID to ensure matching
		const padding = "ABCDEFGHI";
		normalized = normalized + padding.slice(0, 9 - normalized.length);
	} else if (normalized.length > 9) {
		normalized = normalized.slice(0, 9);
	}
	return normalized;
}

/**
 * Check if conversation messages contain tool calls or tool results.
 * This is needed because Anthropic (via proxy) requires the tools param
 * to be present when messages include tool_calls or tool role messages.
 */
function hasToolHistory(messages: Message[]): boolean {
	for (const msg of messages) {
		if (msg.role === "toolResult") {
			return true;
		}
		if (msg.role === "assistant") {
			if (msg.content.some((block) => block.type === "toolCall")) {
				return true;
			}
		}
	}
	return false;
}

export interface OpenAICompletionsOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	/** Raw reasoning effort passed through to the provider's reasoning field (e.g. "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | provider-specific). */
	reasoningEffort?: string;
}

export const streamOpenAICompletions: StreamFunction<"openai-completions", OpenAICompletionsOptions> = (
	model: Model<"openai-completions">,
	context: Context,
	options?: OpenAICompletionsOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			const client = createClient(model, context, apiKey, options?.headers);
			const params = buildParams(model, context, options);
			options?.onPayload?.(params);
			const openaiStream = await client.chat.completions.create(params, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			let currentBlock: TextContent | ThinkingContent | (ToolCall & { partialArgs?: string }) | null = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;
			// Stable lookup of in-progress toolCall blocks keyed by the protocol-level
			// `tool_calls[].index`. Without this, a text/thinking delta between two
			// chunks for the same tool call (or a placeholder-only frame) would cause
			// the type-based switch below to mistakenly create a second block.
			const toolCallByIndex = new Map<number, ToolCall & { partialArgs?: string }>();
			const finishCurrentBlock = (block?: typeof currentBlock) => {
				if (!block) return;
				// Use the block's actual position in the array, not blocks.length-1.
				// A toolCall block may be resurrected after text/thinking interleaves,
				// in which case it is no longer the last-pushed block.
				const idx = blocks.indexOf(block as (typeof blocks)[number]);
				if (block.type === "text") {
					stream.push({
						type: "text_end",
						contentIndex: idx,
						content: block.text,
						partial: output,
					});
				} else if (block.type === "thinking") {
					stream.push({
						type: "thinking_end",
						contentIndex: idx,
						content: block.thinking,
						partial: output,
					});
				} else if (block.type === "toolCall") {
					block.arguments = parseStreamingJson(block.partialArgs);
					delete block.partialArgs;
					stream.push({
						type: "toolcall_end",
						contentIndex: idx,
						toolCall: block,
						partial: output,
					});
				}
			};

			const contentSplitter = new ThinkingTagSplitter();
			const emitContentSegment = (segment: ThinkingTagSegment) => {
				if (segment.kind === "thinking") {
					if (!currentBlock || currentBlock.type !== "thinking") {
						finishCurrentBlock(currentBlock);
						currentBlock = { type: "thinking", thinking: "" };
						blocks.push(currentBlock);
						stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
					}
					currentBlock.thinking += segment.text;
					stream.push({
						type: "thinking_delta",
						contentIndex: blockIndex(),
						delta: segment.text,
						partial: output,
					});
					return;
				}

				if (!currentBlock || currentBlock.type !== "text") {
					finishCurrentBlock(currentBlock);
					currentBlock = { type: "text", text: "" };
					blocks.push(currentBlock);
					stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
				}
				currentBlock.text += segment.text;
				stream.push({
					type: "text_delta",
					contentIndex: blockIndex(),
					delta: segment.text,
					partial: output,
				});
			};

			for await (const chunk of openaiStream) {
				if (chunk.usage) {
					const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0;
					const reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens || 0;
					const input = (chunk.usage.prompt_tokens || 0) - cachedTokens;
					const outputTokens = (chunk.usage.completion_tokens || 0) + reasoningTokens;
					output.usage = {
						// OpenAI includes cached tokens in prompt_tokens, so subtract to get non-cached input
						input,
						output: outputTokens,
						cacheRead: cachedTokens,
						cacheWrite: 0,
						// Compute totalTokens ourselves since we add reasoning_tokens to output
						// and some providers (e.g., Groq) don't include them in total_tokens
						totalTokens: input + outputTokens + cachedTokens,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					};
					calculateCost(model, output.usage);
				}

				const choice = chunk.choices[0];
				if (!choice) continue;

				if (choice.finish_reason) {
					output.stopReason = mapStopReason(choice.finish_reason);
				}

				if (choice.delta) {
					if (
						choice.delta.content !== null &&
						choice.delta.content !== undefined &&
						choice.delta.content.length > 0
					) {
						for (const segment of contentSplitter.push(choice.delta.content)) emitContentSegment(segment);
					}

					// Some endpoints return reasoning in reasoning_content (llama.cpp),
					// or reasoning (other openai compatible endpoints)
					// Use the first non-empty reasoning field to avoid duplication
					// (e.g., chutes.ai returns both reasoning_content and reasoning with same content)
					const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"];
					let foundReasoningField: string | null = null;
					for (const field of reasoningFields) {
						if (
							(choice.delta as any)[field] !== null &&
							(choice.delta as any)[field] !== undefined &&
							(choice.delta as any)[field].length > 0
						) {
							if (!foundReasoningField) {
								foundReasoningField = field;
								break;
							}
						}
					}

					if (foundReasoningField) {
						if (!currentBlock || currentBlock.type !== "thinking") {
							finishCurrentBlock(currentBlock);
							currentBlock = {
								type: "thinking",
								thinking: "",
								thinkingSignature: foundReasoningField,
							};
							output.content.push(currentBlock);
							stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
						}

						if (currentBlock.type === "thinking") {
							const delta = (choice.delta as any)[foundReasoningField];
							currentBlock.thinking += delta;
							stream.push({
								type: "thinking_delta",
								contentIndex: blockIndex(),
								delta,
								partial: output,
							});
						}
					}

					if (choice?.delta?.tool_calls) {
						for (const toolCall of choice.delta.tool_calls) {
							// OpenAI-compatible protocol: `index` is the authoritative
							// identity for streaming tool_calls. Multiple deltas with the
							// same index belong to the same tool call, regardless of any
							// text/thinking deltas that interleave between them.
							const idx = typeof toolCall.index === "number" ? toolCall.index : -1;
							let block = idx >= 0 ? toolCallByIndex.get(idx) : undefined;

							if (!block) {
								// Some OpenAI-compatible servers (e.g. Qwen's compat
								// endpoint) emit pure placeholder frames like
								// `tool_calls: [{index: N}]` before any id/name/args
								// arrive. Creating a block on such a frame would leave a
								// permanent {id:"", name:""} toolCall in the message
								// (because once it gets flushed by an interleaving text
								// delta, no future frame is matched to it). Skip the
								// placeholder; the next non-empty delta for this index
								// will create the block.
								const hasPayload = !!(toolCall.id || toolCall.function?.name || toolCall.function?.arguments);
								if (!hasPayload) continue;

								finishCurrentBlock(currentBlock);
								block = {
									type: "toolCall",
									id: toolCall.id || "",
									name: toolCall.function?.name || "",
									arguments: {},
									partialArgs: "",
								};
								output.content.push(block);
								if (idx >= 0) toolCallByIndex.set(idx, block);
								currentBlock = block;
								stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
							} else if (currentBlock !== block) {
								// Same index, but text/thinking interleaved since the
								// previous delta for this tool call. End whatever block
								// we were on and resume this one.
								finishCurrentBlock(currentBlock);
								currentBlock = block;
							}

							if (toolCall.id) block.id = toolCall.id;
							if (toolCall.function?.name) block.name = toolCall.function.name;
							let delta = "";
							if (toolCall.function?.arguments) {
								delta = toolCall.function.arguments;
								block.partialArgs = (block.partialArgs ?? "") + toolCall.function.arguments;
								block.arguments = parseStreamingJson(block.partialArgs);
							}
							stream.push({
								type: "toolcall_delta",
								contentIndex: blocks.indexOf(block as (typeof blocks)[number]),
								delta,
								partial: output,
							});
						}
					}

					const reasoningDetails = (choice.delta as any).reasoning_details;
					if (reasoningDetails && Array.isArray(reasoningDetails)) {
						for (const detail of reasoningDetails) {
							if (detail.type === "reasoning.encrypted" && detail.id && detail.data) {
								const matchingToolCall = output.content.find(
									(b) => b.type === "toolCall" && b.id === detail.id,
								) as ToolCall | undefined;
								if (matchingToolCall) {
									matchingToolCall.thoughtSignature = JSON.stringify(detail);
								}
							}
						}
					}
				}
			}

			for (const segment of contentSplitter.flush()) emitContentSegment(segment);
			finishCurrentBlock(currentBlock);

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			// Some providers via OpenRouter give additional information in this field.
			const rawMetadata = (error as any)?.error?.metadata?.raw;
			if (rawMetadata) output.errorMessage += `\n${rawMetadata}`;
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimpleOpenAICompletions: StreamFunction<"openai-completions", SimpleStreamOptions> = (
	model: Model<"openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const base = buildBaseOptions(model, options, apiKey);
	// Reasoning is a passthrough value: the model only offers levels it supports, so no clamping.
	const reasoningEffort = options?.reasoning;
	const toolChoice = (options as OpenAICompletionsOptions | undefined)?.toolChoice;

	return streamOpenAICompletions(model, context, {
		...base,
		reasoningEffort,
		toolChoice,
	} satisfies OpenAICompletionsOptions);
};

function createClient(
	model: Model<"openai-completions">,
	context: Context,
	apiKey?: string,
	optionsHeaders?: Record<string, string>,
) {
	if (!apiKey) {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error(
				"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = process.env.OPENAI_API_KEY;
	}

	const headers = { ...model.headers };
	if (model.provider === "github-copilot") {
		const hasImages = hasCopilotVisionInput(context.messages);
		const copilotHeaders = buildCopilotDynamicHeaders({
			messages: context.messages,
			hasImages,
		});
		Object.assign(headers, copilotHeaders);
	}

	// Merge options headers last so they can override defaults
	if (optionsHeaders) {
		Object.assign(headers, optionsHeaders);
	}

	return new OpenAI({
		apiKey,
		baseURL: model.gatewayUrl || model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: headers,
	});
}

function buildParams(model: Model<"openai-completions">, context: Context, options?: OpenAICompletionsOptions) {
	const compat = getCompat(model);
	const messages = convertMessages(model, context, compat);
	maybeAddOpenRouterAnthropicCacheControl(model, messages);

	const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
		model: model.id,
		messages,
		stream: true,
	};

	if (compat.supportsUsageInStreaming !== false) {
		(params as any).stream_options = { include_usage: true };
	}

	if (compat.supportsStore) {
		params.store = false;
	}

	if (options?.maxTokens) {
		if (compat.maxTokensField === "max_tokens") {
			(params as any).max_tokens = options.maxTokens;
		} else {
			params.max_completion_tokens = options.maxTokens;
		}
	}

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools, compat);
	} else if (hasToolHistory(context.messages)) {
		// Anthropic (via LiteLLM/proxy) requires tools param when conversation has tool_calls/tool_results
		params.tools = [];
	}

	if (options?.toolChoice) {
		params.tool_choice = options.toolChoice;
	}

	// Whenever a non-default thinkingFormat is in effect (explicit user config or
	// auto-detected z.ai), always emit the disable/enable hint so the user's "off"
	// toggle is honored even when model.reasoning isn't set. The OpenAI-standard
	// reasoning_effort branch keeps requiring model.reasoning to avoid sending
	// unsupported params to vanilla OpenAI endpoints.
	if (compat.thinkingFormat === "zai") {
		// Z.ai / Zhipu GLM use thinking: { type: "enabled" | "disabled" } plus
		// top-level reasoning_effort. Pass the configured level through verbatim
		// (including "none" / "minimal" / "max") so service-side aliases and new
		// native levels keep working; only omit effort when thinking is fully off.
		(params as any).thinking = { type: options?.reasoningEffort ? "enabled" : "disabled" };
		if (options?.reasoningEffort) {
			params.reasoning_effort = options.reasoningEffort as any;
		}
	} else if (compat.thinkingFormat === "qwen") {
		// Qwen toggles thinking with a boolean flag, but different backends read it from
		// different places, so emit BOTH spellings:
		//   - DashScope (Model Studio) OpenAI-compatible reads a TOP-LEVEL `enable_thinking`.
		//   - self-hosted vLLM / SGLang ignore the top-level flag and only honor
		//     `chat_template_kwargs.enable_thinking`; the top-level one is silently dropped,
		//     so "off" never disables thinking there unless we also send this form.
		// reasoning_effort ("minimal" clamped up to "low" — Qwen has no "minimal") controls
		// effort when enabled; omit it entirely when disabled, since Qwen has NO "none" value.
		const qwenEffort = options?.reasoningEffort === "minimal" ? "low" : options?.reasoningEffort;
		const thinkingEnabled = !!qwenEffort;
		(params as any).enable_thinking = thinkingEnabled;
		(params as any).chat_template_kwargs = { enable_thinking: thinkingEnabled };
		if (qwenEffort) {
			params.reasoning_effort = qwenEffort as any;
		}
	} else if (compat.thinkingFormat === "nvidia") {
		// NVIDIA uses chat_template_kwargs: { enable_thinking: boolean }
		(params as any).chat_template_kwargs = { enable_thinking: !!options?.reasoningEffort };
	} else if (compat.thinkingFormat === "deepseek") {
		// DeepSeek v4 unified models use a `thinking` object: { type: "enabled" | "disabled",
		// reasoning_effort }. reasoning_effort only accepts "high" | "max"; the effort is passed
		// through per the model's configured levels. Absence of an effort disables thinking
		// (equivalent to a non-thinking request / deepseek-chat).
		if (options?.reasoningEffort) {
			(params as any).thinking = { type: "enabled", reasoning_effort: options.reasoningEffort };
		} else {
			(params as any).thinking = { type: "disabled" };
		}
	} else if (model.reasoning && compat.supportsReasoningEffort) {
		// OpenAI-style reasoning_effort. "off" is the unified disable-thinking entry point:
		// the agent maps "off" → undefined reasoning, but some callers may pass the literal
		// string "off".
		const isOpenAIOfficial = model.baseUrl.includes("api.openai.com");
		const isOff = !options?.reasoningEffort || options.reasoningEffort === "off";
		if (isOff) {
			// "none" is a gpt-5 / OpenAI-official-only disable value. Other chat-completions
			// backends (DeepSeek, aggregating gateways, vLLM, …) don't accept "none" and simply
			// ignore it — leaving thinking ON. So only emit "none" on genuine OpenAI endpoints;
			// elsewhere omit the field so the backend falls back to its non-thinking default.
			if (isOpenAIOfficial) {
				params.reasoning_effort = "none" as any;
			}
		} else if (options?.reasoningEffort === "none") {
			// Some backends explicitly declare "none" in their reasoningLevels. When the user
			// picks it from the UI, the agent passes reasoning="none". Trust the user's choice
			// and send it unguarded — the model owner has opted into the "none" level.
			params.reasoning_effort = "none" as any;
		} else {
			// "minimal" is OpenAI gpt-5 / Responses-API specific; most chat-completions backends
			// only accept low/medium/high/max/xhigh and return a 400 for "minimal". Clamp it up to
			// "low" except on genuine OpenAI endpoints, so the lightest-thinking callers (auto-title,
			// prompt suggestions) degrade instead of failing.
			const effort = options.reasoningEffort;
			params.reasoning_effort = (effort === "minimal" && !isOpenAIOfficial ? "low" : effort) as any;
		}
	}

	// OpenRouter provider routing preferences
	if (model.baseUrl.includes("openrouter.ai") && model.compat?.openRouterRouting) {
		(params as any).provider = model.compat.openRouterRouting;
	}

	// Vercel AI Gateway provider routing preferences
	if (model.baseUrl.includes("ai-gateway.vercel.sh") && model.compat?.vercelGatewayRouting) {
		const routing = model.compat.vercelGatewayRouting;
		if (routing.only || routing.order) {
			const gatewayOptions: Record<string, string[]> = {};
			if (routing.only) gatewayOptions.only = routing.only;
			if (routing.order) gatewayOptions.order = routing.order;
			(params as any).providerOptions = { gateway: gatewayOptions };
		}
	}

	return params;
}

function maybeAddOpenRouterAnthropicCacheControl(
	model: Model<"openai-completions">,
	messages: ChatCompletionMessageParam[],
): void {
	if (model.provider !== "openrouter" || !model.id.startsWith("anthropic/")) return;

	// Anthropic-style caching requires cache_control on a text part. Add a breakpoint
	// on the last user/assistant message (walking backwards until we find text content).
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "user" && msg.role !== "assistant") continue;

		const content = msg.content;
		if (typeof content === "string") {
			msg.content = [
				Object.assign({ type: "text" as const, text: content }, { cache_control: { type: "ephemeral" } }),
			];
			return;
		}

		if (!Array.isArray(content)) continue;

		// Find last text part and add cache_control
		for (let j = content.length - 1; j >= 0; j--) {
			const part = content[j];
			if (part?.type === "text") {
				Object.assign(part, { cache_control: { type: "ephemeral" } });
				return;
			}
		}
	}
}

export function convertMessages(
	model: Model<"openai-completions">,
	context: Context,
	compat: Required<OpenAICompletionsCompat>,
): ChatCompletionMessageParam[] {
	const params: ChatCompletionMessageParam[] = [];

	const normalizeToolCallId = (id: string): string => {
		if (compat.requiresMistralToolIds) return normalizeMistralToolId(id);

		// Handle pipe-separated IDs from OpenAI Responses API
		// Format: {call_id}|{id} where {id} can be 400+ chars with special chars (+, /, =)
		// These come from providers like github-copilot, openai-codex, opencode
		// Extract just the call_id part and normalize it
		if (id.includes("|")) {
			const [callId] = id.split("|");
			// Sanitize to allowed chars and truncate to 40 chars (OpenAI limit)
			return callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
		}

		if (model.provider === "openai") return id.length > 40 ? id.slice(0, 40) : id;
		return id;
	};

	const transformedMessages = transformMessages(context.messages, model, (id) => normalizeToolCallId(id));

	if (context.systemPrompt) {
		const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
		const role = useDeveloperRole ? "developer" : "system";
		params.push({ role: role, content: sanitizeSurrogates(context.systemPrompt) });
	}

	let lastRole: string | null = null;

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];
		// Some providers (e.g. Mistral/Devstral) don't allow user messages directly after tool results
		// Insert a synthetic assistant message to bridge the gap
		if (compat.requiresAssistantAfterToolResult && lastRole === "toolResult" && msg.role === "user") {
			params.push({
				role: "assistant",
				content: "I have processed the tool results.",
			});
		}

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				params.push({
					role: "user",
					content: sanitizeSurrogates(msg.content),
				});
			} else {
				const content: ChatCompletionContentPart[] = msg.content.map((item): ChatCompletionContentPart => {
					if (item.type === "text") {
						return {
							type: "text",
							text: sanitizeSurrogates(item.text),
						} satisfies ChatCompletionContentPartText;
					} else {
						return {
							type: "image_url",
							image_url: {
								url: `data:${item.mimeType};base64,${item.data}`,
							},
						} satisfies ChatCompletionContentPartImage;
					}
				});
				const filteredContent = !model.input.includes("image")
					? content.filter((c) => c.type !== "image_url")
					: content;
				if (filteredContent.length === 0) continue;
				params.push({
					role: "user",
					content: filteredContent,
				});
			}
		} else if (msg.role === "assistant") {
			// Some providers (e.g. Mistral) don't accept null content, use empty string instead
			const assistantMsg: ChatCompletionAssistantMessageParam = {
				role: "assistant",
				content: compat.requiresAssistantAfterToolResult ? "" : null,
			};

			const textBlocks = msg.content.filter((b) => b.type === "text") as TextContent[];
			// Filter out empty text blocks to avoid API validation errors
			const nonEmptyTextBlocks = textBlocks.filter((b) => b.text && b.text.trim().length > 0);
			if (nonEmptyTextBlocks.length > 0) {
				// GitHub Copilot requires assistant content as a string, not an array.
				// Sending as array causes Claude models to re-answer all previous prompts.
				if (model.provider === "github-copilot") {
					assistantMsg.content = nonEmptyTextBlocks.map((b) => sanitizeSurrogates(b.text)).join("");
				} else {
					assistantMsg.content = nonEmptyTextBlocks.map((b) => {
						return { type: "text", text: sanitizeSurrogates(b.text) };
					});
				}
			}

			// Handle thinking blocks
			const thinkingBlocks = msg.content.filter((b) => b.type === "thinking") as ThinkingContent[];
			if (thinkingBlocks.length > 0) {
				if (compat.requiresThinkingAsText) {
					const nonEmptyThinkingBlocks = thinkingBlocks.filter((b) => b.thinking && b.thinking.trim().length > 0);
					if (nonEmptyThinkingBlocks.length > 0) {
						// Convert thinking blocks to plain text (no tags to avoid model mimicking them)
						const thinkingText = nonEmptyThinkingBlocks.map((b) => b.thinking).join("\n\n");
						const textContent = assistantMsg.content as Array<{ type: "text"; text: string }> | null;
						if (textContent) {
							textContent.unshift({ type: "text", text: thinkingText });
						} else {
							assistantMsg.content = [{ type: "text", text: thinkingText }];
						}
					}
				} else {
					// DeepSeek thinking mode rule: for assistant turns that include tool_calls,
					// reasoning_content must be fully passed back in subsequent requests, otherwise
					// the API returns 400. We therefore replay the field whenever any block carries
					// a signature, even if the thinking text itself is empty/whitespace.
					const sigBlock = thinkingBlocks.find((b) => b.thinkingSignature && b.thinkingSignature.length > 0);
					if (sigBlock) {
						const signature = sigBlock.thinkingSignature!;
						(assistantMsg as any)[signature] = thinkingBlocks.map((b) => b.thinking ?? "").join("\n");
					}
				}
			}

			const toolCalls = msg.content.filter((b) => b.type === "toolCall") as ToolCall[];
			if (toolCalls.length > 0) {
				assistantMsg.tool_calls = toolCalls.map((tc) => ({
					id: tc.id,
					type: "function" as const,
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.arguments),
					},
				}));
				const reasoningDetails = toolCalls
					.filter((tc) => tc.thoughtSignature)
					.map((tc) => {
						try {
							return JSON.parse(tc.thoughtSignature!);
						} catch {
							return null;
						}
					})
					.filter(Boolean);
				if (reasoningDetails.length > 0) {
					(assistantMsg as any).reasoning_details = reasoningDetails;
				}
			}
			// Skip assistant messages that have no content and no tool calls.
			// Mistral explicitly requires "either content or tool_calls, but not none".
			// Other providers also don't accept empty assistant messages.
			// This handles aborted assistant responses that got no content.
			const content = assistantMsg.content;
			const hasContent =
				content !== null &&
				content !== undefined &&
				(typeof content === "string" ? content.length > 0 : content.length > 0);
			if (!hasContent && !assistantMsg.tool_calls) {
				continue;
			}
			params.push(assistantMsg);
		} else if (msg.role === "toolResult") {
			const imageBlocks: Array<{ type: "image_url"; image_url: { url: string } }> = [];
			let j = i;

			for (; j < transformedMessages.length && transformedMessages[j].role === "toolResult"; j++) {
				const toolMsg = transformedMessages[j] as ToolResultMessage;

				// Extract text and image content
				const textResult = toolMsg.content
					.filter((c) => c.type === "text")
					.map((c) => (c as any).text)
					.join("\n");
				const hasImages = toolMsg.content.some((c) => c.type === "image");

				// Always send tool result with text (or placeholder if only images)
				const hasText = textResult.length > 0;
				// Some providers (e.g. Mistral) require the 'name' field in tool results
				const toolResultMsg: ChatCompletionToolMessageParam = {
					role: "tool",
					content: sanitizeSurrogates(hasText ? textResult : "(see attached image)"),
					tool_call_id: toolMsg.toolCallId,
				};
				if (compat.requiresToolResultName && toolMsg.toolName) {
					(toolResultMsg as any).name = toolMsg.toolName;
				}
				params.push(toolResultMsg);

				if (hasImages && model.input.includes("image")) {
					for (const block of toolMsg.content) {
						if (block.type === "image") {
							imageBlocks.push({
								type: "image_url",
								image_url: {
									url: `data:${(block as any).mimeType};base64,${(block as any).data}`,
								},
							});
						}
					}
				}
			}

			i = j - 1;

			if (imageBlocks.length > 0) {
				if (compat.requiresAssistantAfterToolResult) {
					params.push({
						role: "assistant",
						content: "I have processed the tool results.",
					});
				}

				params.push({
					role: "user",
					content: [
						{
							type: "text",
							text: "Attached image(s) from tool result:",
						},
						...imageBlocks,
					],
				});
				lastRole = "user";
			} else {
				lastRole = "toolResult";
			}
			continue;
		}

		lastRole = msg.role;
	}

	return params;
}

function convertTools(
	tools: Tool[],
	compat: Required<OpenAICompletionsCompat>,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
	return tools.map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters as any, // TypeBox already generates JSON Schema
			// Only include strict if provider supports it. Some reject unknown fields.
			...(compat.supportsStrictMode !== false && { strict: false }),
		},
	}));
}

function mapStopReason(reason: ChatCompletionChunk.Choice["finish_reason"]): StopReason {
	if (reason === null) return "stop";
	switch (reason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "function_call":
		case "tool_calls":
			return "toolUse";
		case "content_filter":
			return "error";
		default: {
			const _exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}

/**
 * Detect compatibility settings from provider and baseUrl for known providers.
 * Provider takes precedence over URL-based detection since it's explicitly configured.
 * Returns a fully resolved OpenAICompletionsCompat object with all fields set.
 */
function detectCompat(model: Model<"openai-completions">): Required<OpenAICompletionsCompat> {
	const provider = model.provider;
	const baseUrl = model.baseUrl;

	const isZai =
		provider === "zai" || provider === "zhipu" || baseUrl.includes("api.z.ai") || baseUrl.includes("bigmodel.cn");

	const isNonStandard =
		provider === "cerebras" ||
		baseUrl.includes("cerebras.ai") ||
		provider === "xai" ||
		baseUrl.includes("api.x.ai") ||
		provider === "mistral" ||
		baseUrl.includes("mistral.ai") ||
		baseUrl.includes("chutes.ai") ||
		baseUrl.includes("deepseek.com") ||
		isZai ||
		provider === "opencode" ||
		baseUrl.includes("opencode.ai");

	const useMaxTokens = provider === "mistral" || baseUrl.includes("mistral.ai") || baseUrl.includes("chutes.ai");

	const isGrok = provider === "xai" || baseUrl.includes("api.x.ai");

	const isMistral = provider === "mistral" || baseUrl.includes("mistral.ai");

	// The `developer` role is OpenAI-specific (official reasoning models / Copilot proxy).
	// Most OpenAI-compatible backends (vLLM, SGLang, Qwen, llama.cpp, …) only know
	// system/user/assistant/tool and reject `developer` with "400 Unexpected message role".
	// Default it on ONLY for endpoints known to support it; everything else falls back to
	// the universally-accepted `system` role.
	const supportsDeveloperRole =
		provider === "openai" || provider === "github-copilot" || baseUrl.includes("api.openai.com");

	return {
		supportsStore: !isNonStandard,
		supportsDeveloperRole,
		supportsReasoningEffort: !isGrok && !isZai,
		supportsUsageInStreaming: true,
		maxTokensField: useMaxTokens ? "max_tokens" : "max_completion_tokens",
		requiresToolResultName: isMistral,
		requiresAssistantAfterToolResult: false, // Mistral no longer requires this as of Dec 2024
		requiresThinkingAsText: isMistral,
		requiresMistralToolIds: isMistral,
		thinkingFormat: isZai ? "zai" : "openai",
		openRouterRouting: {},
		vercelGatewayRouting: {},
		supportsStrictMode: true,
	};
}

/**
 * Get resolved compatibility settings for a model.
 * Uses explicit model.compat if provided, otherwise auto-detects from provider/URL.
 */
function getCompat(model: Model<"openai-completions">): Required<OpenAICompletionsCompat> {
	const detected = detectCompat(model);
	if (!model.compat) return detected;

	return {
		supportsStore: model.compat.supportsStore ?? detected.supportsStore,
		supportsDeveloperRole: model.compat.supportsDeveloperRole ?? detected.supportsDeveloperRole,
		supportsReasoningEffort: model.compat.supportsReasoningEffort ?? detected.supportsReasoningEffort,
		supportsUsageInStreaming: model.compat.supportsUsageInStreaming ?? detected.supportsUsageInStreaming,
		maxTokensField: model.compat.maxTokensField ?? detected.maxTokensField,
		requiresToolResultName: model.compat.requiresToolResultName ?? detected.requiresToolResultName,
		requiresAssistantAfterToolResult:
			model.compat.requiresAssistantAfterToolResult ?? detected.requiresAssistantAfterToolResult,
		requiresThinkingAsText: model.compat.requiresThinkingAsText ?? detected.requiresThinkingAsText,
		requiresMistralToolIds: model.compat.requiresMistralToolIds ?? detected.requiresMistralToolIds,
		thinkingFormat: model.compat.thinkingFormat ?? detected.thinkingFormat,
		openRouterRouting: model.compat.openRouterRouting ?? {},
		vercelGatewayRouting: model.compat.vercelGatewayRouting ?? detected.vercelGatewayRouting,
		supportsStrictMode: model.compat.supportsStrictMode ?? detected.supportsStrictMode,
	};
}
