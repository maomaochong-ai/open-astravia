import type { PromptCacheDiagnostics, Usage } from "../protocol/index.js";

export type ProviderObservationCapture = "metadata" | "payload" | "wire";

export type ProviderObservationValue =
	| null
	| boolean
	| number
	| string
	| readonly ProviderObservationValue[]
	| { readonly [key: string]: ProviderObservationValue };

export interface ProviderWireObservation {
	readonly request: {
		readonly url: string;
		readonly method: string;
		readonly headers: Readonly<Record<string, string>>;
		readonly body?: ProviderObservationValue;
	};
	response?: {
		readonly status: number;
		readonly statusText: string;
		readonly headers: Readonly<Record<string, string>>;
		body?: ProviderObservationValue;
	};
	error?: ProviderObservationError;
}

export interface ProviderObservationError {
	readonly name: string;
	readonly message: string;
}

export interface ProviderCallObservation {
	readonly schemaVersion: 1;
	readonly callId: string;
	readonly startedAt: string;
	readonly durationMs: number;
	readonly capture: ProviderObservationCapture;
	readonly model: {
		readonly api: string;
		readonly provider: string;
		readonly id: string;
	};
	readonly sessionId?: string;
	readonly request: {
		readonly promptCache: PromptCacheDiagnostics;
		readonly messageCount: number;
		readonly toolCount: number;
		readonly payload?: ProviderObservationValue;
		readonly wire?: readonly ProviderWireObservation[];
	};
	readonly response?: {
		readonly stopReason: string;
		readonly usage: Usage;
		readonly metadata?: ProviderObservationValue;
	};
	readonly error?: ProviderObservationError;
}

export interface ProviderObservationSink {
	record(observation: ProviderCallObservation): void | Promise<void>;
}
