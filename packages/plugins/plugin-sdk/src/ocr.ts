import type {
	OcrBlock,
	OcrErrorCode,
	OcrItemResult,
	OcrProviderDescriptor,
	OcrRequest as DomainOcrRequest,
	OcrResult,
} from "@vetta/capability-sdk";
import type { Disposable } from "./disposable.js";

export type { OcrBlock, OcrErrorCode, OcrItemResult, OcrProviderDescriptor, OcrResult };

export type OcrInput = {
	id?: string;
	mimeType?: string;
	source:
		| { type: "plugin-blob"; blobId: string }
		| { type: "workspace-file"; path: string };
};

/** Public consumer request. Ownership and storage namespaces are supplied by the host. */
export type OcrRequest = Omit<DomainOcrRequest, "ownerId" | "providerId" | "inputs"> & {
	readonly inputs: readonly OcrInput[];
};

export type OcrProgress = {
	phase: "queued" | "uploading" | "processing" | "finalizing";
	completed: number;
	total: number;
	itemId?: string;
};

export type OcrProviderRequest = Omit<DomainOcrRequest, "ownerId" | "providerId" | "inputs"> & {
	readonly inputs: readonly OcrProviderInput[];
};

export type OcrProviderInput = {
	id: string;
	mimeType?: string;
};

export type OcrUploadRequest = {
	url: string;
	fieldName: string;
	fileName?: string;
	fields?: Record<string, string>;
	headers?: Record<string, string>;
	timeoutMs?: number;
};

export type OcrTransferResponse<T = unknown> = {
	ok: boolean;
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: T;
};

export type OcrProviderContext = {
	readonly signal: AbortSignal;
	readonly invocationId: string;
	getInputUrl(inputId: string): Promise<string>;
	uploadInput<T = unknown>(inputId: string, request: OcrUploadRequest): Promise<OcrTransferResponse<T>>;
	reportProgress(event: OcrProgress): void;
};

export type OcrProviderRegistration = {
	readonly id: string;
	readonly displayName: string;
	readonly protocolVersion: 1;
	readonly processing: OcrProviderDescriptor["processing"];
	readonly execution: OcrProviderDescriptor["execution"];
	readonly input: OcrProviderDescriptor["input"];
	readonly output: OcrProviderDescriptor["output"];
	readonly network?: OcrProviderDescriptor["network"];
	readonly configuration?: OcrProviderDescriptor["configuration"];
	recognize(request: OcrProviderRequest, context: OcrProviderContext): Promise<OcrProviderResult>;
	dispose?(): void | Promise<void>;
};

export type OcrProviderResult = Omit<OcrResult, "providerId">;

export type OcrClient = {
	registerProvider(registration: OcrProviderRegistration): Disposable;
	listProviders(): Promise<readonly OcrProviderDescriptor[]>;
	onProvidersChanged(listener: () => void): Disposable;
	recognize(request: OcrRequest, options?: {
		providerId?: string;
		signal?: AbortSignal;
		onProgress?: (event: OcrProgress) => void;
	}): Promise<OcrResult>;
};
