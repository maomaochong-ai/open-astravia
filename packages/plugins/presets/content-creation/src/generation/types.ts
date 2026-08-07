export type ContentGenerationModeId =
	| "text-to-image"
	| "image-to-image"
	| "text-to-video"
	| "image-to-video"
	| "video-to-video"
	| "reference-to-video";
export type ContentGenerationOutputKind = "image" | "video";
export type ContentReferenceKind = "image" | "video" | "audio";

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
	mimeType: string;
	source: PluginMediaReferenceSource;
}

export interface GeneratedContent {
	kind: "image" | "video";
	mimeType: string;
	source: { type: "inline"; data: string } | { type: "host-artifact"; artifactId: string };
	width?: number;
	height?: number;
	duration?: number;
}

export interface ContentProviderAdapter {
	readonly id: string;
	listModels(): readonly ContentModelDescriptor[];
	generate(request: ContentGenerationRequest, context: ContentProviderGenerationContext): Promise<GeneratedContent>;
}

export interface ContentProviderGenerationContext {
	readReference(reference: ContentGenerationReference): Promise<StoredContentData>;
}

export interface StoredImportedContent {
	blobId: string;
	mimeType: string;
}

export interface StoredGeneratedContent {
	filePath: string;
	mimeType: string;
}

export interface StoredContentData {
	data: string;
	mimeType: string;
}

export interface ImportedContentAsset {
	name: string;
	data: string;
	mimeType: string;
}

export type ImportedContentReference = ImportedContentAsset;

export interface ContentArtifactStore {
	putImported(id: string, content: StoredContentData): Promise<StoredImportedContent>;
	putGenerated(cwd: string, fileName: string, content: GeneratedContent): Promise<StoredGeneratedContent>;
	readReference(reference: ContentGenerationReference): Promise<StoredContentData | null>;
}
import type { PluginMediaReferenceSource } from "@vetta-org/plugin-sdk";
