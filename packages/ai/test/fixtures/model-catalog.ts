import type { Api, Model } from "../../src/types.js";

type ProviderFixture = {
	api: Api | ((modelId: string) => Api);
	baseUrl: string;
	modelIds: readonly string[];
};

const PROVIDER_FIXTURES = {
	"amazon-bedrock": {
		api: "bedrock-converse-stream",
		baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
		modelIds: [
			"global.anthropic.claude-opus-4-5-20251101-v1:0",
			"global.anthropic.claude-opus-4-6-v1",
			"global.anthropic.claude-sonnet-4-5-20250929-v1:0",
		],
	},
	anthropic: {
		api: "anthropic-messages",
		baseUrl: "https://api.anthropic.com",
		modelIds: [
			"claude-3-5-haiku-20241022",
			"claude-haiku-4-5",
			"claude-opus-4-1-20250805",
			"claude-opus-4-5",
			"claude-opus-4-6",
			"claude-sonnet-4-20250514",
			"claude-sonnet-4-5",
		],
	},
	"azure-openai-responses": {
		api: "azure-openai-responses",
		baseUrl: "",
		modelIds: ["gpt-4o-mini"],
	},
	cerebras: {
		api: "openai-completions",
		baseUrl: "https://api.cerebras.ai/v1",
		modelIds: ["gpt-oss-120b", "qwen-3-235b-a22b-instruct-2507"],
	},
	"github-copilot": {
		api: (modelId) => (modelId.startsWith("claude-") ? "anthropic-messages" : "openai-completions"),
		baseUrl: "https://api.individual.githubcopilot.com",
		modelIds: ["claude-sonnet-4", "gpt-4o", "gpt-5-mini", "gpt-5.2-codex"],
	},
	"google-antigravity": {
		api: "google-gemini-cli",
		baseUrl: "https://daily-cloudcode-pa.sandbox.googleapis.com",
		modelIds: [
			"claude-sonnet-4-5",
			"claude-sonnet-4-5-thinking",
			"gemini-3-flash",
			"gemini-3-pro-high",
			"gpt-oss-120b-medium",
		],
	},
	"google-gemini-cli": {
		api: "google-gemini-cli",
		baseUrl: "https://cloudcode-pa.googleapis.com",
		modelIds: ["gemini-2.5-flash", "gemini-3-flash-preview"],
	},
	"google-vertex": {
		api: "google-vertex",
		baseUrl: "https://aiplatform.googleapis.com",
		modelIds: ["gemini-3-flash-preview"],
	},
	google: {
		api: "google-generative-ai",
		baseUrl: "https://generativelanguage.googleapis.com",
		modelIds: ["gemini-2.0-flash", "gemini-2.5-flash"],
	},
	groq: {
		api: "openai-completions",
		baseUrl: "https://api.groq.com/openai/v1",
		modelIds: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b", "openai/gpt-oss-120b"],
	},
	huggingface: {
		api: "openai-completions",
		baseUrl: "https://router.huggingface.co/v1",
		modelIds: ["moonshotai/Kimi-K2.5"],
	},
	"kimi-coding": {
		api: "anthropic-messages",
		baseUrl: "https://api.kimi.com/coding",
		modelIds: ["k2p5", "kimi-k2-thinking"],
	},
	minimax: {
		api: "anthropic-messages",
		baseUrl: "https://api.minimax.io/anthropic",
		modelIds: ["MiniMax-M2.1"],
	},
	mistral: {
		api: "openai-completions",
		baseUrl: "https://api.mistral.ai/v1",
		modelIds: ["devstral-medium-latest", "magistral-medium-latest", "pixtral-12b"],
	},
	opencode: {
		api: "anthropic-messages",
		baseUrl: "https://opencode.ai/zen",
		modelIds: ["big-pickle"],
	},
	"openai-codex": {
		api: "openai-codex-responses",
		baseUrl: "https://chatgpt.com/backend-api",
		modelIds: ["gpt-5.2-codex", "gpt-5.3-codex"],
	},
	openai: {
		api: "openai-responses",
		baseUrl: "https://api.openai.com/v1",
		modelIds: ["gpt-4o", "gpt-4o-mini", "gpt-5-mini", "gpt-5.1-codex-max", "gpt-5.2-codex"],
	},
	openrouter: {
		api: "openai-completions",
		baseUrl: "https://openrouter.ai/api/v1",
		modelIds: [
			"anthropic/claude-opus-4.6",
			"anthropic/claude-sonnet-4",
			"deepseek/deepseek-chat",
			"deepseek/deepseek-v3.2",
			"google/gemini-2.0-flash-001",
			"google/gemini-2.5-flash",
			"meta-llama/llama-4-maverick",
			"mistralai/mistral-large-2512",
			"mistralai/mistral-small-3.2-24b-instruct",
			"openai/gpt-5.2-codex",
			"z-ai/glm-4.5v",
		],
	},
	"vercel-ai-gateway": {
		api: "anthropic-messages",
		baseUrl: "https://ai-gateway.vercel.sh",
		modelIds: ["anthropic/claude-opus-4.5", "google/gemini-2.5-flash", "openai/gpt-5.1-codex-max"],
	},
	xai: {
		api: "openai-completions",
		baseUrl: "https://api.x.ai/v1",
		modelIds: ["grok-3", "grok-3-fast", "grok-code-fast-1"],
	},
	zai: {
		api: "openai-completions",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		modelIds: ["glm-4.5-air", "glm-4.5-flash", "glm-4.5v"],
	},
} satisfies Record<string, ProviderFixture>;

function createModel(provider: string, fixture: ProviderFixture, modelId: string): Model<Api> {
	return {
		id: modelId,
		name: modelId,
		api: typeof fixture.api === "function" ? fixture.api(modelId) : fixture.api,
		provider,
		baseUrl: fixture.baseUrl,
		reasoning: /claude|codex|deepseek|gemini-3|gpt-5|grok|kimi|magistral|MiniMax|glm/.test(modelId),
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 64_000,
	};
}

export function createTestModelCatalog(): Record<string, Record<string, Model<Api>>> {
	return Object.fromEntries(
		Object.entries(PROVIDER_FIXTURES).map(([provider, fixture]) => [
			provider,
			Object.fromEntries(fixture.modelIds.map((modelId) => [modelId, createModel(provider, fixture, modelId)])),
		]),
	);
}
