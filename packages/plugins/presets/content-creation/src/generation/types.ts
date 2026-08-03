export type ContentGenerationCapability = "text-to-image" | "text-to-video" | "video-to-video";

export interface ContentModelDescriptor {
	providerId: string;
	modelId: string;
	displayName: string;
	capabilities: readonly ContentGenerationCapability[];
	aspectRatios: readonly string[];
	durations?: readonly number[];
	resolutions?: readonly string[];
}

export interface ContentGenerationRequest {
	capability: ContentGenerationCapability;
	providerId: string;
	modelId: string;
	prompt: string;
	aspectRatio?: string;
	quality?: string;
	duration?: number;
	resolution?: string;
}

export interface GeneratedContent {
	kind: "image" | "video";
	data: string;
	mimeType: string;
	width?: number;
	height?: number;
	duration?: number;
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
