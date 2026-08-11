import type { PluginArtifactRef } from "./artifacts.js";

export type PluginJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface PluginJobProgress {
	value: number;
	phase?: string;
}

export interface PluginJobFailure {
	code: string;
	message: string;
	retryable: boolean;
}

export interface PluginJob<TArtifact extends PluginArtifactRef = PluginArtifactRef> {
	id: string;
	domain: string;
	operation: string;
	status: PluginJobStatus;
	progress?: PluginJobProgress;
	artifacts: readonly TArtifact[];
	metadata?: Readonly<Record<string, unknown>>;
	error?: PluginJobFailure;
}

export interface PluginJobRef {
	id: string;
}

export interface PluginJobWaitOptions {
	pollIntervalMs?: number;
	signal?: AbortSignal;
}

export interface PluginJobsApi {
	get(job: PluginJobRef | string): Promise<PluginJob>;
	cancel(job: PluginJobRef | string): Promise<PluginJob>;
	wait<TJob extends PluginJob = PluginJob>(
		job: TJob | PluginJobRef | string,
		options?: PluginJobWaitOptions,
	): Promise<TJob>;
}
