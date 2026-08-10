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
	source: PluginMediaInputSource;
}

export interface GeneratedContent {
	kind: "image" | "video";
	mimeType: string;
	source: { type: "inline"; data: string } | { type: "host-artifact"; artifactId: string };
	width?: number;
	height?: number;
	duration?: number;
}

export interface ContentProviderExecution {
	kind: "host-job";
	jobId: string;
	outputKind: ContentGenerationOutputKind;
}

export interface ContentProviderProgress {
	status: "queued" | "running";
	progress?: number;
}

export interface ContentProviderAdapter {
	readonly id: string;
	listModels(): readonly ContentModelDescriptor[];
	generate(request: ContentGenerationRequest, context: ContentProviderGenerationContext): Promise<GeneratedContent>;
	resume?(
		execution: ContentProviderExecution,
		context: ContentProviderGenerationContext,
	): Promise<GeneratedContent>;
}

export interface ContentProviderGenerationContext {
	readReference(reference: ContentGenerationReference): Promise<StoredContentData>;
	signal?: AbortSignal;
	onExecution?(execution: ContentProviderExecution): Promise<void>;
	onProgress?(progress: ContentProviderProgress): Promise<void>;
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

export type ImportedContentAsset = { name: string; mimeType: string; width?: number; height?: number } & (
	| { file: File; data?: never }
	| { data: string; file?: never }
);

export type ImportedContentReference = ImportedContentAsset;

export interface ContentArtifactStore {
	putImported(id: string, content: ImportedContentAsset): Promise<StoredImportedContent>;
	putGenerated(cwd: string, fileName: string, content: GeneratedContent): Promise<StoredGeneratedContent>;
	releaseGenerated(content: GeneratedContent): Promise<void>;
	readReference(reference: ContentGenerationReference): Promise<StoredContentData | null>;
}
import type { PluginMediaInputSource } from "@vetta-org/plugin-sdk";
