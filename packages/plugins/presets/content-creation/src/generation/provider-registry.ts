import type {
	ContentGenerationCapability,
	ContentGenerationRequest,
	ContentModelDescriptor,
	ContentProviderAdapter,
	GeneratedContent,
} from "./types";

export class ContentProviderRegistry {
	private readonly providers = new Map<string, ContentProviderAdapter>();

	register(provider: ContentProviderAdapter): void {
		if (this.providers.has(provider.id)) throw new Error(`content provider already registered: ${provider.id}`);
		this.providers.set(provider.id, provider);
	}

	listModels(capability?: ContentGenerationCapability): ContentModelDescriptor[] {
		return Array.from(this.providers.values()).flatMap((provider) =>
			provider
				.listModels()
				.filter((model) => capability === undefined || model.capabilities.includes(capability)),
		);
	}

	async generate(request: ContentGenerationRequest): Promise<GeneratedContent> {
		const provider = this.providers.get(request.providerId);
		if (!provider) throw new Error(`content provider not found: ${request.providerId}`);
		const model = provider.listModels().find((candidate) => candidate.modelId === request.modelId);
		if (!model || !model.capabilities.includes(request.capability)) {
			throw new Error(`content model does not support ${request.capability}: ${request.providerId}/${request.modelId}`);
		}
		return provider.generate(request);
	}
}
