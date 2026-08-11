import {
	emptyUsage,
	isValidTaskName,
	type SubagentCoordinatorOptions,
	type SubagentRecoveryState,
	type SubagentSnapshot,
	type SubagentSpawnRequest,
	type SubagentTypeDefinition,
	type SubagentTypeId,
	taskPath,
} from "./contracts.js";
import { normalizeSubagentRecoveryState } from "./recovery.js";
import { isTerminalStatus } from "./snapshot.js";
import { SubagentPool } from "./subagent-pool.js";
import { SubagentRun, type SubagentRunHooks } from "./subagent-run.js";
import { formatDefaultSubagentTaskMessage } from "./task-message.js";

const DEFAULT_MAX_CONCURRENT = 3;
const MAX_TERMINAL_HANDLES = 50;

export interface SubagentDispatcherOptions<TProfile> extends SubagentCoordinatorOptions<TProfile> {
	readonly onTerminal: (snapshot: SubagentSnapshot) => void;
}

export class SubagentDispatcher<TProfile> {
	private readonly pool: SubagentPool<TProfile>;
	private readonly clock: { now(): number };
	private readonly idGenerator: { next(): string };
	private readonly lifecycleAbortController = new AbortController();
	private readonly startOperations = new Set<Promise<void>>();
	private readonly cleanupOperations = new Set<Promise<void>>();
	private disposed = false;
	private disposePromise: Promise<void> | undefined;

	constructor(private readonly options: SubagentDispatcherOptions<TProfile>) {
		this.clock = options.clock ?? { now: () => Date.now() };
		this.idGenerator = options.idGenerator ?? {
			next: () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
		};
		this.pool = new SubagentPool(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
	}

	list(): readonly SubagentSnapshot[] {
		return this.pool.list();
	}

	get(target: string): SubagentSnapshot | undefined {
		return this.pool.resolve(target)?.readSnapshot();
	}

	registeredTypeIds(): readonly SubagentTypeId[] {
		return this.options.typeRegistry.ids();
	}

	restore(state: SubagentRecoveryState): readonly SubagentSnapshot[] {
		this.assertNotDisposed();
		if (this.pool.size > 0) throw new Error("SubagentCoordinator recovery requires an empty coordinator");
		const snapshots = normalizeSubagentRecoveryState(state, this.options.parentSessionId, this.clock.now());
		for (const snapshot of snapshots) this.pool.add(this.createRun(snapshot));
		this.emitUpdate();
		return this.list();
	}

	clearFinished(): number {
		if (this.disposed) return 0;
		const removed = this.pool.removeFinished();
		for (const run of removed) this.trackCleanup(run.dispose());
		if (removed.length > 0) this.emitUpdate();
		return removed.length;
	}

	async spawn(request: SubagentSpawnRequest): Promise<SubagentSnapshot> {
		this.assertNotDisposed();
		const taskName = this.validateRequest(request);
		if (!this.pool.hasCapacity) {
			throw new Error(
				`Too many active subagents (${this.pool.activeCount}/${this.pool.maxConcurrent}). Wait or interrupt one before spawning more.`,
			);
		}
		const run = this.reserve(request, taskName, "pending");
		if (!this.pool.acquire(run)) throw new Error("Subagent concurrency slot changed during spawn");
		this.emitUpdate();
		await this.startRun(run, request);
		return run.readSnapshot();
	}

	spawnMany(requests: readonly SubagentSpawnRequest[]): readonly SubagentSnapshot[] {
		this.assertNotDisposed();
		if (requests.length === 0) throw new Error("dispatch requires at least one workflow");

		const requestedTypes = new Set(requests.map((request) => request.agentType));
		const reusableTaskNames = new Set(
			this.pool
				.values()
				.filter(
					(run) => requestedTypes.has(run.agentType) && (run.status === "completed" || run.status === "failed"),
				)
				.map((run) => run.taskName),
		);
		const seen = new Set<string>();
		const validated = requests.map((request) => {
			const taskName = this.validateRequest(request, reusableTaskNames);
			if (seen.has(taskName)) throw new Error(`Duplicate task_name "${taskName}" in this dispatch`);
			seen.add(taskName);
			return { request, taskName };
		});

		this.clearCompletedByTypes(requestedTypes);
		const runs = validated.map(({ request, taskName }) => {
			const hasSlot = this.pool.hasCapacity;
			const run = this.reserve(request, taskName, hasSlot ? "pending" : "queued");
			if (hasSlot) {
				if (!this.pool.acquire(run)) throw new Error("Subagent concurrency slot changed during dispatch");
				void this.startRunInBackground(run, request);
			} else {
				this.pool.enqueue(run);
			}
			return run;
		});
		this.emitUpdate();
		return runs.map((run) => run.readSnapshot());
	}

	async sendMessage(target: string, message: string): Promise<SubagentSnapshot> {
		this.assertNotDisposed();
		if (!message.trim()) throw new Error("message must be non-empty");
		const run = this.requireRun(target);
		await run.sendMessage(message);
		return run.readSnapshot();
	}

	async followUp(target: string, message: string): Promise<SubagentSnapshot> {
		this.assertNotDisposed();
		if (!message.trim()) throw new Error("message must be non-empty");
		const run = this.requireRun(target);
		if (!isTerminalStatus(run.status)) {
			await run.followUpActive(message);
			return run.readSnapshot();
		}

		await run.waitForSettled();
		if (!this.pool.acquire(run)) {
			throw new Error(`Too many active subagents (${this.pool.maxConcurrent} max)`);
		}
		const type = this.requireType(run.agentType);
		try {
			await run.resume(message, type);
			return run.readSnapshot();
		} catch (error) {
			await run.fail(error, "Unable to reopen subagent");
			throw error;
		}
	}

	interrupt(target: string): SubagentSnapshot {
		this.assertNotDisposed();
		const run = this.requireRun(target);
		if (run.status === "queued") this.pool.removeQueued(run);
		return run.interrupt();
	}

	resolveTargets(targets: readonly string[] | undefined): readonly SubagentSnapshot[] {
		if (!targets || targets.length === 0) return this.list();
		return targets.map((target) => this.requireRun(target).readSnapshot());
	}

	dispose(): Promise<void> {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.lifecycleAbortController.abort();
		this.pool.clearScheduling();
		this.disposePromise = this.performDispose();
		return this.disposePromise;
	}

	private async performDispose(): Promise<void> {
		const initial = this.pool.values().map((run) => run.dispose());
		await Promise.allSettled([...initial, ...this.startOperations, ...this.cleanupOperations]);
		await Promise.allSettled(this.pool.values().map((run) => run.dispose()));
		this.emitUpdate();
	}

	private reserve(
		request: SubagentSpawnRequest,
		taskName: string,
		status: "pending" | "queued",
	): SubagentRun<TProfile> {
		const snapshot: SubagentSnapshot = {
			id: `pending-${taskName}-${this.idGenerator.next()}`,
			taskName,
			path: taskPath(taskName),
			agentType: request.agentType,
			status,
			task: request.message,
			parentSessionId: this.options.parentSessionId,
			startedAt: this.clock.now(),
			usage: emptyUsage(),
			generation: 0,
			title: request.title?.trim() || undefined,
			todoProgress: request.todos ? { done: 0, total: request.todos.length } : undefined,
		};
		const run = this.createRun(snapshot, request);
		this.pool.add(run);
		return run;
	}

	private createRun(snapshot: SubagentSnapshot, request?: SubagentSpawnRequest): SubagentRun<TProfile> {
		const hooks: SubagentRunHooks<TProfile> = {
			rekey: (owner, previousId, nextId) => this.pool.rekey(owner, previousId, nextId),
			onChanged: () => this.emitUpdate(),
			onTerminal: (terminal) => this.handleTerminal(terminal),
			onSettled: (owner) => this.handleSettled(owner),
			onError: (error, operation) => this.reportError(error, operation),
		};
		const run = new SubagentRun(snapshot, request, {
			factory: this.options.factory,
			lifecycle: this.options.lifecycle,
			clock: this.clock,
			signal: this.lifecycleAbortController.signal,
			formatInitialMessage: this.options.formatInitialMessage ?? formatDefaultSubagentTaskMessage,
			hooks,
		});
		return run;
	}

	private async startRun(run: SubagentRun<TProfile>, request: SubagentSpawnRequest): Promise<void> {
		const operation = run.start(this.requireType(request.agentType));
		try {
			await this.trackStart(operation);
		} catch (error) {
			if (!isTerminalStatus(run.status)) await run.fail(error);
			throw error;
		}
	}

	private startRunInBackground(run: SubagentRun<TProfile>, request: SubagentSpawnRequest): Promise<void> {
		return this.startRun(run, request).catch((error) => {
			if (!this.disposed) this.reportError(error, `start subagent "${run.taskName}"`);
		});
	}

	private handleTerminal(snapshot: SubagentSnapshot): void {
		this.trimTerminalHandles();
		this.safeCallback(() => this.options.onTerminal(snapshot), "publish subagent terminal snapshot");
	}

	private handleSettled(run: SubagentRun<TProfile>): void {
		this.pool.release(run);
		this.drainQueue();
	}

	private drainQueue(): void {
		if (this.disposed) return;
		while (this.pool.hasCapacity) {
			const run = this.pool.takeNext();
			if (!run) return;
			run.activateQueued();
			const request = run.readSnapshot();
			void this.startRunInBackground(run, {
				taskName: request.taskName,
				message: request.task,
				agentType: request.agentType,
				title: request.title,
			});
		}
	}

	private clearCompletedByTypes(types: ReadonlySet<SubagentTypeId>): void {
		const removed = this.pool.removeFinished(
			(snapshot) =>
				types.has(snapshot.agentType) && (snapshot.status === "completed" || snapshot.status === "failed"),
		);
		for (const run of removed) this.trackCleanup(run.dispose());
	}

	private trimTerminalHandles(): void {
		const terminal = this.pool
			.values()
			.filter((run) => isTerminalStatus(run.status) && run.hasLiveHandle)
			.sort((left, right) => (left.endedAt ?? 0) - (right.endedAt ?? 0));
		while (terminal.length > MAX_TERMINAL_HANDLES) {
			const run = terminal.shift();
			if (run) this.trackCleanup(run.releaseHandle());
		}
	}

	private validateRequest(request: SubagentSpawnRequest, reusableTaskNames: ReadonlySet<string> = new Set()): string {
		const taskName = request.taskName.trim();
		if (!isValidTaskName(taskName)) {
			throw new Error(
				`Invalid task_name "${request.taskName}". Use lowercase letters, digits, underscore; start with a letter; not "root".`,
			);
		}
		if (!request.message.trim()) throw new Error("message must be non-empty");
		this.requireType(request.agentType);
		if (this.pool.hasTaskName(taskName) && !reusableTaskNames.has(taskName)) {
			throw new Error(`task_name "${taskName}" is already used in this session`);
		}
		return taskName;
	}

	private requireRun(target: string): SubagentRun<TProfile> {
		const run = this.pool.resolve(target);
		if (!run) throw new Error(`Subagent "${target}" not found`);
		return run;
	}

	private requireType(agentType: string): SubagentTypeDefinition<TProfile> {
		const type = this.options.typeRegistry.get(agentType);
		if (!type) {
			const known = this.options.typeRegistry.ids().join(", ") || "(none)";
			throw new Error(`Unknown agent_type "${agentType}". Registered: ${known}`);
		}
		return type;
	}

	private trackStart<T>(operation: Promise<T>): Promise<T> {
		const settlement = operation.then(
			() => undefined,
			() => undefined,
		);
		this.startOperations.add(settlement);
		void settlement.finally(() => this.startOperations.delete(settlement));
		return operation;
	}

	private trackCleanup(operation: Promise<void>): void {
		const settlement = operation.catch((error) => this.reportError(error, "dispose subagent child"));
		this.cleanupOperations.add(settlement);
		void settlement.finally(() => this.cleanupOperations.delete(settlement));
	}

	private emitUpdate(): void {
		this.safeCallback(() => this.options.onUpdate?.(this.list()), "publish subagent update");
	}

	private safeCallback(callback: () => void, operation: string): void {
		try {
			callback();
		} catch (error) {
			this.reportError(error, operation);
		}
	}

	private reportError(error: unknown, operation: string): void {
		try {
			this.options.onError?.(error, operation);
		} catch {
			// Error observers cannot change scheduler state.
		}
	}

	private assertNotDisposed(): void {
		if (this.disposed) throw new Error("SubagentCoordinator is disposed");
	}
}
