export type ContentGenerationModeId =
	| "text-to-image"
	| "image-to-image"
	| "text-to-video"
	| "image-to-video"
	| "video-to-video"
	| "reference-to-video";
export type ContentGenerationOutputKind = "image" | "video";
export type ContentReferenceKind = "image" | "video";

export interface ContentModelInputSlot {
	id: string;
	accepts: readonly ContentReferenceKind[];
	minItems: number;
	maxItems: number;
}

export interface ContentGenerationMode {
	id: ContentGenerationModeId;
	inputs: readonly ContentModelInputSlot[];
}

export interface ContentModelDescriptor {
	providerId: string;
	modelId: string;
	displayName: string;
	outputKind: ContentGenerationOutputKind;
	modes: readonly ContentGenerationMode[];
	aspectRatios: readonly string[];
	durations?: readonly number[];
	resolutions?: readonly string[];
}

export interface ContentGenerationRequest {
	modeId: ContentGenerationModeId;
	providerId: string;
	modelId: string;
	prompt: string;
	aspectRatio?: string;
	quality?: string;
	duration?: number;
	resolution?: string;
	references: readonly ContentGenerationReference[];
}

export interface ContentGenerationReference {
	id: string;
	slotId: string;
	kind: ContentReferenceKind;
	data: string;
	mimeType: string;
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

export interface StoredContentData {
	data: string;
	mimeType: string;
}

export interface ImportedContentReference {
	name: string;
	data: string;
	mimeType: string;
}

export interface ContentArtifactStore {
	put(id: string, content: StoredContentData): Promise<StoredGeneratedContent>;
	read(id: string): Promise<StoredContentData | null>;
}
