import type { PluginArtifactRef } from "./artifacts.js";
import type { Disposable } from "./disposable.js";
import type { PluginJob, PluginJobFailure } from "./jobs.js";

export type PluginMediaKind = "image" | "video" | "audio" | "document";
export type PluginMediaOutputKind = "image" | "video" | "audio";
export type PluginMediaOperation = "generate" | "compose" | "transcode";

export type PluginMediaGenerationMode =
	| "text-to-image"
	| "image-to-image"
	| "text-to-video"
	| "image-to-video"
	| "video-to-video"
	| "reference-to-video";

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

export interface PluginMediaFailure extends PluginJobFailure {
	code: PluginMediaErrorCode;
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

export type PluginMediaInputSource =
	| { type: "plugin-blob"; blobId: string }
	| { type: "workspace-file"; path: string };

export interface PluginMediaInput {
	id?: string;
	kind: PluginMediaKind;
	mimeType?: string;
	source: PluginMediaInputSource;
}

export interface PluginMediaOutput {
	kind: PluginMediaOutputKind;
	mimeType: string;
	dimensions?: PluginMediaDimensions;
	fps?: number;
	durationSeconds?: number;
	videoCodec?: string;
	audioCodec?: string;
}

export interface PluginMediaArtifact extends PluginArtifactRef {
	kind: PluginMediaOutputKind;
	width?: number;
	height?: number;
	durationSeconds?: number;
}

export interface PluginMediaGenerateRequest {
	operation: "generate";
	providerId: string;
	kind: "image" | "video";
	mode: PluginMediaGenerationMode;
	prompt: string;
	modelId?: string;
	dimensions?: PluginMediaDimensions;
	aspectRatio?: string;
	resolution?: string;
	durationSeconds?: number;
	inputs?: readonly PluginMediaInput[];
}

export interface PluginMediaComposeRequest {
	operation: "compose";
	providerId: string;
	inputs: readonly PluginMediaInput[];
	output: PluginMediaOutput;
}

export interface PluginMediaTranscodeRequest {
	operation: "transcode";
	providerId: string;
	inputs: readonly PluginMediaInput[];
	output: PluginMediaOutput;
}

export type PluginMediaSubmitRequest =
	| PluginMediaGenerateRequest
	| PluginMediaComposeRequest
	| PluginMediaTranscodeRequest;

export type PluginMediaCapability =
	| {
			operation: "generate";
			kind: "image" | "video";
			modes: readonly PluginMediaGenerationMode[];
			aspectRatios?: readonly string[];
			resolutions?: readonly string[];
			durationsSeconds?: readonly number[];
	  }
	| {
			operation: "compose";
			documentMimeTypes: readonly string[];
			outputMimeTypes: readonly string[];
	  }
	| {
			operation: "transcode";
			inputMimeTypes: readonly string[];
			outputMimeTypes: readonly string[];
	  };

export interface PluginMediaProviderDescriptor {
	/** Host-qualified provider id. */
	id: string;
	displayName?: string;
	ownerId: string;
	protocolVersion: number;
	capabilities: readonly PluginMediaCapability[];
}

export type PluginMediaJob = Omit<PluginJob<PluginMediaArtifact>, "error"> & {
	error?: PluginMediaFailure;
};

/** A media input exposed to its provider without revealing its storage location. */
export interface PluginMediaProviderInput {
	id: string;
	kind: PluginMediaKind;
	mimeType?: string;
}

type ProviderRequest<Request extends PluginMediaSubmitRequest> = Omit<Request, "providerId" | "inputs"> & {
	readonly inputs: readonly PluginMediaProviderInput[];
};

export type PluginMediaProviderSubmitRequest =
	PluginMediaSubmitRequest extends infer Request
		? Request extends PluginMediaSubmitRequest
			? ProviderRequest<Request>
			: never
		: never;

export interface PluginMediaInputUploadRequest {
	url: string;
	fieldName: string;
	fileName?: string;
	fields?: Record<string, string>;
	headers?: Record<string, string>;
	timeoutMs?: number;
}

export interface PluginMediaTransferResponse<T = unknown> {
	ok: boolean;
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: T;
}

export interface PluginMediaProviderHandlerContext {
	readonly invocationId: string;
	uploadInput<T = unknown>(
		inputId: string,
		request: PluginMediaInputUploadRequest,
	): Promise<PluginMediaTransferResponse<T>>;
}

export type PluginMediaProviderArtifactSource =
	| { type: "remote-url"; url: string; headers?: Record<string, string> }
	| { type: "plugin-blob"; blobId: string }
	| { type: "workspace-file"; path: string };

export interface PluginMediaProviderArtifact {
	kind: PluginMediaOutputKind;
	mimeType?: string;
	name?: string;
	width?: number;
	height?: number;
	durationSeconds?: number;
	source: PluginMediaProviderArtifactSource;
}

export interface PluginMediaProviderJob {
	id: string;
	status: PluginMediaJob["status"];
	progress?: number;
	artifacts?: readonly PluginMediaProviderArtifact[];
	error?: PluginMediaFailure;
}

export interface PluginMediaProviderRegistration {
	id: string;
	displayName?: string;
	capabilities: readonly PluginMediaCapability[];
	submit(
		request: PluginMediaProviderSubmitRequest,
		context: PluginMediaProviderHandlerContext,
	): Promise<PluginMediaProviderJob>;
	getJob?(jobId: string, context: PluginMediaProviderHandlerContext): Promise<PluginMediaProviderJob>;
	cancelJob?(jobId: string, context: PluginMediaProviderHandlerContext): Promise<PluginMediaProviderJob>;
}

export interface PluginMediaApi {
	registerProvider(registration: PluginMediaProviderRegistration): Disposable;
	listProviders(): Promise<readonly PluginMediaProviderDescriptor[]>;
	onProvidersChanged(listener: () => void): Disposable;
	submit(request: PluginMediaSubmitRequest): Promise<PluginMediaJob>;
}
