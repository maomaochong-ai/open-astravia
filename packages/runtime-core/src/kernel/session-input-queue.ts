import { randomUUID } from "node:crypto";
import type {
	QueuedSessionInput,
	SessionContextRecord,
	SessionInput,
	SessionInputQueueMode,
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
	readonly steering: readonly SessionInput[];
	readonly followUps: readonly SessionInput[];
}

/** 带身份的队列条目：id 贯穿 kernel → 宿主 → UI，使排队消息可被指认与管理。 */
export interface SessionInputQueueEntry {
	readonly id: string;
	readonly behavior: SessionStreamingBehavior;
	readonly input: QueuedSessionInput;
}

/** 可序列化快照：条目 + 暂停位。持久化与镜像共用（ADR-0060）。 */
export interface SessionInputQueueSnapshot {
	readonly paused: boolean;
	readonly entries: readonly SessionInputQueueEntry[];
}

interface QueueSlot {
	readonly id: string;
	readonly input: QueuedSessionInput;
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

	enqueueContext(behavior: SessionStreamingBehavior, context: readonly SessionContextRecord[]): number {
		this.enqueueEntry(behavior, { context } satisfies QueuedSessionInput);
		return this.pendingCount;
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
			const slot: QueueSlot = { id: entry.id, input: entry.input };
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
		return this.take(this.followUpQueue, this.currentFollowUpMode);
	}

	/** 按 id 显式取出一条完整输入（「立即发送」在空闲态直接开 turn 用）；无视 paused。 */
	takeById(id: string): SessionInput | undefined {
		for (const queue of [this.steeringQueue, this.followUpQueue]) {
			const index = queue.findIndex((slot) => slot.id === id && isSessionInput(slot.input));
			if (index < 0) continue;
			const [slot] = queue.splice(index, 1);
			this.notifyChange();
			return slot.input as SessionInput;
		}
		return undefined;
	}

	/** 显式取出 followUp 队首一条完整输入（resumeQueue 以队首开启新 turn 用）。 */
	takeFollowUpHead(): SessionInput | undefined {
		const index = this.followUpQueue.findIndex((slot) => isSessionInput(slot.input));
		if (index < 0) return undefined;
		const [slot] = this.followUpQueue.splice(index, 1);
		this.notifyChange();
		return slot.input as SessionInput;
	}

	enqueueFollowUps(messages: readonly SessionInput["message"][]): void {
		for (const message of messages) {
			this.followUpQueue.push({ id: randomUUID(), input: { message } });
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
			steering: steering.map((slot) => slot.input).filter(isSessionInput),
			followUps: followUps.map((slot) => slot.input).filter(isSessionInput),
		};
	}

	private enqueueEntry(behavior: SessionStreamingBehavior, input: QueuedSessionInput): string {
		const slot: QueueSlot = { id: randomUUID(), input };
		if (behavior === "steer") this.steeringQueue.push(slot);
		else this.followUpQueue.push(slot);
		this.notifyChange();
		return slot.id;
	}

	private take(queue: QueueSlot[], mode: SessionInputQueueMode): readonly QueuedSessionInput[] {
		if (this.isPaused || queue.length === 0) return [];
		const taken = mode === "all" ? queue.splice(0) : queue.splice(0, 1);
		if (taken.length > 0) this.notifyChange();
		return taken.map((slot) => slot.input);
	}

	private notifyChange(): void {
		this.onChange?.(this.list());
	}
}

function toEntry(behavior: SessionStreamingBehavior, slot: QueueSlot): SessionInputQueueEntry {
	return { id: slot.id, behavior, input: slot.input };
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
