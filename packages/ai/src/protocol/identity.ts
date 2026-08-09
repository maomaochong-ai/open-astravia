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
