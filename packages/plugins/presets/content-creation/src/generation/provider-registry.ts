import type {
	ContentGenerationOutputKind,
	ContentGenerationRequest,
	ContentModelDescriptor,
	ContentProviderAdapter,
	ContentProviderExecution,
	ContentProviderGenerationContext,
	GeneratedContent,
} from "./types";
import { resolveContentGenerationMode } from "./model-inputs";

export class ContentProviderRegistry {
	private readonly providers = new Map<string, ContentProviderAdapter>();

	register(provider: ContentProviderAdapter): void {
		if (this.providers.has(provider.id)) throw new Error(`content provider already registered: ${provider.id}`);
		this.providers.set(provider.id, provider);
	}

	listModels(outputKind?: ContentGenerationOutputKind): ContentModelDescriptor[] {
		return Array.from(this.providers.values()).flatMap((provider) =>
			provider
				.listModels()
				.filter((model) => outputKind === undefined || model.outputKind === outputKind),
		);
	}

	async generate(request: ContentGenerationRequest, context: ContentProviderGenerationContext): Promise<GeneratedContent> {
		const provider = this.providers.get(request.providerId);
		if (!provider) throw new Error(`content provider not found: ${request.providerId}`);
		const model = provider.listModels().find((candidate) => candidate.modelId === request.modelId);
		const resolution = model
			? resolveContentGenerationMode(model, request.references, request.modeId)
			: null;
		if (!model || resolution?.mode?.id !== request.modeId) {
			throw new Error(`content model does not support ${request.modeId}: ${request.providerId}/${request.modelId}`);
		}
		return provider.generate(request, context);
	}

	async resume(
		providerId: string,
		execution: ContentProviderExecution,
		context: ContentProviderGenerationContext,
	): Promise<GeneratedContent> {
		const provider = this.providers.get(providerId);
		if (!provider?.resume) throw new Error(`content provider cannot resume jobs: ${providerId}`);
		return provider.resume(execution, context);
	}
}
