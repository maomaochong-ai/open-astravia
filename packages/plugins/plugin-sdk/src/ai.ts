export interface PluginAiModel {
	modelKey: string;
	provider: string;
	id: string;
	name: string;
	api: string;
	reasoning: boolean;
	input: Array<"text" | "image">;
	contextWindow: number;
	maxTokens?: number;
}

export interface PluginAiModelListResult {
	defaultModel: string | null;
	models: PluginAiModel[];
}

export interface PluginAiCompleteRequest {
	modelKey?: string;
	systemPrompt?: string;
	prompt: string;
	temperature?: number;
	maxTokens?: number;
	reasoning?: string;
}

export interface PluginAiUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

export interface PluginAiToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface PluginAiChatUserMessage {
	role: "user";
	content: string;
}

export interface PluginAiChatAssistantMessage {
	role: "assistant";
	content: string;
	toolCalls?: PluginAiToolCall[];
}

export interface PluginAiChatToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: string;
	isError?: boolean;
}

export type PluginAiChatMessage =
	| PluginAiChatUserMessage
	| PluginAiChatAssistantMessage
	| PluginAiChatToolResultMessage;

/** Tool visible only to this chat request. The plugin executes matching tool calls itself. */
export interface PluginAiChatTool {
	name: string;
	description: string;
	/** JSON Schema object describing the tool arguments. */
	parameters: Record<string, unknown>;
}

export interface PluginAiChatRequest {
	modelKey?: string;
	systemPrompt?: string;
	/** Full conversation transcript, oldest first. The host keeps no chat state between calls. */
	messages: PluginAiChatMessage[];
	tools?: PluginAiChatTool[];
	temperature?: number;
	maxTokens?: number;
	reasoning?: string;
}

export interface PluginAiChatResult {
	modelKey: string;
	text: string;
	/** Pending tool calls the plugin must execute and answer via `toolResult` messages. */
	toolCalls: PluginAiToolCall[];
	stopReason: "stop" | "length" | "toolUse";
	usage: PluginAiUsage;
}

export interface PluginAiCompleteResult {
	modelKey: string;
	text: string;
	stopReason: "stop" | "length";
	usage: PluginAiUsage;
}

/** Host-managed text inference. Provider credentials never enter the plugin runtime. */
export interface PluginAiApi {
	listModels(): Promise<PluginAiModelListResult>;
	complete(request: PluginAiCompleteRequest): Promise<PluginAiCompleteResult>;
	/**
	 * Stateless multi-turn completion. The plugin owns and persists the transcript;
	 * each call sends the full message history (optionally with plugin-internal tools)
	 * and receives the next assistant turn. Requires the `ai.complete` permission.
	 */
	chat(request: PluginAiChatRequest): Promise<PluginAiChatResult>;
}
