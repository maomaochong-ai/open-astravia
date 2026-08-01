export type ContentGenerationCapability = "text-to-image";

export interface ContentModelDescriptor {
	providerId: string;
	modelId: string;
	capabilities: readonly ContentGenerationCapability[];
	aspectRatios: readonly string[];
}

export interface ContentGenerationRequest {
	capability: ContentGenerationCapability;
	providerId: string;
	modelId: string;
	prompt: string;
	aspectRatio?: string;
	quality?: string;
}

export interface GeneratedContent {
	kind: "image";
	data: string;
	mimeType: string;
}

export interface ContentProviderAdapter {
	readonly id: string;
	listModels(): readonly ContentModelDescriptor[];
	generate(request: ContentGenerationRequest): Promise<GeneratedContent>;
}

export interface StoredGeneratedContent {
	url: string;
	mimeType: string;
}

export interface ContentArtifactStore {
	put(id: string, content: GeneratedContent): Promise<StoredGeneratedContent>;
}
