import {
	emptyUsage,
	isValidTaskName,
	type SubagentChildHandle,
	type SubagentCoordinatorOptions,
	type SubagentCoordinatorPort,
	type SubagentRecoveryState,
	type SubagentSnapshot,
	type SubagentSpawnRequest,
	type SubagentTypeDefinition,
	type SubagentTypeId,
	type SubagentWaitOptions,
	type SubagentWaitResult,
	taskPath,
} from "./contracts.js";
import { SubagentDelivery } from "./delivery.js";
import {
	cloneSnapshot,
	isActiveStatus,
	isTerminalStatus,
	type MutableSubagentSnapshot,
	type SubagentEntry,
} from "./internal.js";
import { SubagentScheduler } from "./scheduler.js";
import { SubagentStore } from "./subagent-store.js";

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const MIN_WAIT_TIMEOUT_MS = 1_000;
const MAX_WAIT_TIMEOUT_MS = 300_000;
const DEFAULT_NOTIFICATION_DELAY_MS = 50;
const MAX_TERMINAL_HANDLES = 50;
const MAX_STOP_CONTINUATIONS = 8;

export class SubagentCoordinator<TProfile = unknown> implements SubagentCoordinatorPort {
	private readonly store = new SubagentStore();
	private readonly scheduler: SubagentScheduler;
	private readonly delivery: SubagentDelivery;
	private readonly clock: { now(): number };
	private readonly idGenerator: { next(): string };
	private readonly lifecycleAbortController = new AbortController();
	private readonly startOperations = new Set<Promise<void>>();
	private disposed = false;
	private disposePromise: Promise<void> | undefined;

	constructor(private readonly options: SubagentCoordinatorOptions<TProfile>) {
		this.clock = options.clock ?? { now: () => Date.now() };
		this.idGenerator = options.idGenerator ?? {
			next: () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
		};
		this.scheduler = new SubagentScheduler(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
		this.delivery = new SubagentDelivery({
			notificationDelayMs: options.notificationDelayMs ?? DEFAULT_NOTIFICATION_DELAY_MS,
			onNotify: options.onNotify,
			onDeliveryClaimed: options.onDeliveryClaimed,
		});
	}

	list(): readonly SubagentSnapshot[] {
		return this.store.list();
	}

	get(target: string): SubagentSnapshot | undefined {
		const entry = this.store.resolve(target);
		return entry ? cloneSnapshot(entry.snapshot) : undefined;
	}

	restore(state: SubagentRecoveryState): readonly SubagentSnapshot[] {
		this.assertNotDisposed();
		if (this.store.size > 0) throw new Error("SubagentCoordinator recovery requires an empty coordinator");
		const restored = this.validateRecoveryState(state);
		for (const snapshot of restored) {
			const entry: SubagentEntry = {
				snapshot,
				startLifecycleCompleted: snapshot.sessionFile !== undefined,
				stopContinuationCount: 0,
				endInFlight: false,
			};
			this.store.add(entry);
		}
		this.delivery.restore(state.delivered);
		this.emitUpdate();
		return this.list();
	}

	registeredTypeIds(): readonly SubagentTypeId[] {
		return this.options.typeRegistry.ids();
	}

	clearFinished(): number {
		if (this.disposed) return 0;
		let removed = 0;
		for (const [id, entry] of this.store.entries()) {
			if (!isTerminalStatus(entry.snapshot.status)) continue;
			this.disposeHandle(entry);
			this.store.remove(id);
			removed += 1;
		}
		if (removed > 0) this.emitUpdate();
		return removed;
	}

	async spawn(request: SubagentSpawnRequest): Promise<SubagentSnapshot> {
		this.assertNotDisposed();
		const taskName = this.validateRequest(request);
		const activeCount = this.scheduler.activeCount;
		if (!this.scheduler.hasCapacity) {
			throw new Error(
				`Too many active subagents (${activeCount}/${this.scheduler.maxConcurrent}). Wait or interrupt one before spawning more.`,
			);
		}
		const entry = this.reserve(request, taskName, "pending");
		this.scheduler.acquire(entry.snapshot.id);
		this.emitUpdate();
		try {
			await this.startChild(entry);
			this.emitUpdate();
			return cloneSnapshot(entry.snapshot);
		} catch (error) {
			if (!isTerminalStatus(entry.snapshot.status)) {
				this.releaseEntry(entry, "failed", errorMessage(error));
			}
			this.emitUpdate();
			this.drainQueue();
			throw error;
		}
	}

	spawnMany(requests: readonly SubagentSpawnRequest[]): readonly SubagentSnapshot[] {
		this.assertNotDisposed();
		if (requests.length === 0) throw new Error("dispatch requires at least one workflow");

		const requestedTypes = new Set(requests.map((request) => request.agentType));
		const reusableTaskNames = new Set(
			this.store
				.values()
				.filter(
					(entry) =>
						requestedTypes.has(entry.snapshot.agentType) &&
						(entry.snapshot.status === "completed" || entry.snapshot.status === "failed"),
				)
				.map((entry) => entry.snapshot.taskName),
		);
		const seen = new Set<string>();
		const validated = requests.map((request) => {
			const taskName = this.validateRequest(request, reusableTaskNames);
			if (seen.has(taskName)) {
				throw new Error(`Duplicate task_name "${taskName}" in this dispatch`);
			}
			seen.add(taskName);
			return { request, taskName };
		});

		this.clearCompletedByTypes(requestedTypes);
		const entries = validated.map(({ request, taskName }) => {
			const hasSlot = this.scheduler.hasCapacity;
			const entry = this.reserve(request, taskName, hasSlot ? "pending" : "queued");
			if (hasSlot) {
				this.scheduler.acquire(entry.snapshot.id);
				void this.startChildInBackground(entry);
			} else {
				this.scheduler.enqueue(entry.snapshot.id);
			}
			return entry;
		});
		this.emitUpdate();
		return entries.map((entry) => cloneSnapshot(entry.snapshot));
	}

	async sendMessage(target: string, message: string): Promise<SubagentSnapshot> {
		this.assertNotDisposed();
		const entry = this.requireChild(target);
		if (!message.trim()) throw new Error("message must be non-empty");
		if (!entry.handle) throw new Error(`Subagent "${target}" has no live session`);
		await entry.handle.sendMessage(message);
		return cloneSnapshot(entry.snapshot);
	}

	async followUp(target: string, message: string): Promise<SubagentSnapshot> {
		this.assertNotDisposed();
		const entry = this.requireChild(target);
		if (!message.trim()) throw new Error("message must be non-empty");
		const type = this.requireType(entry.snapshot.agentType);
		if (!entry.handle) {
			try {
				await this.reopen(entry, type);
			} catch (error) {
				this.releaseEntry(entry, "failed", `Unable to reopen subagent: ${errorMessage(error)}`);
				this.emitUpdate();
				this.queueNotification(entry.snapshot);
				throw error;
			}
		}

		if (isTerminalStatus(entry.snapshot.status)) {
			if (!this.scheduler.acquire(entry.snapshot.id)) {
				throw new Error(`Too many active subagents (${this.scheduler.maxConcurrent} max)`);
			}
			entry.snapshot.status = "running";
			entry.snapshot.task = message;
			entry.snapshot.endedAt = undefined;
			entry.snapshot.errorMessage = undefined;
			entry.endInFlight = false;
			this.emitUpdate();
			void this.runFollowUp(entry, message);
			return cloneSnapshot(entry.snapshot);
		}

		if (!entry.handle) throw new Error(`Subagent "${target}" has no live session`);
		await entry.handle.followUp(message);
		entry.snapshot.task = message;
		this.emitUpdate();
		return cloneSnapshot(entry.snapshot);
	}

	interrupt(target: string): SubagentSnapshot {
		this.assertNotDisposed();
		const entry = this.requireChild(target);
		if (isTerminalStatus(entry.snapshot.status)) return cloneSnapshot(entry.snapshot);
		const finalText = entry.handle?.getLastAssistantText();
		entry.handle?.abort();
		entry.queuedRequest = undefined;
		this.scheduler.removeQueued(entry.snapshot.id);
		entry.snapshot.finalText = finalText ?? entry.snapshot.finalText;
		entry.snapshot.status = "interrupted";
		entry.snapshot.endedAt = this.clock.now();
		entry.snapshot.generation += 1;
		this.updateUsage(entry);
		this.scheduler.release(entry.snapshot.id);
		this.delivery.wake();
		this.emitUpdate();
		this.queueNotification(entry.snapshot);
		this.drainQueue();
		void this.runTerminalStopLifecycle(entry, true);
		return cloneSnapshot(entry.snapshot);
	}

	async wait(options: SubagentWaitOptions = {}): Promise<SubagentWaitResult> {
		this.assertNotDisposed();
		const timeoutMs = clamp(options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS, MIN_WAIT_TIMEOUT_MS, MAX_WAIT_TIMEOUT_MS);
		const resolveTargets = (): SubagentEntry[] => {
			if (!options.targets || options.targets.length === 0) {
				return this.store
					.values()
					.filter((entry) => !isTerminalStatus(entry.snapshot.status) || this.hasUndelivered(entry));
			}
			return options.targets.map((target) => this.requireChild(target));
		};
		const collectReady = (): SubagentSnapshot[] => {
			const ready: SubagentSnapshot[] = [];
			for (const entry of resolveTargets()) {
				if (!isTerminalStatus(entry.snapshot.status)) continue;
				const claimed = this.delivery.claim(entry.snapshot);
				if (claimed) ready.push(claimed);
			}
			return ready;
		};
		const immediate = collectReady();
		if (immediate.length > 0) return { timedOut: false, agents: immediate };
		const active = resolveTargets().filter((entry) => !isTerminalStatus(entry.snapshot.status));
		if (active.length === 0) return { timedOut: false, agents: [] };

		return new Promise((resolve) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout>;
			let unsubscribe = () => {};
			const finish = (timedOut: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				unsubscribe();
				resolve({ timedOut, agents: collectReady() });
			};
			const onWake = () => {
				const ready = resolveTargets().some(
					(entry) => isTerminalStatus(entry.snapshot.status) && this.hasUndelivered(entry),
				);
				if (ready) finish(false);
			};
			unsubscribe = this.delivery.subscribe(onWake);
			timer = setTimeout(() => finish(true), timeoutMs);
		});
	}

	dispose(): Promise<void> {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.lifecycleAbortController.abort();
		this.delivery.closeNotifications();
		this.scheduler.clear();
		this.disposePromise = this.performDispose();
		return this.disposePromise;
	}

	private async performDispose(): Promise<void> {
		const initialDisposal = this.disposeChildren();
		await Promise.allSettled([initialDisposal, ...this.startOperations]);
		await this.disposeChildren();
		this.delivery.clearWaiters();
		this.emitUpdate();
	}

	private async disposeChildren(): Promise<void> {
		const disposals: Promise<void>[] = [];
		for (const entry of this.store.values()) {
			if (!isTerminalStatus(entry.snapshot.status)) {
				entry.handle?.abort();
				entry.snapshot.status = "interrupted";
				entry.snapshot.endedAt = this.clock.now();
				entry.snapshot.generation += 1;
			}
			this.scheduler.release(entry.snapshot.id);
			this.delivery.wake();
			const disposal = this.disposeHandle(entry);
			if (disposal) disposals.push(disposal);
		}
		await Promise.allSettled(disposals);
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
		if (this.store.hasTaskName(taskName) && !reusableTaskNames.has(taskName)) {
			throw new Error(`task_name "${taskName}" is already used in this session`);
		}
		return taskName;
	}

	private reserve(request: SubagentSpawnRequest, taskName: string, status: "pending" | "queued"): SubagentEntry {
		const id = `pending-${taskName}-${this.idGenerator.next()}`;
		const snapshot: MutableSubagentSnapshot = {
			id,
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
		const entry: SubagentEntry = {
			snapshot,
			queuedRequest: request,
			startLifecycleCompleted: false,
			stopContinuationCount: 0,
			endInFlight: false,
		};
		this.store.add(entry);
		return entry;
	}

	private startChild(entry: SubagentEntry): Promise<void> {
		return this.trackStartOperation(this.createAndStartChild(entry));
	}

	private async createAndStartChild(entry: SubagentEntry): Promise<void> {
		const request = entry.queuedRequest;
		if (!request) throw new Error(`Subagent "${entry.snapshot.taskName}" has no queued request`);
		const type = this.requireType(entry.snapshot.agentType);
		entry.queuedRequest = undefined;
		const handle = await this.options.factory.create(request, type, this.lifecycleAbortController.signal);
		if (this.disposed) {
			await handle.dispose();
			throw new Error("Parent session disposed during subagent spawn");
		}
		this.attachHandle(entry, handle);
		handle.setTodos?.(request.todos ?? []);

		const lifecycle = await this.options.lifecycle?.beforeStart?.({
			id: entry.snapshot.id,
			agentType: entry.snapshot.agentType,
			message: request.message,
		});
		if (lifecycle?.blockedReason) {
			this.releaseEntry(entry, "failed", lifecycle.blockedReason);
			throw new SubagentStartBlockedError(lifecycle.blockedReason);
		}
		entry.startLifecycleCompleted = true;
		void this.runInitialPrompt(entry, lifecycle?.message ?? request.message);
	}

	private attachHandle(entry: SubagentEntry, handle: SubagentChildHandle): void {
		const provisionalId = entry.snapshot.id;
		entry.snapshot.id = handle.sessionId;
		entry.snapshot.sessionFile = handle.sessionFile;
		entry.handle = handle;
		this.store.rekey(entry, provisionalId);
		this.scheduler.rekey(provisionalId, handle.sessionId);
		entry.unsubscribe = handle.subscribe((event) => {
			if (event.type === "agent_start" && entry.snapshot.status === "pending") {
				entry.snapshot.status = "running";
				this.emitUpdate();
			}
			if (event.type === "agent_end") void this.onChildAgentEnd(entry);
		});
		if (handle.getTodoProgress) {
			entry.snapshot.todoProgress = handle.getTodoProgress();
			entry.todoUnsubscribe = handle.subscribeTodos?.((progress) => {
				entry.snapshot.todoProgress = progress;
				this.emitUpdate();
			});
		}
	}

	private async reopen(entry: SubagentEntry, type: SubagentTypeDefinition<TProfile>): Promise<void> {
		const reopen = this.options.factory.reopen;
		if (!reopen) throw new Error(`Subagent "${entry.snapshot.id}" is not live and reopen is not supported`);
		const handle = await this.trackStartOperation(
			reopen(cloneSnapshot(entry.snapshot), type, this.lifecycleAbortController.signal),
		);
		if (this.disposed) {
			await handle.dispose();
			throw new Error("Parent session disposed during subagent reopen");
		}
		this.attachHandle(entry, handle);
	}

	private trackStartOperation<T>(operation: Promise<T>): Promise<T> {
		const settlement = operation.then(
			() => undefined,
			() => undefined,
		);
		this.startOperations.add(settlement);
		void settlement.finally(() => this.startOperations.delete(settlement));
		return operation;
	}

	private async runInitialPrompt(entry: SubagentEntry, message: string): Promise<void> {
		const handle = entry.handle;
		if (!handle) return;
		try {
			entry.snapshot.status = "running";
			this.emitUpdate();
			await handle.prompt(this.wrapTaskMessage(entry.snapshot, message));
			if (!handle.isStreaming() && entry.snapshot.status === "running") {
				await this.onChildAgentEnd(entry);
			}
		} catch (error) {
			if (isActiveStatus(entry.snapshot.status)) {
				this.releaseEntry(entry, "failed", errorMessage(error));
				this.emitUpdate();
				this.queueNotification(entry.snapshot);
				this.drainQueue();
			}
		}
	}

	private async runFollowUp(entry: SubagentEntry, message: string): Promise<void> {
		try {
			await entry.handle?.prompt(message);
			if (entry.handle && !entry.handle.isStreaming() && entry.snapshot.status === "running") {
				await this.onChildAgentEnd(entry);
			}
		} catch (error) {
			this.releaseEntry(entry, "failed", errorMessage(error));
			this.emitUpdate();
			this.queueNotification(entry.snapshot);
			this.drainQueue();
		}
	}

	private async onChildAgentEnd(entry: SubagentEntry): Promise<void> {
		if (isTerminalStatus(entry.snapshot.status) || entry.endInFlight) return;
		entry.endInFlight = true;
		try {
			entry.snapshot.finalText = entry.handle?.getLastAssistantText();
			this.updateUsage(entry);
			const lifecycle = entry.startLifecycleCompleted
				? await this.options.lifecycle?.beforeStop?.({
						id: entry.snapshot.id,
						agentType: entry.snapshot.agentType,
						generation: entry.snapshot.generation,
						stopHookActive: entry.stopContinuationCount > 0,
						lastAssistantText: entry.snapshot.finalText,
						sessionFile: entry.snapshot.sessionFile,
						interrupted: false,
					})
				: undefined;
			if (lifecycle?.continuation && entry.handle && entry.stopContinuationCount < MAX_STOP_CONTINUATIONS) {
				entry.stopContinuationCount += 1;
				entry.endInFlight = false;
				void this.runFollowUp(entry, lifecycle.continuation);
				return;
			}
			entry.snapshot.status = "completed";
			entry.snapshot.endedAt = this.clock.now();
			entry.snapshot.generation += 1;
			this.scheduler.release(entry.snapshot.id);
			this.trimTerminalHandles();
			this.delivery.wake();
			this.emitUpdate();
			this.queueNotification(entry.snapshot);
			this.drainQueue();
		} finally {
			entry.endInFlight = false;
		}
	}

	private async runTerminalStopLifecycle(entry: SubagentEntry, interrupted: boolean): Promise<void> {
		if (!entry.startLifecycleCompleted) return;
		await this.options.lifecycle
			?.beforeStop?.({
				id: entry.snapshot.id,
				agentType: entry.snapshot.agentType,
				generation: entry.snapshot.generation,
				stopHookActive: entry.stopContinuationCount > 0,
				lastAssistantText: entry.snapshot.finalText,
				sessionFile: entry.snapshot.sessionFile,
				interrupted,
			})
			.catch(() => undefined);
	}

	private startChildInBackground(entry: SubagentEntry): Promise<void> {
		return this.startChild(entry).catch((error) => {
			if (this.disposed) return;
			if (!isTerminalStatus(entry.snapshot.status)) {
				this.releaseEntry(entry, "failed", errorMessage(error));
			}
			this.emitUpdate();
			this.queueNotification(entry.snapshot);
			this.drainQueue();
		});
	}

	private clearCompletedByTypes(types: ReadonlySet<SubagentTypeId>): void {
		for (const [id, entry] of this.store.entries()) {
			if (!types.has(entry.snapshot.agentType)) continue;
			if (entry.snapshot.status !== "completed" && entry.snapshot.status !== "failed") continue;
			this.disposeHandle(entry);
			this.store.remove(id);
		}
	}

	private drainQueue(): void {
		if (this.disposed) return;
		while (this.scheduler.hasCapacity) {
			const id = this.scheduler.takeNext();
			if (!id) return;
			const entry = this.store.getById(id);
			if (!entry || entry.snapshot.status !== "queued") {
				this.scheduler.release(id);
				continue;
			}
			entry.snapshot.status = "pending";
			this.emitUpdate();
			void this.startChildInBackground(entry);
		}
	}

	private releaseEntry(entry: SubagentEntry, status: "failed" | "interrupted", errorMessageText?: string): void {
		entry.snapshot.finalText = entry.handle?.getLastAssistantText() ?? entry.snapshot.finalText;
		entry.snapshot.status = status;
		entry.snapshot.endedAt = this.clock.now();
		entry.snapshot.errorMessage = errorMessageText;
		entry.snapshot.generation += 1;
		entry.queuedRequest = undefined;
		this.updateUsage(entry);
		this.scheduler.release(entry.snapshot.id);
		this.delivery.wake();
		this.disposeHandle(entry);
		void this.runTerminalStopLifecycle(entry, status === "interrupted");
	}

	private updateUsage(entry: SubagentEntry): void {
		const usage = entry.handle?.readUsage?.();
		if (usage) entry.snapshot.usage = { ...usage };
	}

	private disposeHandle(entry: SubagentEntry): Promise<void> | undefined {
		entry.unsubscribe?.();
		entry.todoUnsubscribe?.();
		entry.unsubscribe = undefined;
		entry.todoUnsubscribe = undefined;
		const handle = entry.handle;
		entry.handle = undefined;
		if (!handle) return undefined;
		try {
			return Promise.resolve(handle.dispose());
		} catch {
			return undefined;
		}
	}

	private trimTerminalHandles(): void {
		const terminal = this.store
			.values()
			.filter((entry) => isTerminalStatus(entry.snapshot.status) && entry.handle)
			.sort((left, right) => (left.snapshot.endedAt ?? 0) - (right.snapshot.endedAt ?? 0));
		while (terminal.length > MAX_TERMINAL_HANDLES) {
			const entry = terminal.shift();
			if (entry) this.disposeHandle(entry);
		}
	}

	private queueNotification(snapshot: SubagentSnapshot): void {
		if (this.disposed) return;
		this.delivery.queue(snapshot);
	}

	private hasUndelivered(entry: SubagentEntry): boolean {
		return this.delivery.hasUndelivered(entry.snapshot);
	}

	private requireChild(target: string): SubagentEntry {
		const entry = this.store.resolve(target);
		if (!entry) throw new Error(`Subagent "${target}" not found`);
		return entry;
	}

	private requireType(agentType: string): SubagentTypeDefinition<TProfile> {
		const type = this.options.typeRegistry.get(agentType);
		if (!type) {
			const known = this.options.typeRegistry.ids().join(", ") || "(none)";
			throw new Error(`Unknown agent_type "${agentType}". Registered: ${known}`);
		}
		return type;
	}

	private wrapTaskMessage(snapshot: SubagentSnapshot, message: string): string {
		return [
			"<subagent_task>",
			`id: ${snapshot.id}`,
			`path: ${snapshot.path}`,
			`type: ${snapshot.agentType}`,
			`task_name: ${snapshot.taskName}`,
			"</subagent_task>",
			"",
			message,
		].join("\n");
	}

	private emitUpdate(): void {
		this.options.onUpdate?.(this.list());
	}

	private validateRecoveryState(state: SubagentRecoveryState): MutableSubagentSnapshot[] {
		const ids = new Set<string>();
		const taskNames = new Set<string>();
		return state.agents.map((source) => {
			if (ids.has(source.id)) throw new Error(`Duplicate recovered subagent id "${source.id}"`);
			if (taskNames.has(source.taskName)) {
				throw new Error(`Duplicate recovered subagent task_name "${source.taskName}"`);
			}
			if (source.parentSessionId !== this.options.parentSessionId) {
				throw new Error(
					`Recovered subagent "${source.id}" belongs to parent "${source.parentSessionId}", not "${this.options.parentSessionId}"`,
				);
			}
			if (!isValidTaskName(source.taskName) || source.path !== taskPath(source.taskName)) {
				throw new Error(`Recovered subagent "${source.id}" has an invalid task identity`);
			}
			ids.add(source.id);
			taskNames.add(source.taskName);
			const snapshot: MutableSubagentSnapshot = cloneSnapshot(source);
			if (!isTerminalStatus(snapshot.status)) {
				snapshot.status = snapshot.sessionFile ? "interrupted" : "failed";
				snapshot.endedAt = this.clock.now();
				snapshot.generation += 1;
				snapshot.errorMessage = snapshot.sessionFile
					? "Parent runtime restarted while the subagent was active"
					: "Parent runtime restarted before the child session was created";
			}
			return snapshot;
		});
	}

	private assertNotDisposed(): void {
		if (this.disposed) throw new Error("SubagentCoordinator is disposed");
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

class SubagentStartBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SubagentStartBlockedError";
	}
}
