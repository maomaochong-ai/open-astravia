import type {
	RuntimeCapabilityDefinition,
	RuntimeSnapshotAcquireContext,
	RuntimeSnapshotProvider,
	RuntimeTurnModelBindingProvider,
} from "../kernel/contracts.js";
import type { RuntimeObservationPublisher } from "../observation/contracts.js";
import type { RuntimeResources } from "../runtime-host/composed-runtime-factory.js";
import type { SessionExtensionDefinition } from "../session-extensions/contracts.js";

/** 创建单个 Agent Instance 时由基座提供的稳定身份与宿主输入。 */
export interface RuntimeAgentInstancePreparationContext {
	readonly agentId: string;
	readonly revisionId: string;
	readonly instanceId: string;
	readonly signal: AbortSignal;
	/** 已绑定 Agent revision/instance identity 的安全观测发布器。 */
	readonly observationPublisher: RuntimeObservationPublisher;
	/** Runtime Core 不解释的宿主配置；Definition 必须在不可信边界完成收窄。 */
	readonly configuration?: unknown;
}

export interface RuntimeAgentSessionPreparationContext {
	readonly agentId: string;
	readonly revisionId: string;
	readonly instanceId: string;
	readonly sessionId: string;
	readonly signal: AbortSignal;
	/** 已绑定 Agent revision/instance/session identity 的安全观测发布器。 */
	readonly observationPublisher: RuntimeObservationPublisher;
	/** Runtime Core 不解释的 Session 配置；Definition 必须在不可信边界完成收窄。 */
	readonly configuration?: unknown;
}

/**
 * 一个 Agent Session 的完整通用装配结果。
 *
 * Tool、外部能力与 Prompt 均通过 capabilities 中的 Feature/Provider/Instruction 表达；
 * Runtime Core 不认识这些能力的产品来源。
 */
export interface RuntimeAgentSessionDefinition {
	readonly capabilities: RuntimeCapabilityDefinition;
	readonly modelBindingProvider?: RuntimeTurnModelBindingProvider;
	readonly sessionExtensions?: readonly SessionExtensionDefinition[];
	dispose?(): Promise<void> | void;
}

/**
 * Runtime Core 完成能力编译后交给产品 Session Plan 的唯一运行时绑定。
 *
 * Plan 不创建第二套 Snapshot Provider，也不直接修改 Host 索引。continuation 与关闭通过此绑定回到
 * 同一个 Agent Session owner。
 */
export interface RuntimeAgentSessionActivationContext {
	readonly snapshotProvider: RuntimeSnapshotProvider;
	acquirePreviewSnapshot(): ReturnType<RuntimeSnapshotProvider["acquire"]>;
	rebindSession(sessionId: string): Promise<void>;
	dispose(): Promise<void>;
}

/**
 * Agent Definition 已准备、但尚未提交的 Session 资源图。
 *
 * 简单 Agent 可以只提供 definition；复杂 Agent 通过 activate 将同一个 Snapshot Provider 接入完整
 * RuntimeResources。dispose 同时覆盖未激活回滚和正常 Session 关闭，必须幂等或可重试。
 */
export interface RuntimeAgentSessionPlan {
	readonly definition: RuntimeAgentSessionDefinition;
	/** 在同一个 Agent Session 捕获不可变能力快照前同步外部动态目录。 */
	beforeSnapshotAcquire?(
		context?: RuntimeSnapshotAcquireContext,
	): Promise<RuntimeAgentSnapshotAdmission> | Promise<void> | RuntimeAgentSnapshotAdmission | void;
	activate?(context: RuntimeAgentSessionActivationContext): Promise<RuntimeResources> | RuntimeResources;
	onFailure?(): void;
	dispose?(): Promise<void> | void;
}

/** Optional transaction for product-side preparation; commit runs only after the entire snapshot binds. */
export interface RuntimeAgentSnapshotAdmission {
	commit(): Promise<void> | void;
	rollback(error: unknown): Promise<void> | void;
}

export type RuntimeAgentSessionPreparation = RuntimeAgentSessionDefinition | RuntimeAgentSessionPlan;

/** 一个 Agent Instance 的资源图；每个 Session 必须准备独立、未提交的 Session Plan。 */
export interface RuntimeAgentInstanceDefinition {
	prepareSession(
		context: RuntimeAgentSessionPreparationContext,
	): Promise<RuntimeAgentSessionPreparation> | RuntimeAgentSessionPreparation;
	dispose?(): Promise<void> | void;
}

/** 可动态发布的 Agent 工厂；复杂产品可以在每个 Instance 内建立独立资源图。 */
export interface RuntimeAgentDefinition {
	readonly id: string;
	createInstance(
		context: RuntimeAgentInstancePreparationContext,
	): Promise<RuntimeAgentInstanceDefinition> | RuntimeAgentInstanceDefinition;
	/** 释放 Definition revision 自身拥有、但不属于任何 Instance 的资源。 */
	dispose?(): Promise<void> | void;
}

export interface RuntimeAgentDefinitionSourceRef {
	readonly id: string;
	readonly revision: string;
}

/** 单项代码配置与 Source 全量配置最终进入 Registry 的统一候选。 */
export interface RuntimeAgentDefinitionCandidate {
	readonly source: RuntimeAgentDefinitionSourceRef;
	readonly definition: RuntimeAgentDefinition;
}

export interface RuntimeAgentRevision {
	readonly id: string;
	readonly sequence: number;
	readonly agentId: string;
	readonly source: RuntimeAgentDefinitionSourceRef;
	readonly publishedAt: number;
	readonly definition: RuntimeAgentDefinition;
}

export interface RuntimeAgentRevisionLease {
	readonly revision: RuntimeAgentRevision;
	release(): Promise<void>;
}

export type RuntimeAgentRegistryEntryState = "active" | "retired";

export interface RuntimeAgentRegistryEntrySnapshot {
	readonly agentId: string;
	readonly sourceId: string;
	readonly state: RuntimeAgentRegistryEntryState;
	readonly currentRevisionId?: string;
	readonly lastRevisionId: string;
}

export interface RuntimeAgentRegistrySnapshot {
	readonly closed: boolean;
	readonly entries: readonly RuntimeAgentRegistryEntrySnapshot[];
	readonly revisionCount: number;
	readonly retiredRevisionCount: number;
	readonly activeLeaseCount: number;
}

export interface RuntimeAgentPublishResult {
	readonly status: "published";
	readonly revision: RuntimeAgentRevision;
}

export interface RuntimeAgentSourcePublishResult {
	readonly status: "published";
	readonly revisions: readonly RuntimeAgentRevision[];
	readonly removedAgentIds: readonly string[];
}

/**
 * 宿主实现的完整配置来源。
 *
 * 文件、扩展、数据库与远端控制面在进入此端口前完成 I/O、解析、Schema 校验和组件引用解析。
 */
export interface RuntimeAgentDefinitionSource {
	readonly id: string;
	load(signal: AbortSignal): Promise<RuntimeAgentDefinitionSourceSnapshot>;
	/** 通知只表示可能发生变化；同步器仍以 load() 的完整快照为事实源。 */
	subscribe?(listener: () => void): () => void;
}

export interface RuntimeAgentDefinitionSourceSnapshot {
	readonly revision: string;
	readonly definitions: readonly RuntimeAgentDefinition[];
}

export type RuntimeAgentDefinitionSynchronizationResult =
	| {
			readonly status: "applied";
			readonly sourceRevision: string;
			readonly publishedRevisionIds: readonly string[];
			readonly removedAgentIds: readonly string[];
	  }
	| { readonly status: "unchanged"; readonly sourceRevision: string }
	| { readonly status: "superseded" };

export type RuntimeAgentDefinitionSynchronizerPhase = "idle" | "syncing" | "published" | "failed" | "closed";

export interface RuntimeAgentDefinitionSynchronizationFailure {
	readonly occurredAt: number;
	readonly errorName: string;
	readonly errorCode?: string;
}

export interface RuntimeAgentDefinitionSynchronizerSnapshot {
	readonly sourceId: string;
	readonly phase: RuntimeAgentDefinitionSynchronizerPhase;
	readonly desiredRevision?: string;
	readonly publishedRevision?: string;
	readonly failure?: RuntimeAgentDefinitionSynchronizationFailure;
}

/** 保留调用方方法绑定并冻结 Definition 的公开表面。 */
export function defineRuntimeAgent(definition: RuntimeAgentDefinition): RuntimeAgentDefinition {
	const createInstance = definition.createInstance.bind(definition);
	const dispose = definition.dispose?.bind(definition);
	return Object.freeze({
		id: definition.id,
		createInstance,
		...(dispose ? { dispose } : {}),
	});
}
