import type { RuntimeAgentInstance, RuntimeAgentRuntime } from "../agents/index.js";
import { RUNTIME_AGENT_ERROR_CODES, RUNTIME_AGENT_LIFECYCLE_OBSERVATION, RuntimeAgentError } from "../agents/index.js";
import type { RuntimeSessionAgentSelection } from "../contracts.js";
import { RetryableCleanup, RetryableCloseController } from "../lifecycle/retryable-cleanup.js";
import type { RuntimeObservationPublisher } from "../observation/index.js";

interface RuntimeAgentInstancePoolRecord {
	readonly instance: RuntimeAgentInstance;
	readonly poolKey?: string;
	readonly configurationRevision?: string;
	retired: boolean;
	referenceCount: number;
}

export interface RuntimeAgentInstancePoolLease {
	readonly instance: RuntimeAgentInstance;
	release(): Promise<void>;
}

export interface RuntimeAgentInstancePoolOptions {
	readonly runtime: RuntimeAgentRuntime;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

/**
 * RuntimeHost Session Backend 的 Instance 复用策略。
 *
 * 没有 instanceKey 的请求始终隔离；共享请求按 Agent、key、Definition revision 与调用方提供的配置
 * revision 复用。池不读取、不比较也不持久化产品配置正文。
 */
export class RuntimeAgentInstancePool {
	private readonly runtime: RuntimeAgentRuntime;
	private readonly observationPublisher: RuntimeObservationPublisher | undefined;
	private readonly records = new Set<RuntimeAgentInstancePoolRecord>();
	private readonly currentByKey = new Map<string, RuntimeAgentInstancePoolRecord>();
	private readonly keyTails = new Map<string, Promise<void>>();
	private readonly cleanup = new RetryableCleanup();
	private readonly closeController: RetryableCloseController;
	private cleanupPrepared = false;
	private closed = false;

	constructor(options: RuntimeAgentInstancePoolOptions) {
		this.runtime = options.runtime;
		this.observationPublisher = options.observationPublisher;
		this.closeController = new RetryableCloseController({ cleanup: () => this.disposeRecords() });
	}

	async acquire(
		selection: RuntimeSessionAgentSelection,
		signal?: AbortSignal,
	): Promise<RuntimeAgentInstancePoolLease> {
		this.assertOpen();
		const normalized = normalizeSelection(selection);
		if (!normalized.instanceKey) {
			const desiredRevisionId =
				normalized.definitionRevisionId ?? readCurrentRevisionId(this.runtime, normalized.id);
			if (normalized.definitionRevisionId !== undefined) {
				assertPinnedRevisionAvailable(this.runtime, normalized.id, normalized.definitionRevisionId);
			}
			const instance = await this.runtime.createInstance({
				agentId: normalized.id,
				instanceId: normalized.instanceId,
				configuration: normalized.instanceConfiguration,
				signal,
				observationPublisher: this.observationPublisher,
			});
			if (instance.revisionId !== desiredRevisionId) {
				await instance.close();
				throw revisionMismatchError(instance.revisionId, desiredRevisionId);
			}
			const record: RuntimeAgentInstancePoolRecord = {
				instance,
				retired: true,
				referenceCount: 1,
			};
			this.records.add(record);
			return this.createLease(record);
		}

		const poolKey = `${normalized.id}\u0000${normalized.instanceKey}`;
		return this.withKeyLock(poolKey, async () => {
			this.assertOpen();
			const desiredRevisionId =
				normalized.definitionRevisionId ?? readCurrentRevisionId(this.runtime, normalized.id);
			const current = this.currentByKey.get(poolKey);
			if (
				current &&
				!current.retired &&
				current.instance.revisionId === desiredRevisionId &&
				current.configurationRevision === normalized.instanceConfigurationRevision
			) {
				current.referenceCount += 1;
				this.recordPoolLifecycle(current, "instance.pool.reuse");
				return this.createLease(current);
			}

			if (current) {
				this.retire(
					current,
					current.instance.revisionId === desiredRevisionId ? "configuration-revision" : "definition-revision",
				);
			}
			if (normalized.definitionRevisionId) {
				assertPinnedRevisionAvailable(this.runtime, normalized.id, normalized.definitionRevisionId);
			}
			const instance = await this.runtime.createInstance({
				agentId: normalized.id,
				instanceId: normalized.instanceId,
				configuration: normalized.instanceConfiguration,
				signal,
				observationPublisher: this.observationPublisher,
			});
			if (instance.revisionId !== desiredRevisionId) {
				await instance.close();
				throw revisionMismatchError(instance.revisionId, desiredRevisionId);
			}
			const record: RuntimeAgentInstancePoolRecord = {
				instance,
				poolKey,
				configurationRevision: normalized.instanceConfigurationRevision,
				retired: false,
				referenceCount: 1,
			};
			this.records.add(record);
			this.currentByKey.set(poolKey, record);
			return this.createLease(record);
		});
	}

	dispose(): Promise<void> {
		if (!this.closed) {
			this.closed = true;
			for (const record of this.records) this.retire(record, "shutdown");
		}
		return this.closeController.run();
	}

	private createLease(record: RuntimeAgentInstancePoolRecord): RuntimeAgentInstancePoolLease {
		let referenceReleased = false;
		let releaseCompleted = false;
		return Object.freeze({
			instance: record.instance,
			release: async () => {
				if (releaseCompleted) return;
				if (!referenceReleased) {
					referenceReleased = true;
					record.referenceCount -= 1;
				}
				if (record.retired && record.referenceCount === 0) await this.closeRecord(record);
				releaseCompleted = true;
			},
		});
	}

	private retire(
		record: RuntimeAgentInstancePoolRecord,
		reason: "definition-revision" | "configuration-revision" | "shutdown",
	): void {
		if (record.retired) return;
		record.retired = true;
		this.recordPoolLifecycle(record, "instance.pool.retire", reason);
		if (record.poolKey && this.currentByKey.get(record.poolKey) === record) {
			this.currentByKey.delete(record.poolKey);
		}
		if (record.referenceCount === 0) void this.closeRecord(record).catch(() => undefined);
	}

	private async closeRecord(record: RuntimeAgentInstancePoolRecord): Promise<void> {
		await record.instance.close();
		this.records.delete(record);
		if (record.poolKey && this.currentByKey.get(record.poolKey) === record) {
			this.currentByKey.delete(record.poolKey);
		}
	}

	private recordPoolLifecycle(
		record: RuntimeAgentInstancePoolRecord,
		operation: "instance.pool.reuse" | "instance.pool.retire",
		reason?: "definition-revision" | "configuration-revision" | "shutdown",
	): void {
		this.observationPublisher
			?.scope({
				agentId: record.instance.agentId,
				revisionId: record.instance.revisionId,
				instanceId: record.instance.id,
			})
			.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, { operation, phase: "completed", ...(reason ? { reason } : {}) });
	}

	private disposeRecords(): Promise<void> {
		if (!this.cleanupPrepared) {
			this.cleanupPrepared = true;
			let phase = 0;
			for (const [index, record] of [...this.records].reverse().entries()) {
				this.cleanup.add({
					id: `instance:${index}`,
					phase: phase++,
					cleanup: () => this.closeRecord(record),
				});
			}
		}
		return this.cleanup.run("Failed to close Runtime Agent Instance pool");
	}

	private async withKeyLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.keyTails.get(key) ?? Promise.resolve();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.then(() => gate);
		this.keyTails.set(key, tail);
		await previous;
		try {
			return await operation();
		} finally {
			release();
			if (this.keyTails.get(key) === tail) this.keyTails.delete(key);
		}
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new RuntimeAgentError(RUNTIME_AGENT_ERROR_CODES.CLOSED, "Runtime Agent Instance pool is closed");
		}
	}
}

function normalizeSelection(selection: RuntimeSessionAgentSelection): RuntimeSessionAgentSelection {
	assertTrimmedId(selection.id, "Runtime Agent id");
	if (selection.instanceKey !== undefined) assertTrimmedId(selection.instanceKey, "Runtime Agent instance key");
	if (selection.instanceId !== undefined) assertTrimmedId(selection.instanceId, "Runtime Agent instance id");
	if (selection.definitionRevisionId !== undefined) {
		assertTrimmedId(selection.definitionRevisionId, "Runtime Agent Definition revision");
	}
	if (selection.instanceConfigurationRevision !== undefined) {
		assertTrimmedId(selection.instanceConfigurationRevision, "Runtime Agent instance configuration revision");
	}
	if (
		selection.instanceKey !== undefined &&
		selection.instanceConfiguration !== undefined &&
		selection.instanceConfigurationRevision === undefined
	) {
		throw new RuntimeAgentError(
			RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
			"Shared Runtime Agent Instance configuration requires instanceConfigurationRevision",
		);
	}
	return Object.freeze({ ...selection });
}

function readCurrentRevisionId(runtime: RuntimeAgentRuntime, agentId: string): string {
	const entry = runtime.registry.snapshot().entries.find((candidate) => candidate.agentId === agentId);
	if (!entry?.currentRevisionId) {
		throw new RuntimeAgentError(
			RUNTIME_AGENT_ERROR_CODES.INSTANCE_NOT_FOUND,
			`Runtime Agent Definition is not available: ${agentId}`,
		);
	}
	return entry.currentRevisionId;
}

function assertPinnedRevisionAvailable(runtime: RuntimeAgentRuntime, agentId: string, revisionId: string): void {
	if (readCurrentRevisionId(runtime, agentId) === revisionId) return;
	throw new RuntimeAgentError(
		RUNTIME_AGENT_ERROR_CODES.INSTANCE_NOT_FOUND,
		`Pinned Runtime Agent Definition revision is no longer available: ${revisionId}`,
	);
}

function revisionMismatchError(actual: string, requested: string): RuntimeAgentError {
	return new RuntimeAgentError(
		RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
		`Runtime Agent Instance revision ${actual} does not match requested revision ${requested}`,
	);
}

function assertTrimmedId(value: string, label: string): void {
	if (!value || value.trim() !== value) {
		throw new RuntimeAgentError(
			RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
			`${label} must be a non-empty trimmed string`,
		);
	}
}
