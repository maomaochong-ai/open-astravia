export type RuntimeConfigurationJsonPrimitive = string | number | boolean | null;

export type RuntimeConfigurationJsonValue =
	| RuntimeConfigurationJsonPrimitive
	| RuntimeConfigurationJsonObject
	| readonly RuntimeConfigurationJsonValue[];

export interface RuntimeConfigurationJsonObject {
	readonly [key: string]: RuntimeConfigurationJsonValue;
}

export type RuntimeConfigurationApplyMode = "next-turn" | "next-session" | "restart";

/** 可跨 Host/IPC 边界的配置说明；运行时校验由同一 Definition 的 Codec 负责。 */
export interface RuntimeConfigurationDescriptor {
	readonly title: string;
	readonly description?: string;
	readonly schema: RuntimeConfigurationJsonObject;
	readonly presentation?: RuntimeConfigurationJsonObject;
	/** JSON Pointer；Host 投影配置值时必须遮蔽这些路径。 */
	readonly sensitivePaths?: readonly string[];
}

/**
 * 把不可信 Layer 合并结果收窄为 Definition 的可信配置。
 *
 * Codec 可以由 TypeBox、Zod、Ajv 或手写解析器实现；Runtime Core 不绑定具体 schema 库。
 */
export interface RuntimeConfigurationCodec<TValue extends RuntimeConfigurationJsonObject> {
	decode(value: unknown): TValue;
}

export interface RuntimeConfigurationDefinition<
	TValue extends RuntimeConfigurationJsonObject = RuntimeConfigurationJsonObject,
> {
	readonly id: string;
	readonly schemaVersion: number;
	readonly descriptor: RuntimeConfigurationDescriptor;
	readonly codec: RuntimeConfigurationCodec<TValue>;
	readonly defaultValue: TValue;
	readonly apply: RuntimeConfigurationApplyMode;
	dispose?(): Promise<void> | void;
}

export interface RuntimeConfigurationSourceRef {
	readonly id: string;
	readonly revision: string;
}

export interface RuntimeConfigurationDefinitionCandidate {
	readonly source: RuntimeConfigurationSourceRef;
	readonly definition: RuntimeConfigurationDefinition;
}

export interface RuntimeConfigurationDefinitionSource {
	readonly id: string;
	load(signal: AbortSignal): Promise<RuntimeConfigurationDefinitionSourceSnapshot>;
	subscribe?(listener: () => void): () => void;
}

export interface RuntimeConfigurationDefinitionSourceSnapshot {
	readonly revision: string;
	readonly definitions: readonly RuntimeConfigurationDefinition[];
}

export type RuntimeConfigurationDefinitionSynchronizationResult =
	| {
			readonly status: "applied";
			readonly sourceRevision: string;
			readonly publishedRevisionIds: readonly string[];
			readonly removedConfigurationIds: readonly string[];
	  }
	| { readonly status: "unchanged"; readonly sourceRevision: string }
	| { readonly status: "superseded" };

export type RuntimeConfigurationDefinitionSynchronizerPhase = "idle" | "syncing" | "published" | "failed" | "closed";

export interface RuntimeConfigurationDefinitionSynchronizationFailure {
	readonly occurredAt: number;
	readonly errorName: string;
	readonly errorCode?: string;
}

export interface RuntimeConfigurationDefinitionSynchronizerSnapshot {
	readonly sourceId: string;
	readonly phase: RuntimeConfigurationDefinitionSynchronizerPhase;
	readonly desiredRevision?: string;
	readonly publishedRevision?: string;
	readonly failure?: RuntimeConfigurationDefinitionSynchronizationFailure;
}

export interface RuntimeConfigurationRevision {
	readonly id: string;
	readonly sequence: number;
	readonly configurationId: string;
	readonly source: RuntimeConfigurationSourceRef;
	readonly publishedAt: number;
	readonly definition: RuntimeConfigurationDefinition;
}

export interface RuntimeConfigurationRevisionLease {
	readonly revision: RuntimeConfigurationRevision;
	release(): Promise<void>;
}

export type RuntimeConfigurationRegistryEntryState = "active" | "retired";

export interface RuntimeConfigurationRegistryEntrySnapshot {
	readonly configurationId: string;
	readonly sourceId: string;
	readonly state: RuntimeConfigurationRegistryEntryState;
	readonly currentRevisionId?: string;
	readonly lastRevisionId: string;
}

export interface RuntimeConfigurationRegistrySnapshot {
	readonly version: number;
	readonly closed: boolean;
	readonly entries: readonly RuntimeConfigurationRegistryEntrySnapshot[];
	readonly revisionCount: number;
	readonly retiredRevisionCount: number;
	readonly activeLeaseCount: number;
}

/** Resolver 原子持有的一组当前 Definition revision。 */
export interface RuntimeConfigurationDefinitionSetSnapshot {
	readonly version: number;
	readonly revisions: readonly RuntimeConfigurationRevision[];
}

export interface RuntimeConfigurationDefinitionSetLease {
	readonly snapshot: RuntimeConfigurationDefinitionSetSnapshot;
	release(): Promise<void>;
}

export interface RuntimeConfigurationPublishResult {
	readonly status: "published";
	readonly revision: RuntimeConfigurationRevision;
}

export interface RuntimeConfigurationSourcePublishResult {
	readonly status: "published";
	readonly revisions: readonly RuntimeConfigurationRevision[];
	readonly removedConfigurationIds: readonly string[];
}

/** Host 定义逻辑 Layer；Runtime Core 不解释 id，也不拥有持久化。 */
export interface RuntimeConfigurationLayerSnapshot {
	readonly id: string;
	readonly revision: string;
	readonly precedence: number;
	readonly values: Readonly<Record<string, RuntimeConfigurationJsonObject>>;
}

export type RuntimeConfigurationDiagnosticCode = "invalid-layer-value" | "unknown-definition";

export interface RuntimeConfigurationDiagnostic {
	readonly code: RuntimeConfigurationDiagnosticCode;
	readonly configurationId: string;
	readonly layerId: string;
	readonly errorName?: string;
	readonly errorCode?: string;
}

export interface ResolvedRuntimeConfigurationEntry {
	readonly configurationId: string;
	readonly definitionRevisionId: string;
	readonly definitionSourceId: string;
	readonly schemaVersion: number;
	readonly apply: RuntimeConfigurationApplyMode;
	readonly descriptor: RuntimeConfigurationDescriptor;
	readonly defaultValue: RuntimeConfigurationJsonObject;
	readonly value: RuntimeConfigurationJsonObject;
	readonly appliedLayerIds: readonly string[];
}

/** Host/UI 可安全序列化的目录项；敏感路径已从 value/defaultValue 中移除。 */
export interface RuntimeConfigurationCatalogEntry {
	readonly configurationId: string;
	readonly definitionRevisionId: string;
	readonly definitionSourceId: string;
	readonly schemaVersion: number;
	readonly apply: RuntimeConfigurationApplyMode;
	readonly descriptor: RuntimeConfigurationDescriptor;
	readonly defaultValue: RuntimeConfigurationJsonObject;
	readonly value: RuntimeConfigurationJsonObject;
	readonly redactedPaths: readonly string[];
	readonly appliedLayerIds: readonly string[];
	readonly diagnostics: readonly RuntimeConfigurationDiagnostic[];
}

export interface RuntimeConfigurationCatalogSnapshot {
	readonly snapshotId: string;
	readonly definitionVersion: number;
	readonly entries: readonly RuntimeConfigurationCatalogEntry[];
}

export interface RuntimeConfigurationSnapshot {
	readonly id: string;
	readonly definitionVersion: number;
	readonly layers: readonly Pick<RuntimeConfigurationLayerSnapshot, "id" | "revision" | "precedence">[];
	readonly entries: readonly ResolvedRuntimeConfigurationEntry[];
	readonly diagnostics: readonly RuntimeConfigurationDiagnostic[];
	get(configurationId: string): RuntimeConfigurationJsonObject | undefined;
	read<TValue extends RuntimeConfigurationJsonObject>(
		definition: RuntimeConfigurationDefinition<TValue>,
	): TValue | undefined;
}

export interface RuntimeConfigurationSnapshotLease {
	readonly snapshot: RuntimeConfigurationSnapshot;
	release(): Promise<void>;
}

/** 同步捕获当前 published configuration generation；适用于 Turn admission 等原子绑定边界。 */
export interface RuntimeConfigurationSnapshotAcquireContext {
	/** 可选的宿主作用域（例如 Session）；不同 scope 可复用相同的 operation id。 */
	readonly scopeId?: string;
	/** 同一逻辑绑定（例如一个 Turn）的全部消费者必须使用相同 id。 */
	readonly bindingId: string;
	readonly signal?: AbortSignal;
}

export interface RuntimeConfigurationSnapshotSource {
	acquire(context?: RuntimeConfigurationSnapshotAcquireContext): RuntimeConfigurationSnapshotLease;
}

export interface RuntimeConfigurationLayerSourceSnapshot {
	readonly revision: string;
	readonly layers: readonly RuntimeConfigurationLayerSnapshot[];
}

export interface RuntimeConfigurationLayerSource {
	readonly id: string;
	load(signal: AbortSignal): Promise<RuntimeConfigurationLayerSourceSnapshot>;
	subscribe?(listener: () => void): () => void;
}

export type RuntimeConfigurationLayerSourcePublishResult =
	| {
			readonly status: "published";
			readonly sourceRevision: string;
			readonly layerIds: readonly string[];
			readonly removedLayerIds: readonly string[];
	  }
	| { readonly status: "unchanged"; readonly sourceRevision: string };

export interface RuntimeConfigurationLayerRegistrySourceSnapshot {
	readonly sourceId: string;
	readonly sourceRevision: string;
	readonly layerIds: readonly string[];
}

export interface RuntimeConfigurationLayerRegistrySnapshot {
	readonly version: number;
	readonly closed: boolean;
	readonly sources: readonly RuntimeConfigurationLayerRegistrySourceSnapshot[];
	readonly layers: readonly RuntimeConfigurationLayerSnapshot[];
}

export interface RuntimeConfigurationCenterSnapshot {
	readonly definitions: RuntimeConfigurationRegistrySnapshot;
	readonly layers: RuntimeConfigurationLayerRegistrySnapshot;
}
