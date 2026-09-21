export type KnownApi =
	| "openai-completions"
	| "openai-responses"
	| "azure-openai-responses"
	| "openai-codex-responses"
	| "nvidia-openai-responses"
	| "qwen-openai-completions"
	| "openai-completions-deepseek"
	| "zai-openai-completions"
	| "zhipu-openai-completions"
	| "anthropic-messages"
	| "bedrock-converse-stream"
	| "google-generative-ai"
	| "google-gemini-cli"
	| "google-vertex";

export type Api = KnownApi | (string & {});

/**
 * 这些 API 由厂商 SDK 自己发请求，SDK 没有暴露 fetch 注入口，宿主注入的传输层
 * （例如应用代理）对它们不生效——它们只能跟随进程级 dispatcher / 代理环境变量。
 *
 * 宿主必须据此告知用户，而不是让开关看着生效、实际请求裸奔出去。
 */
export const APIS_WITHOUT_FETCH_INJECTION: readonly Api[] = [
	"bedrock-converse-stream",
	"google-generative-ai",
	"google-vertex",
];

export function supportsProviderFetchInjection(api: Api): boolean {
	return !APIS_WITHOUT_FETCH_INJECTION.includes(api);
}

export type KnownProvider =
	| "amazon-bedrock"
	| "anthropic"
	| "google"
	| "google-gemini-cli"
	| "google-antigravity"
	| "google-vertex"
	| "openai"
	| "azure-openai-responses"
	| "openai-codex"
	| "github-copilot"
	| "xai"
	| "groq"
	| "cerebras"
	| "openrouter"
	| "vercel-ai-gateway"
	| "zai"
	| "zhipu"
	| "mistral"
	| "minimax"
	| "minimax-cn"
	| "huggingface"
	| "opencode"
	| "kimi-coding"
	| "qwen"
	| "deepseek";

export type Provider = KnownProvider | string;
