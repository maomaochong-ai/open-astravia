export type PluginMediaKind = "image" | "video";
export type PluginMediaReferenceKind = PluginMediaKind | "audio";

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

export type PluginMediaReferenceSource =
	| { type: "plugin-blob"; blobId: string }
	| { type: "workspace-file"; path: string };

export interface PluginMediaReference {
	id?: string;
	kind: PluginMediaReferenceKind;
	mimeType?: string;
	source: PluginMediaReferenceSource;
}

/** Host-managed generated media. Persist it with saveArtifact before releasing it. */
export interface PluginMediaArtifact {
	id: string;
	kind: PluginMediaKind;
	mimeType: string;
	sizeBytes: number;
	width?: number;
	height?: number;
	durationSeconds?: number;
}

export type PluginMediaArtifactDestination =
	| { type: "plugin-blob"; blobId?: string }
	| { type: "workspace-file"; path: string };

export type PluginMediaSavedArtifact =
	| {
			type: "plugin-blob";
			blobId: string;
			url: string;
			mimeType: string;
			sizeBytes: number;
	  }
	| {
			type: "workspace-file";
			path: string;
			mimeType: string;
			sizeBytes: number;
	  };

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
	displayName?: string;
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

/** A media reference exposed to its provider without revealing its storage location. */
export interface PluginMediaProviderReference {
	id: string;
	kind: PluginMediaReferenceKind;
	mimeType?: string;
}

export interface PluginMediaReferenceUploadRequest {
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
	uploadReference<T = unknown>(
		referenceId: string,
		request: PluginMediaReferenceUploadRequest,
	): Promise<PluginMediaTransferResponse<T>>;
}

export type PluginMediaProviderCreateJobRequest = Omit<PluginMediaCreateJobRequest, "providerId" | "references"> & {
	readonly references: readonly PluginMediaProviderReference[];
};

export interface PluginMediaProviderArtifact {
	kind: PluginMediaKind;
	mimeType?: string;
	width?: number;
	height?: number;
	durationSeconds?: number;
	source: {
		type: "remote-url";
		url: string;
		headers?: Record<string, string>;
	};
}

export interface PluginMediaProviderJob {
	id: string;
	status: PluginMediaJobStatus;
	progress?: number;
	artifacts?: readonly PluginMediaProviderArtifact[];
	error?: PluginMediaFailure;
}

export interface PluginMediaProviderRegistration {
	id: string;
	displayName?: string;
	capabilities: readonly PluginMediaCapability[];
	createJob(
		request: PluginMediaProviderCreateJobRequest,
		context: PluginMediaProviderHandlerContext,
	): Promise<PluginMediaProviderJob>;
	getJob?(jobId: string, context: PluginMediaProviderHandlerContext): Promise<PluginMediaProviderJob>;
	cancelJob?(jobId: string, context: PluginMediaProviderHandlerContext): Promise<PluginMediaProviderJob>;
}

export interface PluginMediaApi {
	registerProvider(registration: PluginMediaProviderRegistration): Disposable;
	listProviders(): Promise<readonly PluginMediaProviderDescriptor[]>;
	onProvidersChanged(listener: () => void): Disposable;
	createJob(request: PluginMediaCreateJobRequest): Promise<PluginMediaJob>;
	getJob(job: PluginMediaJobRef): Promise<PluginMediaJob>;
	cancelJob(job: PluginMediaJobRef): Promise<PluginMediaJob>;
	saveArtifact(request: {
		artifactId: string;
		destination: PluginMediaArtifactDestination;
	}): Promise<PluginMediaSavedArtifact>;
	releaseArtifact(artifactId: string): Promise<void>;
}
import type { Disposable } from "./disposable.js";
