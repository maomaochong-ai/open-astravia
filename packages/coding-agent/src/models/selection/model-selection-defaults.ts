import type { ThinkingLevel } from "@vetta/agent-core";
import type { KnownProvider } from "@vetta/ai";

export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

export const DEFAULT_MODEL_PER_PROVIDER: Readonly<Record<KnownProvider, string>> = {
	"amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
	anthropic: "claude-opus-4-6",
	openai: "gpt-5.1-codex",
	"azure-openai-responses": "gpt-5.2",
	"openai-codex": "gpt-5.3-codex",
	google: "gemini-2.5-pro",
	"google-gemini-cli": "gemini-2.5-pro",
	"google-antigravity": "gemini-3-pro-high",
	"google-vertex": "gemini-3-pro-preview",
	"github-copilot": "gpt-4o",
	openrouter: "openai/gpt-5.1-codex",
	"vercel-ai-gateway": "anthropic/claude-opus-4-6",
	xai: "grok-4-fast-non-reasoning",
	groq: "openai/gpt-oss-120b",
	cerebras: "zai-glm-4.6",
	zai: "glm-4.6",
	zhipu: "glm-4.6",
	mistral: "devstral-medium-latest",
	minimax: "MiniMax-M2.1",
	"minimax-cn": "MiniMax-M2.1",
	huggingface: "moonshotai/Kimi-K2.5",
	opencode: "claude-opus-4-6",
	"kimi-coding": "kimi-k2-thinking",
	qwen: "qwen3-coder",
	deepseek: "deepseek-v4-flash",
};

export const VALID_THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

export function isValidThinkingLevel(level: string): level is ThinkingLevel {
	return VALID_THINKING_LEVELS.includes(level as ThinkingLevel);
}
