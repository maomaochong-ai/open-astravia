/** 拉取模型列表的适配器种类——各家 /models 接口形状不同,按此分派。 */
export type PresetFetcher = "anthropic" | "openai-compatible" | "gemini";

export interface PresetProviderDef {
	/** 预设标识,同时用作 models.json 里的 provider key 与 templateId。 */
	readonly id: string;
	readonly displayName: string;
	/** 图标 symbol,见 provider-icon/icons.generated.ts。 */
	readonly icon: string;
	readonly api: string;
	readonly baseUrl: string;
	readonly fetcher: PresetFetcher;
	/** 上游 /models 会混入 embedding / tts / 图像等非对话模型,按此过滤。 */
	readonly isChatModel: (id: string) => boolean;
}

// live / realtime 走独立的双向流式接口,veo / lyria / imagen 是视频音乐图像生成模型,
// 都不能当普通对话模型用,一并滤掉。
const NON_CHAT =
	/embedding|embed|whisper|tts|audio|realtime|-live-|moderation|dall-e|image|transcribe|rerank|vision-ocr|veo-|lyria|imagen/i;

export const PRESET_PROVIDERS: readonly PresetProviderDef[] = [
	{
		id: "claude",
		displayName: "Claude",
		icon: "claude",
		api: "anthropic-messages",
		baseUrl: "https://api.anthropic.com",
		fetcher: "anthropic",
		isChatModel: (id) => id.startsWith("claude-"),
	},
	{
		id: "openai",
		displayName: "OpenAI",
		icon: "openai",
		api: "openai-responses",
		baseUrl: "https://api.openai.com/v1",
		fetcher: "openai-compatible",
		isChatModel: (id) => /^(gpt-|o[1345](-|$)|chatgpt-)/.test(id) && !NON_CHAT.test(id),
	},
	{
		id: "deepseek",
		displayName: "DeepSeek",
		icon: "deepseek",
		api: "openai-completions-deepseek",
		baseUrl: "https://api.deepseek.com",
		fetcher: "openai-compatible",
		isChatModel: (id) => !NON_CHAT.test(id),
	},
	{
		id: "zai",
		displayName: "Z.ai (GLM)",
		icon: "zai",
		api: "zai-openai-completions",
		baseUrl: "https://api.z.ai/api/paas/v4",
		fetcher: "openai-compatible",
		isChatModel: (id) => !NON_CHAT.test(id),
	},
	{
		id: "kimi",
		displayName: "Kimi",
		icon: "kimi",
		api: "openai-completions",
		baseUrl: "https://api.moonshot.ai/v1",
		fetcher: "openai-compatible",
		isChatModel: (id) => !NON_CHAT.test(id),
	},
	{
		id: "grok",
		displayName: "Grok",
		icon: "grok",
		api: "openai-completions",
		baseUrl: "https://api.x.ai/v1",
		fetcher: "openai-compatible",
		// 非对话的都叫 grok-imagine-*(图像 / 视频生成),NON_CHAT 只挡得住图像那半边。
		isChatModel: (id) => id.startsWith("grok-") && !id.includes("imagine") && !NON_CHAT.test(id),
	},
	{
		id: "qwen",
		displayName: "Qwen",
		icon: "qwen",
		api: "qwen-openai-completions",
		baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
		fetcher: "openai-compatible",
		// DashScope 一个接口里混着通义万相、语音、第三方模型,只留通义千问自家的对话模型;
		// ocr / asr / mt 是专用接口的模型,当普通对话用会直接报参数错。
		isChatModel: (id) => /^(qwen|qwq|qvq)/.test(id) && !/-ocr|-asr|-mt-/.test(id) && !NON_CHAT.test(id),
	},
	{
		id: "gemini",
		displayName: "Gemini",
		icon: "gemini",
		api: "google-generative-ai",
		// baseUrl 必须带版本段:google provider 见到 baseUrl 就不再追加 apiVersion。
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
		fetcher: "gemini",
		isChatModel: (id) => !NON_CHAT.test(id),
	},
];

export function getPresetProvider(id: string): PresetProviderDef | undefined {
	return PRESET_PROVIDERS.find((provider) => provider.id === id);
}
