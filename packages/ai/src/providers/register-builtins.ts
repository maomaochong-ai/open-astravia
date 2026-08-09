import { clearApiProviders, registerApiProvider } from "../api-registry.js";
import type { AdapterRegistry, ApiProvider } from "../runtime/adapter-registry.js";
import { adaptApiProvider, type LanguageModelAdapter } from "../runtime/language-model-adapter.js";
import type { Api, StreamOptions } from "../types.js";
import { bedrockAdapter, streamBedrock, streamSimpleBedrock } from "./amazon-bedrock.js";
import { anthropicAdapter, streamAnthropic, streamSimpleAnthropic } from "./anthropic.js";
import {
	azureOpenAIResponsesAdapter,
	streamAzureOpenAIResponses,
	streamSimpleAzureOpenAIResponses,
} from "./azure-openai-responses.js";
import { deepSeekAdapter, streamDeepSeek, streamSimpleDeepSeek } from "./deepseek.js";
import { streamGoogle, streamSimpleGoogle } from "./google.js";
import { streamGoogleGeminiCli, streamSimpleGoogleGeminiCli } from "./google-gemini-cli.js";
import { streamGoogleVertex, streamSimpleGoogleVertex } from "./google-vertex.js";
import { nvidiaAdapter, streamNvidia, streamSimpleNvidia } from "./nvidia.js";
import {
	openAICodexResponsesAdapter,
	streamOpenAICodexResponses,
	streamSimpleOpenAICodexResponses,
} from "./openai-codex-responses.js";
import {
	openAICompletionsAdapter,
	streamOpenAICompletions,
	streamSimpleOpenAICompletions,
} from "./openai-completions.js";
import { openAIResponsesAdapter, streamOpenAIResponses, streamSimpleOpenAIResponses } from "./openai-responses.js";
import { qwenAdapter, streamQwen, streamSimpleQwen } from "./qwen.js";
import { streamSimpleZai, streamZai, zaiAdapter } from "./zai.js";
import { streamSimpleZhipu, streamZhipu, zhipuAdapter } from "./zhipu.js";

interface BuiltInProviderVisitor {
	register<TApi extends Api, TOptions extends StreamOptions>(
		provider: ApiProvider<TApi, TOptions>,
		adapter?: LanguageModelAdapter<TApi, TOptions>,
	): void;
}

function visitBuiltInProviders(visitor: BuiltInProviderVisitor): void {
	visitor.register(
		{
			api: "anthropic-messages",
			stream: streamAnthropic,
			streamSimple: streamSimpleAnthropic,
		},
		anthropicAdapter,
	);

	visitor.register(
		{
			api: "openai-completions",
			stream: streamOpenAICompletions,
			streamSimple: streamSimpleOpenAICompletions,
		},
		openAICompletionsAdapter,
	);

	visitor.register(
		{
			api: "openai-responses",
			stream: streamOpenAIResponses,
			streamSimple: streamSimpleOpenAIResponses,
		},
		openAIResponsesAdapter,
	);

	visitor.register(
		{
			api: "azure-openai-responses",
			stream: streamAzureOpenAIResponses,
			streamSimple: streamSimpleAzureOpenAIResponses,
		},
		azureOpenAIResponsesAdapter,
	);

	visitor.register(
		{
			api: "openai-codex-responses",
			stream: streamOpenAICodexResponses,
			streamSimple: streamSimpleOpenAICodexResponses,
		},
		openAICodexResponsesAdapter,
	);

	visitor.register({
		api: "google-generative-ai",
		stream: streamGoogle,
		streamSimple: streamSimpleGoogle,
	});

	visitor.register({
		api: "google-gemini-cli",
		stream: streamGoogleGeminiCli,
		streamSimple: streamSimpleGoogleGeminiCli,
	});

	visitor.register({
		api: "google-vertex",
		stream: streamGoogleVertex,
		streamSimple: streamSimpleGoogleVertex,
	});

	visitor.register(
		{
			api: "nvidia-openai-responses",
			stream: streamNvidia,
			streamSimple: streamSimpleNvidia,
		},
		nvidiaAdapter,
	);

	visitor.register(
		{
			api: "qwen-openai-completions",
			stream: streamQwen,
			streamSimple: streamSimpleQwen,
		},
		qwenAdapter,
	);

	visitor.register(
		{
			api: "openai-completions-deepseek",
			stream: streamDeepSeek,
			streamSimple: streamSimpleDeepSeek,
		},
		deepSeekAdapter,
	);

	visitor.register(
		{
			api: "zai-openai-completions",
			stream: streamZai,
			streamSimple: streamSimpleZai,
		},
		zaiAdapter,
	);

	visitor.register(
		{
			api: "zhipu-openai-completions",
			stream: streamZhipu,
			streamSimple: streamSimpleZhipu,
		},
		zhipuAdapter,
	);

	visitor.register(
		{
			api: "bedrock-converse-stream",
			stream: streamBedrock,
			streamSimple: streamSimpleBedrock,
		},
		bedrockAdapter,
	);
}

export function registerBuiltInApiProviders(): void {
	visitBuiltInProviders({
		register(provider, _adapter) {
			registerApiProvider(provider, "built-in");
		},
	});
}

export function registerBuiltInAdapters(registry: AdapterRegistry): void {
	visitBuiltInProviders({
		register(provider, adapter) {
			registry.register(adapter ?? adaptApiProvider(provider), { sourceId: "built-in" });
		},
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}

registerBuiltInApiProviders();
