export type PluginMediaKind = "image" | "video";

export type PluginMediaGenerationMode =
	| "text-to-image"
	| "image-to-image"
	| "text-to-video"
	| "image-to-video"
	| "video-to-video"
	| "reference-to-video";

export type PluginMediaJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type PluginMediaErrorCode =
	| "unauthenticated"
	| "provider-unavailable"
	| "operation-unsupported"
	| "invalid-request"
	| "not-entitled"
	| "quota-exhausted"
	| "content-rejected"
	| "provider-timeout"
	| "provider-failed"
	| "cancelled";

export interface PluginMediaFailure {
	code: PluginMediaErrorCode;
	message: string;
	retryable: boolean;
}

export class PluginMediaError extends Error {
	readonly code: PluginMediaErrorCode;
	readonly retryable: boolean;

	constructor(failure: PluginMediaFailure) {
		super(failure.message);
		this.name = "PluginMediaError";
		this.code = failure.code;
		this.retryable = failure.retryable;
	}
}

export interface PluginMediaDimensions {
	width: number;
	height: number;
}

/** Base64 bytes passed between a media consumer and provider in renderer memory. */
export interface PluginMediaReference {
	id?: string;
	kind: PluginMediaKind;
	mimeType: string;
	data: string;
}

/** A generated result. Consumers decide where and how to persist these bytes. */
export interface PluginMediaArtifact extends PluginMediaReference {
	width?: number;
	height?: number;
	durationSeconds?: number;
}

export interface PluginMediaCapability {
	kind: PluginMediaKind;
	modes: readonly PluginMediaGenerationMode[];
	aspectRatios?: readonly string[];
	resolutions?: readonly string[];
	durationsSeconds?: readonly number[];
}

export interface PluginMediaProviderDescriptor {
	/** Host-qualified provider id. */
	id: string;
	ownerId: string;
	protocolVersion: number;
	capabilities: readonly PluginMediaCapability[];
}

export interface PluginMediaCreateJobRequest {
	providerId: string;
	kind: PluginMediaKind;
	mode: PluginMediaGenerationMode;
	prompt: string;
	modelId?: string;
	dimensions?: PluginMediaDimensions;
	aspectRatio?: string;
	resolution?: string;
	durationSeconds?: number;
	references?: readonly PluginMediaReference[];
}

export interface PluginMediaJob {
	providerId: string;
	id: string;
	status: PluginMediaJobStatus;
	progress?: number;
	artifacts?: readonly PluginMediaArtifact[];
	error?: PluginMediaFailure;
}

export interface PluginMediaJobRef {
	providerId: string;
	id: string;
}

export interface PluginMediaApi {
	listProviders(): Promise<readonly PluginMediaProviderDescriptor[]>;
	createJob(request: PluginMediaCreateJobRequest): Promise<PluginMediaJob>;
	getJob(job: PluginMediaJobRef): Promise<PluginMediaJob>;
	cancelJob(job: PluginMediaJobRef): Promise<PluginMediaJob>;
}
