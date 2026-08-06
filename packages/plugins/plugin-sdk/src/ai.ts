export interface PluginAiModel {
	modelKey: string;
	provider: string;
	id: string;
	name: string;
	api: string;
	reasoning: boolean;
	input: Array<"text" | "image">;
	contextWindow: number;
	maxTokens: number;
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
}
