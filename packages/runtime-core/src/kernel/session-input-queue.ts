import { createRuntimeId } from "../id-generator.js";
import type {
	QueuedSessionInput,
	SessionContextRecord,
	SessionInput,
	SessionInputQueueMode,
	SessionInputRequest,
	SessionQueueOperation,
	SessionStreamingBehavior,
	TurnInputQueue,
} from "./contracts.js";

export interface SessionInputQueueOptions {
	readonly steeringMode?: SessionInputQueueMode;
	readonly followUpMode?: SessionInputQueueMode;
	/** 队列任何可观察变化（含被 take 消费）后同步回调；用于宿主镜像与持久化。 */
	readonly onChange?: (snapshot: SessionInputQueueSnapshot) => void;
}

export interface ClearedSessionInputs {
	readonly steering: readonly QueuedSessionInput[];
	readonly followUps: readonly QueuedSessionInput[];
}

/** 带身份的队列条目：id 贯穿 kernel → 宿主 → UI，使排队消息可被指认与管理。 */
export interface SessionInputQueueEntry {
	readonly id: string;
	readonly behavior: SessionStreamingBehavior;
	readonly input: QueuedSessionInput;
	/**
	 * 内部控制信号（如续跑策略消息），借队列排序与节流但不属于用户输入。
	 * 面向用户的队列投影必须过滤掉它，否则会被当成"用户排过的队"呈现。
	 */
	readonly internal?: boolean;
}

/** 可序列化快照：条目 + 暂停位。持久化与镜像共用（ADR-0060）。 */
export interface SessionInputQueueSnapshot {
	readonly paused: boolean;
	readonly entries: readonly SessionInputQueueEntry[];
}

interface QueueSlot {
	readonly id: string;
	readonly input: QueuedSessionInput;
	readonly internal?: boolean;
}

export class SessionInputQueue implements TurnInputQueue {
	private readonly steeringQueue: QueueSlot[] = [];
	private readonly followUpQueue: QueueSlot[] = [];
	private currentSteeringMode: SessionInputQueueMode;
	private currentFollowUpMode: SessionInputQueueMode;
	private isPaused = false;
	private readonly onChange: ((snapshot: SessionInputQueueSnapshot) => void) | undefined;

	constructor(options: SessionInputQueueOptions = {}) {
		this.currentSteeringMode = options.steeringMode ?? "one-at-a-time";
		this.currentFollowUpMode = options.followUpMode ?? "one-at-a-time";
		this.onChange = options.onChange;
	}

	get pendingCount(): number {
		return this.steeringQueue.length + this.followUpQueue.length;
	}

	hasOperation(type?: SessionQueueOperation["type"]): boolean {
		return [...this.steeringQueue, ...this.followUpQueue].some(
			(slot) => slot.input.operation && (type === undefined || slot.input.operation.type === type),
		);
	}

	get paused(): boolean {
		return this.isPaused;
	}

	get steeringInputs(): readonly SessionInput[] {
		return this.steeringQueue.map((slot) => slot.input).filter(isSessionInput);
	}

	get followUpInputs(): readonly SessionInput[] {
		return this.followUpQueue.map((slot) => slot.input).filter(isSessionInput);
	}

	get steeringMode(): SessionInputQueueMode {
		return this.currentSteeringMode;
	}

	get followUpMode(): SessionInputQueueMode {
		return this.currentFollowUpMode;
	}

	setSteeringMode(mode: SessionInputQueueMode): void {
		this.currentSteeringMode = mode;
	}

	setFollowUpMode(mode: SessionInputQueueMode): void {
		this.currentFollowUpMode = mode;
	}

	enqueue(behavior: SessionStreamingBehavior, input: SessionInput): number {
		this.enqueueEntry(behavior, input);
		return this.pendingCount;
	}

	/** 与 enqueue 相同，但把生成的条目 id 交还给调用方（用于回执与后续指认）。 */
	enqueueWithId(behavior: SessionStreamingBehavior, input: SessionInput): { id: string; pendingCount: number } {
		const id = this.enqueueEntry(behavior, input);
		return { id, pendingCount: this.pendingCount };
	}

	enqueueRequestWithId(
		behavior: SessionStreamingBehavior,
		request: SessionInputRequest,
	): { id: string; pendingCount: number } {
		const id = this.enqueueEntry(behavior, { request });
		return { id, pendingCount: this.pendingCount };
	}

	enqueueContext(behavior: SessionStreamingBehavior, context: readonly SessionContextRecord[]): number {
		this.enqueueEntry(behavior, { context } satisfies QueuedSessionInput);
		return this.pendingCount;
	}

	enqueueOperationWithId(operation: SessionQueueOperation): {
		readonly id: string;
		readonly pendingCount: number;
		readonly created: boolean;
	} {
		const existing = [...this.steeringQueue, ...this.followUpQueue].find(
			(slot) => slot.input.operation?.type === operation.type,
		);
		if (existing) return { id: existing.id, pendingCount: this.pendingCount, created: false };
		const id = this.enqueueEntry("followUp", { operation });
		return { id, pendingCount: this.pendingCount, created: true };
	}

	steer(input: SessionInput): number {
		return this.enqueue("steer", input);
	}

	followUp(input: SessionInput): number {
		return this.enqueue("followUp", input);
	}

	list(): SessionInputQueueSnapshot {
		return {
			paused: this.isPaused,
			entries: [
				...this.steeringQueue.map((slot) => toEntry("steer", slot)),
				...this.followUpQueue.map((slot) => toEntry("followUp", slot)),
			],
		};
	}

	remove(id: string): boolean {
		const removed = removeById(this.steeringQueue, id) || removeById(this.followUpQueue, id);
		if (removed) this.notifyChange();
		return removed;
	}

	/**
	 * 按给定 id 顺序重排 followUp 队列。未出现在 ids 里的条目保持相对顺序排在末尾；
	 * 未知 id 忽略。steering 队列表达「尽快插入」，不参与重排。
	 */
	reorderFollowUps(ids: readonly string[]): void {
		const byId = new Map(this.followUpQueue.map((slot) => [slot.id, slot]));
		const next: QueueSlot[] = [];
		for (const id of ids) {
			const slot = byId.get(id);
			if (!slot) continue;
			byId.delete(id);
			next.push(slot);
		}
		for (const slot of this.followUpQueue) {
			if (byId.has(slot.id)) next.push(slot);
		}
		this.followUpQueue.splice(0, this.followUpQueue.length, ...next);
		this.notifyChange();
	}

	/** 把 followUp 条目提升为 steering（「立即发送」的 turn 内注入形态，ADR-0060）。 */
	promoteToSteering(id: string): boolean {
		const index = this.followUpQueue.findIndex((slot) => slot.id === id);
		if (index < 0) return false;
		const [slot] = this.followUpQueue.splice(index, 1);
		this.steeringQueue.push(slot);
		this.notifyChange();
		return true;
	}

	/** turn 以 aborted/failed 收尾时暂停：take* 返回空，残留条目不会渗入下一个 turn。 */
	pause(): void {
		if (this.isPaused) return;
		this.isPaused = true;
		this.notifyChange();
	}

	resume(): void {
		if (!this.isPaused) return;
		this.isPaused = false;
		this.notifyChange();
	}

	/** 从持久化快照恢复（会话 resume 时）。整体替换现有内容。 */
	restore(snapshot: SessionInputQueueSnapshot): void {
		this.steeringQueue.length = 0;
		this.followUpQueue.length = 0;
		for (const entry of snapshot.entries) {
			const slot: QueueSlot = {
				id: entry.id,
				input: entry.input,
				...(entry.internal ? { internal: true } : {}),
			};
			if (entry.behavior === "steer") this.steeringQueue.push(slot);
			else this.followUpQueue.push(slot);
		}
		this.isPaused = snapshot.paused;
		this.notifyChange();
	}

	takeSteering(): readonly SessionInput["message"][] {
		return this.takeSteeringInputs().flatMap((input) => (input.message ? [input.message] : []));
	}

	takeFollowUps(): readonly SessionInput["message"][] {
		return this.takeFollowUpInputs().flatMap((input) => (input.message ? [input.message] : []));
	}

	takeSteeringInputs(): readonly QueuedSessionInput[] {
		return this.take(this.steeringQueue, this.currentSteeringMode);
	}

	takeFollowUpInputs(): readonly QueuedSessionInput[] {
		return this.take(this.followUpQueue, this.currentFollowUpMode, true);
	}

	/** 按 id 显式取出一条完整输入（「立即发送」在空闲态直接开 turn 用）；无视 paused。 */
	takeById(id: string): QueuedSessionInput | undefined {
		for (const queue of [this.steeringQueue, this.followUpQueue]) {
			const operationIndex = queue.findIndex((slot) => slot.input.operation !== undefined);
			const index = queue.findIndex(
				(slot, candidateIndex) =>
					slot.id === id &&
					(operationIndex < 0 || candidateIndex < operationIndex) &&
					!slot.input.operation &&
					isExecutableInput(slot.input),
			);
			if (index < 0) continue;
			const [slot] = queue.splice(index, 1);
			this.notifyChange();
			return slot.input;
		}
		return undefined;
	}

	/** 显式取出 followUp 队首一条完整输入（resumeQueue 以队首开启新 turn 用）。 */
	takeFollowUpHead(): QueuedSessionInput | undefined {
		const operationIndex = this.followUpQueue.findIndex((slot) => slot.input.operation !== undefined);
		const index = this.followUpQueue.findIndex(
			(slot, candidateIndex) =>
				(operationIndex < 0 || candidateIndex < operationIndex) && isExecutableInput(slot.input),
		);
		if (index < 0) return undefined;
		const [slot] = this.followUpQueue.splice(index, 1);
		this.notifyChange();
		return slot.input;
	}

	peekFollowUpOperation(): { readonly id: string; readonly operation: SessionQueueOperation } | undefined {
		const head = this.followUpQueue[0];
		return head?.input.operation ? { id: head.id, operation: head.input.operation } : undefined;
	}

	takeFollowUpOperationHead(): { readonly id: string; readonly operation: SessionQueueOperation } | undefined {
		const entry = this.peekFollowUpOperation();
		if (!entry) return undefined;
		this.followUpQueue.shift();
		this.notifyChange();
		return entry;
	}

	enqueueFollowUps(messages: readonly SessionInput["message"][], options?: { readonly internal?: boolean }): void {
		for (const message of messages) {
			this.followUpQueue.push({
				id: createRuntimeId(),
				input: { message },
				...(options?.internal ? { internal: true } : {}),
			});
		}
		if (messages.length > 0) this.notifyChange();
	}

	clear(): ClearedSessionInputs {
		const steering = this.steeringQueue.splice(0);
		const followUps = this.followUpQueue.splice(0);
		if (steering.length > 0 || followUps.length > 0 || this.isPaused) {
			this.isPaused = false;
			this.notifyChange();
		}
		return {
			steering: steering.map((slot) => slot.input),
			followUps: followUps.map((slot) => slot.input),
		};
	}

	private enqueueEntry(behavior: SessionStreamingBehavior, input: QueuedSessionInput): string {
		const slot: QueueSlot = { id: createRuntimeId(), input };
		if (behavior === "steer") this.steeringQueue.push(slot);
		else this.followUpQueue.push(slot);
		this.notifyChange();
		return slot.id;
	}

	private take(
		queue: QueueSlot[],
		mode: SessionInputQueueMode,
		stopAtOperation = false,
	): readonly QueuedSessionInput[] {
		if (this.isPaused || queue.length === 0) return [];
		const operationIndex = stopAtOperation ? queue.findIndex((slot) => slot.input.operation !== undefined) : -1;
		const availableCount = operationIndex < 0 ? queue.length : operationIndex;
		if (availableCount === 0) return [];
		const takeCount = mode === "all" ? availableCount : 1;
		const taken = queue.splice(0, takeCount);
		if (taken.length > 0) this.notifyChange();
		return taken.map((slot) => slot.input);
	}

	private notifyChange(): void {
		this.onChange?.(this.list());
	}
}

function toEntry(behavior: SessionStreamingBehavior, slot: QueueSlot): SessionInputQueueEntry {
	return { id: slot.id, behavior, input: slot.input, ...(slot.internal ? { internal: true } : {}) };
}

function removeById(queue: QueueSlot[], id: string): boolean {
	const index = queue.findIndex((slot) => slot.id === id);
	if (index < 0) return false;
	queue.splice(index, 1);
	return true;
}

function isSessionInput(input: QueuedSessionInput): input is SessionInput {
	return input.message !== undefined;
}

function isExecutableInput(input: QueuedSessionInput): boolean {
	return input.message !== undefined || input.request !== undefined;
}
