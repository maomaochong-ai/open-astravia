import type {
	PluginAiApi,
	PluginAiModelListResult,
} from "@vetta-org/plugin-sdk";
import type { ContentPromptOptimization } from "../project/types";

const BASE_OPTIMIZATION_SYSTEM_PROMPT = `You improve prompts for AI-assisted content creation.
Return only the improved prompt, without commentary, headings, or Markdown fences.
Preserve the user's language, intent, factual constraints, and every inline @material reference exactly.
Do not invent requirements that are absent from the source prompt.`;

export interface ContentPromptOptimizationProfile {
	instruction: string;
	temperature?: number;
}

export const CONTENT_PROMPT_NODE_OPTIMIZATION_PROFILE = {
	instruction:
		"Rewrite this as a clear, reusable upstream prompt for downstream image, video, or audio generation nodes. Keep it provider-neutral and retain all useful constraints.",
	temperature: 0.3,
} satisfies ContentPromptOptimizationProfile;

interface OptimizeContentPromptOptions {
	source: string;
	modelKey: string;
	profile: ContentPromptOptimizationProfile;
}

export class ContentPromptOptimizationService {
	private modelListPromise: Promise<PluginAiModelListResult> | null = null;

	constructor(private readonly ai: PluginAiApi) {}

	listModels(): Promise<PluginAiModelListResult> {
		if (!this.modelListPromise) {
			this.modelListPromise = this.ai.listModels().catch((error: unknown) => {
				this.modelListPromise = null;
				throw error;
			});
		}
		return this.modelListPromise;
	}

	async optimize({
		source,
		modelKey,
		profile,
	}: OptimizeContentPromptOptions): Promise<ContentPromptOptimization> {
		const prompt = source.trim();
		if (!prompt) throw new Error("prompt content is empty");

		const result = await this.ai.complete({
			modelKey,
			systemPrompt: `${BASE_OPTIMIZATION_SYSTEM_PROMPT}\n${profile.instruction}`,
			prompt,
			temperature: profile.temperature ?? 0.3,
		});
		const text = result.text.trim();
		if (!text) throw new Error("prompt optimization returned empty content");

		return {
			text,
			modelKey: result.modelKey,
			createdAt: new Date().toISOString(),
		};
	}
}
