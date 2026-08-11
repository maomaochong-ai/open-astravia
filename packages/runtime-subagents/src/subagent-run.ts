import type {
	SubagentChildFactory,
	SubagentChildHandle,
	SubagentLifecycle,
	SubagentSnapshot,
	SubagentSpawnRequest,
	SubagentTypeDefinition,
} from "./contracts.js";
import { cloneSnapshot, isActiveStatus, isTerminalStatus, mutableSnapshot } from "./snapshot.js";

const MAX_STOP_CONTINUATIONS = 8;

export interface SubagentRunHooks<TProfile> {
	rekey(run: SubagentRun<TProfile>, previousId: string, nextId: string): void;
	onChanged(): void;
	onTerminal(snapshot: SubagentSnapshot): void;
	onSettled(run: SubagentRun<TProfile>): void;
	onError(error: unknown, operation: string): void;
}

export interface SubagentRunOptions<TProfile> {
	readonly factory: SubagentChildFactory<TProfile>;
	readonly lifecycle?: SubagentLifecycle;
	readonly clock: { now(): number };
	readonly signal: AbortSignal;
	readonly formatInitialMessage: (snapshot: SubagentSnapshot, message: string) => string;
	readonly hooks: SubagentRunHooks<TProfile>;
}

export class SubagentRun<TProfile> {
	private readonly snapshot;
	private handle?: SubagentChildHandle;
	private unsubscribe?: () => void;
	private todoUnsubscribe?: () => void;
	private queuedRequest?: SubagentSpawnRequest;
	private startLifecycleCompleted: boolean;
	private stopContinuationCount = 0;
	private executionEpoch: number;
	private endingEpoch: number | undefined;
	private settled = false;
	private settlement: Promise<void>;
	private resolveSettlement: () => void = () => {};
	private disposePromise: Promise<void> | undefined;
	private disposed = false;

	constructor(
		snapshot: SubagentSnapshot,
		queuedRequest: SubagentSpawnRequest | undefined,
		private readonly options: SubagentRunOptions<TProfile>,
	) {
		this.snapshot = mutableSnapshot(snapshot);
		this.queuedRequest = queuedRequest;
		this.startLifecycleCompleted = snapshot.sessionFile !== undefined;
		this.executionEpoch = snapshot.status === "queued" ? 0 : 1;
		this.settlement = this.createSettlement();
		if (isTerminalStatus(snapshot.status)) {
			this.settled = true;
			this.resolveSettlement();
		}
	}

	get id(): string {
		return this.snapshot.id;
	}

	get taskName(): string {
		return this.snapshot.taskName;
	}

	get agentType(): string {
		return this.snapshot.agentType;
	}

	get status(): SubagentSnapshot["status"] {
		return this.snapshot.status;
	}

	get hasLiveHandle(): boolean {
		return this.handle !== undefined;
	}

	get endedAt(): number | undefined {
		return this.snapshot.endedAt;
	}

	readSnapshot(): SubagentSnapshot {
		return cloneSnapshot(this.snapshot);
	}

	activateQueued(): void {
		if (this.snapshot.status !== "queued") throw new Error(`Subagent "${this.taskName}" is not queued`);
		this.executionEpoch += 1;
		this.snapshot.status = "pending";
		this.options.hooks.onChanged();
	}

	async start(type: SubagentTypeDefinition<TProfile>): Promise<void> {
		const request = this.queuedRequest;
		if (!request) throw new Error(`Subagent "${this.taskName}" has no queued request`);
		this.queuedRequest = undefined;
		const epoch = this.executionEpoch;
		const handle = await this.options.factory.create(request, type, this.options.signal);
		if (!this.isCurrent(epoch) || this.disposed) {
			await this.disposeForeignHandle(handle, "dispose stale created child");
			throw new Error(
				this.disposed || this.options.signal.aborted
					? "Parent session disposed during subagent spawn"
					: "Subagent changed during spawn",
			);
		}
		try {
			this.attachHandle(handle);
		} catch (error) {
			await this.disposeForeignHandle(handle, "dispose child with conflicting identity");
			throw error;
		}
		handle.setTodos?.(request.todos ?? []);

		const lifecycle = await this.options.lifecycle?.beforeStart?.({
			id: this.snapshot.id,
			agentType: this.snapshot.agentType,
			message: request.message,
		});
		if (!this.isCurrent(epoch)) return;
		if (lifecycle?.blockedReason) throw new SubagentStartBlockedError(lifecycle.blockedReason);
		this.startLifecycleCompleted = true;
		void this.runPrompt(
			epoch,
			this.options.formatInitialMessage(this.readSnapshot(), lifecycle?.message ?? request.message),
		);
	}

	async sendMessage(message: string): Promise<void> {
		if (!this.handle) throw new Error(`Subagent "${this.taskName}" has no live session`);
		await this.handle.sendMessage(message);
	}

	async followUpActive(message: string): Promise<void> {
		if (!this.handle) throw new Error(`Subagent "${this.taskName}" has no live session`);
		await this.handle.followUp(message);
		if (isActiveStatus(this.snapshot.status)) {
			this.snapshot.task = message;
			this.options.hooks.onChanged();
		}
	}

	async resume(message: string, type: SubagentTypeDefinition<TProfile>): Promise<void> {
		if (!isTerminalStatus(this.snapshot.status)) throw new Error(`Subagent "${this.taskName}" is still active`);
		await this.waitForSettled();
		this.beginExecution(message);
		const epoch = this.executionEpoch;
		if (!this.handle) {
			const reopen = this.options.factory.reopen;
			if (!reopen) throw new Error(`Subagent "${this.id}" is not live and reopen is not supported`);
			const handle = await reopen(this.readSnapshot(), type, this.options.signal);
			if (!this.isCurrent(epoch) || this.disposed) {
				await this.disposeForeignHandle(handle, "dispose stale reopened child");
				throw new Error(
					this.disposed || this.options.signal.aborted
						? "Parent session disposed during subagent reopen"
						: "Subagent changed during reopen",
				);
			}
			try {
				this.attachHandle(handle);
			} catch (error) {
				await this.disposeForeignHandle(handle, "dispose reopened child with conflicting identity");
				throw error;
			}
		}
		void this.runPrompt(epoch, message);
	}

	interrupt(): SubagentSnapshot {
		if (isTerminalStatus(this.snapshot.status)) return this.readSnapshot();
		const epoch = this.executionEpoch;
		this.executionEpoch += 1;
		const handle = this.handle;
		this.queuedRequest = undefined;
		this.snapshot.finalText = handle?.getLastAssistantText() ?? this.snapshot.finalText;
		this.updateUsage();
		this.commitTerminal("interrupted");
		this.options.hooks.onTerminal(this.readSnapshot());
		void this.settleInterruptedExecution(epoch, handle);
		return this.readSnapshot();
	}

	async fail(error: unknown, prefix?: string): Promise<void> {
		if (isTerminalStatus(this.snapshot.status)) return;
		this.executionEpoch += 1;
		this.queuedRequest = undefined;
		this.snapshot.finalText = this.handle?.getLastAssistantText() ?? this.snapshot.finalText;
		this.updateUsage();
		this.commitTerminal("failed", prefix ? `${prefix}: ${errorMessage(error)}` : errorMessage(error));
		this.options.hooks.onTerminal(this.readSnapshot());
		await this.releaseHandle();
		this.markSettled();
	}

	waitForSettled(): Promise<void> {
		return this.settlement;
	}

	releaseHandle(): Promise<void> {
		this.detachSubscriptions();
		const handle = this.handle;
		this.handle = undefined;
		if (!handle) return Promise.resolve();
		return this.disposeForeignHandle(handle, `dispose child "${this.taskName}"`);
	}

	dispose(): Promise<void> {
		if (this.disposePromise) return this.disposePromise;
		this.disposePromise = this.performDispose();
		return this.disposePromise;
	}

	private async performDispose(): Promise<void> {
		this.disposed = true;
		if (!isTerminalStatus(this.snapshot.status)) this.interrupt();
		await this.waitForSettled();
		await this.releaseHandle();
	}

	private beginExecution(message: string): void {
		this.executionEpoch += 1;
		this.stopContinuationCount = 0;
		this.endingEpoch = undefined;
		this.snapshot.status = "running";
		this.snapshot.task = message;
		this.snapshot.endedAt = undefined;
		this.snapshot.errorMessage = undefined;
		this.beginSettlement();
		this.options.hooks.onChanged();
	}

	private attachHandle(handle: SubagentChildHandle): void {
		const previousId = this.snapshot.id;
		this.options.hooks.rekey(this, previousId, handle.sessionId);
		this.snapshot.id = handle.sessionId;
		this.snapshot.sessionFile = handle.sessionFile;
		this.handle = handle;
		this.unsubscribe = handle.subscribe((event) => {
			if (event.type === "agent_start" && this.snapshot.status === "pending") {
				this.snapshot.status = "running";
				this.options.hooks.onChanged();
			}
			if (event.type === "agent_end") void this.onChildAgentEnd(this.executionEpoch);
		});
		if (handle.getTodoProgress) {
			this.snapshot.todoProgress = handle.getTodoProgress();
			this.todoUnsubscribe = handle.subscribeTodos?.((progress) => {
				this.snapshot.todoProgress = { ...progress };
				this.options.hooks.onChanged();
			});
		}
	}

	private async runPrompt(epoch: number, message: string): Promise<void> {
		const handle = this.handle;
		if (!handle || !this.isCurrent(epoch)) return;
		try {
			this.snapshot.status = "running";
			this.options.hooks.onChanged();
			await handle.prompt(message);
			if (this.isCurrent(epoch) && !handle.isStreaming() && this.snapshot.status === "running") {
				await this.onChildAgentEnd(epoch);
			}
		} catch (error) {
			if (this.isCurrent(epoch) && isActiveStatus(this.snapshot.status)) await this.fail(error);
		}
	}

	private async onChildAgentEnd(epoch: number): Promise<void> {
		if (!this.isCurrent(epoch) || !isActiveStatus(this.snapshot.status) || this.endingEpoch === epoch) return;
		this.endingEpoch = epoch;
		try {
			this.snapshot.finalText = this.handle?.getLastAssistantText();
			this.updateUsage();
			let continuation: string | undefined;
			if (this.startLifecycleCompleted) {
				try {
					continuation = (
						await this.options.lifecycle?.beforeStop?.({
							id: this.snapshot.id,
							agentType: this.snapshot.agentType,
							generation: this.snapshot.generation,
							stopHookActive: this.stopContinuationCount > 0,
							lastAssistantText: this.snapshot.finalText,
							sessionFile: this.snapshot.sessionFile,
							interrupted: false,
						})
					)?.continuation;
				} catch (error) {
					this.options.hooks.onError(error, "subagent beforeStop lifecycle");
				}
			}
			if (!this.isCurrent(epoch) || !isActiveStatus(this.snapshot.status)) return;
			if (continuation && this.handle && this.stopContinuationCount < MAX_STOP_CONTINUATIONS) {
				this.stopContinuationCount += 1;
				this.endingEpoch = undefined;
				void this.runPrompt(epoch, continuation);
				return;
			}
			this.commitTerminal("completed");
			this.options.hooks.onTerminal(this.readSnapshot());
			this.markSettled();
		} finally {
			if (this.endingEpoch === epoch) this.endingEpoch = undefined;
		}
	}

	private async settleInterruptedExecution(epoch: number, handle: SubagentChildHandle | undefined): Promise<void> {
		if (handle) {
			try {
				await handle.abort();
				await handle.waitForIdle();
			} catch (error) {
				this.options.hooks.onError(error, "abort subagent child");
			}
		}
		if (this.startLifecycleCompleted) {
			try {
				await this.options.lifecycle?.beforeStop?.({
					id: this.snapshot.id,
					agentType: this.snapshot.agentType,
					generation: this.snapshot.generation,
					stopHookActive: this.stopContinuationCount > 0,
					lastAssistantText: this.snapshot.finalText,
					sessionFile: this.snapshot.sessionFile,
					interrupted: true,
				});
			} catch (error) {
				this.options.hooks.onError(error, "interrupted subagent beforeStop lifecycle");
			}
		}
		if (this.executionEpoch === epoch + 1) this.markSettled();
	}

	private commitTerminal(status: "completed" | "failed" | "interrupted", error?: string): void {
		this.snapshot.status = status;
		this.snapshot.endedAt = this.options.clock.now();
		this.snapshot.errorMessage = error;
		this.snapshot.generation += 1;
		this.options.hooks.onChanged();
	}

	private updateUsage(): void {
		const usage = this.handle?.readUsage?.();
		if (usage) this.snapshot.usage = { ...usage };
	}

	private detachSubscriptions(): void {
		this.unsubscribe?.();
		this.todoUnsubscribe?.();
		this.unsubscribe = undefined;
		this.todoUnsubscribe = undefined;
	}

	private async disposeForeignHandle(handle: SubagentChildHandle, operation: string): Promise<void> {
		try {
			await handle.dispose();
		} catch (error) {
			this.options.hooks.onError(error, operation);
		}
	}

	private isCurrent(epoch: number): boolean {
		return this.executionEpoch === epoch && !this.disposed;
	}

	private beginSettlement(): void {
		this.settled = false;
		this.settlement = this.createSettlement();
	}

	private createSettlement(): Promise<void> {
		return new Promise((resolve) => {
			this.resolveSettlement = resolve;
		});
	}

	private markSettled(): void {
		if (this.settled) return;
		this.settled = true;
		this.resolveSettlement();
		this.options.hooks.onSettled(this);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class SubagentStartBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SubagentStartBlockedError";
	}
}
