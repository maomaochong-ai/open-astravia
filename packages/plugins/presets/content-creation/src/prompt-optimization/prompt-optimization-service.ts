import type {
	PluginAiApi,
	PluginAiModelListResult,
} from "@vetta-org/plugin-sdk";
import type {
	ContentAsset,
	ContentNodeData,
	ContentPromptOptimization,
} from "../project/types";
import { createContentPromptDocument } from "../node/prompt-document";

const OPTIMIZATION_SYSTEM_PROMPT = `You improve prompts for image, video, and audio creation.
Return only the improved prompt, without commentary, headings, or Markdown fences.
Preserve the user's language, intent, factual constraints, and every inline @material reference exactly.
Make the prompt clearer, more specific, and easier for a generation model to follow without inventing requirements.`;

interface OptimizeContentPromptOptions {
	data: ContentNodeData;
	assetByBindingId: ReadonlyMap<string, ContentAsset>;
	modelKey: string;
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
		data,
		assetByBindingId,
		modelKey,
	}: OptimizeContentPromptOptions): Promise<ContentPromptOptimization> {
		const prompt = formatPromptForOptimization(data, assetByBindingId);
		if (!prompt.trim()) throw new Error("prompt content is empty");

		const result = await this.ai.complete({
			modelKey,
			systemPrompt: OPTIMIZATION_SYSTEM_PROMPT,
			prompt,
			temperature: 0.3,
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

function formatPromptForOptimization(
	data: ContentNodeData,
	assetByBindingId: ReadonlyMap<string, ContentAsset>,
): string {
	return createContentPromptDocument(data)
		.segments.map((segment) => {
			if (segment.type === "text") return segment.text;
			if (segment.type === "asset-reference") {
				const asset = assetByBindingId.get(segment.bindingId);
				return asset ? `@${asset.name}` : `@${segment.bindingId}`;
			}
			return `@prompt:${segment.sourceNodeId}`;
		})
		.join("")
		.trim();
}
