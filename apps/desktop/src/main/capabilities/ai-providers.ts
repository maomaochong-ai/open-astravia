import {
	type Api,
	type AssistantMessage,
	completeSimple,
	getAIErrorDetails,
	isAIError,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type Tool,
	type ToolCall,
	type Usage,
} from "@vetta/ai";
import { bindCapability, type CapabilityRegistry } from "@vetta/capability-runtime";
import {
	type AiChatInput,
	type AiChatMessage,
	type AiCompleteInput,
	CAPABILITY_ERROR_CODES,
	CapabilityError,
	type Disposable,
	DOMAIN_AI_CAPABILITIES,
} from "@vetta/capability-sdk";
import { getOrCreateSharedModelRuntime } from "../agent-runtime/host-services.js";
import { getDesktopModelSettingsService } from "../models/model-settings-host.js";

const DOMAIN_AI_PROVIDER_OWNER = "vetta.domain.ai";

function assertNotAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.ABORTED, "Capability invocation was aborted");
	}
}

function toModelKey(provider: string, modelId: string): string {
	return `${provider}/${modelId}`;
}

/** Zero usage for assistant turns replayed from a caller-held transcript. */
function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/**
 * Rebuild provider-shaped messages from the caller-held chat transcript. Assistant turns
 * are synthesized against the currently selected model: the transport only needs role,
 * text and tool-call linkage to continue the conversation.
 */
function toProviderMessages(messages: readonly AiChatMessage[], model: Model<Api>): Message[] {
	const timestamp = Date.now();
	return messages.map((message): Message => {
		if (message.role === "user") {
			return { role: "user", content: message.content, timestamp };
		}
		if (message.role === "assistant") {
			const toolCalls: ToolCall[] = (message.toolCalls ?? []).map((call) => ({
				type: "toolCall",
				id: call.id,
				name: call.name,
				arguments: call.arguments,
			}));
			return {
				role: "assistant",
				content: [
					...(message.content.length > 0 ? [{ type: "text" as const, text: message.content }] : []),
					...toolCalls,
				],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: emptyUsage(),
				stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
				timestamp,
			};
		}
		return {
			role: "toolResult",
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			content: [{ type: "text", text: message.content }],
			isError: message.isError === true,
			timestamp,
		};
	});
}

interface ResolvedAiModel {
	modelKey: string;
	model: Model<Api>;
	apiKey: string;
}

async function resolveRequestedModel(requestedModelKey: string | undefined): Promise<ResolvedAiModel> {
	const models = getDesktopModelSettingsService();
	const modelRegistry = getOrCreateSharedModelRuntime();
	const modelKey = requestedModelKey ?? (await models.list()).defaultModel;
	if (!modelKey) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.NOT_FOUND, "No default AI model is configured");
	}
	const model = modelRegistry
		.getAvailable()
		.find((entry) => entry.input.includes("text") && toModelKey(entry.provider, entry.id) === modelKey);
	if (!model) {
		throw new CapabilityError(CAPABILITY_ERROR_CODES.NOT_FOUND, `AI model is not available: ${modelKey}`);
	}
	const apiKey = await modelRegistry.getApiKey(model);
	if (!apiKey) {
		throw new CapabilityError(
			CAPABILITY_ERROR_CODES.PROVIDER_FAILED,
			`AI model credentials are unavailable: ${modelKey}`,
		);
	}
	return { modelKey, model, apiKey };
}

function toSimpleStreamOptions(
	input: Pick<AiChatInput | AiCompleteInput, "temperature" | "maxTokens" | "reasoning">,
	model: Model<Api>,
	apiKey: string,
	signal: AbortSignal,
): SimpleStreamOptions {
	return {
		apiKey,
		signal,
		...(input.temperature === undefined ? {} : { temperature: input.temperature }),
		...(input.maxTokens === undefined ? {} : { maxTokens: Math.min(input.maxTokens, model.maxTokens) }),
		...(input.reasoning === undefined || !model.reasoning ? {} : { reasoning: input.reasoning }),
	};
}

async function runCompletion(
	model: Model<Api>,
	context: Parameters<typeof completeSimple>[1],
	options: SimpleStreamOptions,
): Promise<AssistantMessage> {
	try {
		return await completeSimple(model, context, options);
	} catch (error) {
		if (!isAIError(error)) throw error;
		const details = getAIErrorDetails(error);
		throw new CapabilityError(
			CAPABILITY_ERROR_CODES.PROVIDER_FAILED,
			details.message,
			{ cause: error },
			{ ...details },
		);
	}
}

function assertSuccessfulStop(
	response: AssistantMessage,
	allowed: readonly ("stop" | "length" | "toolUse")[],
): asserts response is AssistantMessage & { stopReason: "stop" | "length" | "toolUse" } {
	if ((allowed as readonly string[]).includes(response.stopReason)) return;
	throw new CapabilityError(
		response.stopReason === "aborted" ? CAPABILITY_ERROR_CODES.ABORTED : CAPABILITY_ERROR_CODES.PROVIDER_FAILED,
		response.errorMessage ?? `AI completion stopped with reason: ${response.stopReason}`,
		undefined,
		response.failure === undefined ? undefined : { ...response.failure },
	);
}

function textOf(response: AssistantMessage): string {
	return response.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("");
}

function usageOf(response: AssistantMessage): { inputTokens: number; outputTokens: number; totalTokens: number } {
	return {
		inputTokens: response.usage.input,
		outputTokens: response.usage.output,
		totalTokens: response.usage.totalTokens,
	};
}

export function registerDesktopAiProviders(registry: CapabilityRegistry): Disposable {
	const models = getDesktopModelSettingsService();
	const modelRegistry = getOrCreateSharedModelRuntime();

	return registry.registerOwner(DOMAIN_AI_PROVIDER_OWNER, [
		bindCapability(DOMAIN_AI_CAPABILITIES.LIST_MODELS, {
			execute: async (_input, context) => {
				assertNotAborted(context.signal);
				const availableModels = modelRegistry.getAvailable().filter((model) => model.input.includes("text"));
				const configuredDefault = (await models.list()).defaultModel;
				const defaultModel = availableModels.some(
					(model) => toModelKey(model.provider, model.id) === configuredDefault,
				)
					? configuredDefault
					: null;
				return {
					defaultModel,
					models: availableModels.map((model) => ({
						modelKey: toModelKey(model.provider, model.id),
						provider: model.provider,
						id: model.id,
						name: model.name,
						api: model.api,
						reasoning: model.reasoning,
						input: [...model.input],
						contextWindow: model.contextWindow,
						maxTokens: model.maxTokens,
					})),
				};
			},
		}),
		bindCapability(DOMAIN_AI_CAPABILITIES.COMPLETE, {
			execute: async (input, context) => {
				assertNotAborted(context.signal);
				const { modelKey, model, apiKey } = await resolveRequestedModel(input.modelKey);
				const response = await runCompletion(
					model,
					{
						...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
						messages: [{ role: "user", content: input.prompt, timestamp: Date.now() }],
					},
					toSimpleStreamOptions(input, model, apiKey, context.signal),
				);
				assertNotAborted(context.signal);
				assertSuccessfulStop(response, ["stop", "length"]);
				return {
					modelKey,
					text: textOf(response),
					stopReason: response.stopReason as "stop" | "length",
					usage: usageOf(response),
				};
			},
		}),
		bindCapability(DOMAIN_AI_CAPABILITIES.CHAT, {
			execute: async (input, context) => {
				assertNotAborted(context.signal);
				const { modelKey, model, apiKey } = await resolveRequestedModel(input.modelKey);
				const tools: Tool[] | undefined = input.tools?.map((tool) => ({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters as Tool["parameters"],
				}));
				const response = await runCompletion(
					model,
					{
						...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
						messages: toProviderMessages(input.messages, model),
						...(tools === undefined || tools.length === 0 ? {} : { tools }),
					},
					toSimpleStreamOptions(input, model, apiKey, context.signal),
				);
				assertNotAborted(context.signal);
				assertSuccessfulStop(response, ["stop", "length", "toolUse"]);
				return {
					modelKey,
					text: textOf(response),
					toolCalls: response.content
						.filter((content): content is ToolCall => content.type === "toolCall")
						.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
					stopReason: response.stopReason as "stop" | "length" | "toolUse",
					usage: usageOf(response),
				};
			},
		}),
	]);
}
