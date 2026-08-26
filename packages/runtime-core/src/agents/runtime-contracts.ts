import type { FeatureCompiler } from "../kernel/index.js";
import type { RuntimeObservationPort, RuntimeObservationPublisher } from "../observation/index.js";
import type { RuntimeAgentRegistrySnapshot } from "./contracts.js";
import type { RuntimeAgentRegistry } from "./registry.js";

/** Runtime Agent 控制面的独立装配选项；嵌入 RuntimeHost 时由 Host 注入共享 Observation Publisher。 */
export interface RuntimeAgentRuntimeOptions {
	readonly registry?: RuntimeAgentRegistry;
	readonly createId?: (scope: "instance" | "session") => string;
	readonly createFeatureCompiler?: () => FeatureCompiler;
	/** 独立模块可直接提供 Port；嵌入 RuntimeHost 观测树时应提供已经 scope 的父级 Publisher。 */
	readonly observationPort?: RuntimeObservationPort;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

export interface RuntimeAgentInstanceCreateOptions {
	readonly agentId: string;
	readonly instanceId?: string;
	readonly configuration?: unknown;
	readonly signal?: AbortSignal;
	/** 模块级观测入口；事件仍携带 Runtime 强制绑定的 Agent/Instance identity。 */
	readonly observationPublisher?: RuntimeObservationPublisher;
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

export interface RuntimeAgentRuntimeSnapshot {
	readonly closed: boolean;
	readonly registry: RuntimeAgentRegistrySnapshot;
	readonly instances: readonly RuntimeAgentInstanceSnapshot[];
}
