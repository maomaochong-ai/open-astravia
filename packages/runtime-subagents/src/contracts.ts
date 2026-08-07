export type SubagentTypeId = string;

export type SubagentStatus = "queued" | "pending" | "running" | "completed" | "failed" | "interrupted";

export interface SubagentTodoProgress {
	readonly done: number;
	readonly total: number;
}

export interface SubagentUsageSnapshot {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly costTotal: number;
}

export interface SubagentSnapshot {
	readonly id: string;
	readonly taskName: string;
	readonly path: string;
	readonly agentType: SubagentTypeId;
	readonly status: SubagentStatus;
	readonly task: string;
	readonly parentSessionId: string;
	readonly sessionFile?: string;
	readonly startedAt: number;
	readonly endedAt?: number;
	readonly finalText?: string;
	readonly errorMessage?: string;
	readonly usage: SubagentUsageSnapshot;
	readonly generation: number;
	readonly todoProgress?: SubagentTodoProgress;
	readonly title?: string;
}

export interface SubagentSpawnRequest {
	readonly taskName: string;
	readonly message: string;
	readonly agentType: SubagentTypeId;
	readonly todos?: readonly string[];
	readonly title?: string;
}

export interface SubagentTypeDefinition<TProfile = unknown> {
	readonly id: SubagentTypeId;
	readonly label: string;
	readonly description: string;
	readonly profile: TProfile;
}

export interface SubagentTypeRegistryLike<TProfile = unknown> {
	get(id: SubagentTypeId): SubagentTypeDefinition<TProfile> | undefined;
	list(): readonly SubagentTypeDefinition<TProfile>[];
	ids(): readonly SubagentTypeId[];
}

export interface SubagentChildEvent {
	readonly type: "agent_start" | "agent_end";
}

export interface SubagentChildHandle {
	readonly sessionId: string;
	readonly sessionFile?: string;
	prompt(text: string): Promise<void>;
	sendMessage(text: string): Promise<void>;
	followUp(text: string): Promise<void>;
	abort(): void;
	waitForIdle(): Promise<void>;
	isStreaming(): boolean;
	getLastAssistantText(): string | undefined;
	readUsage?(): SubagentUsageSnapshot;
	dispose(): void | Promise<void>;
	subscribe(listener: (event: SubagentChildEvent) => void): () => void;
	setTodos?(contents: readonly string[]): void;
	getTodoProgress?(): SubagentTodoProgress;
	subscribeTodos?(listener: (progress: SubagentTodoProgress) => void): () => void;
}

export interface SubagentChildFactory<TProfile = unknown> {
	create(
		request: SubagentSpawnRequest,
		type: SubagentTypeDefinition<TProfile>,
		signal?: AbortSignal,
	): Promise<SubagentChildHandle>;
	reopen?(
		snapshot: SubagentSnapshot,
		type: SubagentTypeDefinition<TProfile>,
		signal?: AbortSignal,
	): Promise<SubagentChildHandle>;
}

export interface SubagentStartLifecycleInput {
	readonly id: string;
	readonly agentType: string;
	readonly message: string;
}

export interface SubagentStartLifecycleResult {
	readonly message?: string;
	readonly blockedReason?: string;
}

export interface SubagentStopLifecycleInput {
	readonly id: string;
	readonly agentType: string;
	readonly generation: number;
	readonly stopHookActive: boolean;
	readonly lastAssistantText?: string;
	readonly sessionFile?: string;
	readonly interrupted: boolean;
}

export interface SubagentStopLifecycleResult {
	readonly continuation?: string;
}

export interface SubagentLifecycle {
	beforeStart?(input: SubagentStartLifecycleInput): Promise<SubagentStartLifecycleResult | undefined>;
	beforeStop?(input: SubagentStopLifecycleInput): Promise<SubagentStopLifecycleResult | undefined>;
}

export interface SubagentDeliveryMarker {
	readonly id: string;
	readonly generation: number;
}

export interface SubagentRecoveryState {
	readonly agents: readonly SubagentSnapshot[];
	readonly delivered: readonly SubagentDeliveryMarker[];
}

export interface SubagentCoordinatorOptions<TProfile = unknown> {
	readonly factory: SubagentChildFactory<TProfile>;
	readonly typeRegistry: SubagentTypeRegistryLike<TProfile>;
	readonly parentSessionId: string;
	readonly maxConcurrent?: number;
	readonly lifecycle?: SubagentLifecycle;
	readonly onNotify?: (agents: readonly SubagentSnapshot[]) => void;
	readonly onUpdate?: (agents: readonly SubagentSnapshot[]) => void;
	readonly onDeliveryClaimed?: (marker: SubagentDeliveryMarker) => void;
	readonly clock?: { now(): number };
	readonly idGenerator?: { next(): string };
	readonly notificationDelayMs?: number;
}

export interface SubagentWaitOptions {
	readonly targets?: readonly string[];
	readonly timeoutMs?: number;
}

export interface SubagentWaitResult {
	readonly timedOut: boolean;
	readonly agents: readonly SubagentSnapshot[];
}

/** Product tools depend on this control contract, never on a concrete coordinator. */
export interface SubagentCoordinatorPort {
	list(): readonly SubagentSnapshot[];
	get(target: string): SubagentSnapshot | undefined;
	clearFinished(): number;
	registeredTypeIds(): readonly SubagentTypeId[];
	spawn(request: SubagentSpawnRequest): Promise<SubagentSnapshot>;
	spawnMany(requests: readonly SubagentSpawnRequest[]): readonly SubagentSnapshot[];
	sendMessage(target: string, message: string): Promise<SubagentSnapshot>;
	followUp(target: string, message: string): Promise<SubagentSnapshot>;
	interrupt(target: string): SubagentSnapshot;
	wait(options?: SubagentWaitOptions): Promise<SubagentWaitResult>;
	dispose(): Promise<void>;
}

export const TASK_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
export const SUBAGENT_FINAL_TEXT_LIMIT = 16 * 1024;

export function isValidTaskName(name: string): boolean {
	return name.length > 0 && name !== "root" && TASK_NAME_PATTERN.test(name);
}

export function taskPath(taskName: string): string {
	return `/root/${taskName}`;
}

export function emptyUsage(): SubagentUsageSnapshot {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 };
}

export function clipFinalText(text: string | undefined, limit = SUBAGENT_FINAL_TEXT_LIMIT): string | undefined {
	if (text === undefined || text.length <= limit) return text;
	return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars; see child transcript]`;
}
