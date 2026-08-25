import type { FeatureCompiler } from "../kernel/index.js";
import type { RuntimeObservationPort } from "../observation/index.js";
import type { RuntimeAgentRegistrySnapshot } from "./contracts.js";
import type { RuntimeAgentRegistry } from "./registry.js";

export interface RuntimeAgentHostOptions {
	readonly registry?: RuntimeAgentRegistry;
	readonly createId?: (scope: "instance" | "session") => string;
	readonly createFeatureCompiler?: () => FeatureCompiler;
	readonly observationPort?: RuntimeObservationPort;
}

export interface RuntimeAgentInstanceCreateOptions {
	readonly agentId: string;
	readonly instanceId?: string;
	readonly configuration?: unknown;
	readonly signal?: AbortSignal;
}

export interface RuntimeAgentSessionCreateOptions {
	readonly sessionId?: string;
	readonly configuration?: unknown;
	readonly signal?: AbortSignal;
}

export type RuntimeAgentSessionRolloutResult =
	| { readonly status: "applied"; readonly revisionId: string; readonly snapshotId: string }
	| { readonly status: "unchanged"; readonly revisionId: string };

export interface RuntimeAgentInstanceSnapshot {
	readonly id: string;
	readonly agentId: string;
	readonly revisionId: string;
	readonly sessionIds: readonly string[];
}

export interface RuntimeAgentHostSnapshot {
	readonly closed: boolean;
	readonly registry: RuntimeAgentRegistrySnapshot;
	readonly instances: readonly RuntimeAgentInstanceSnapshot[];
}
