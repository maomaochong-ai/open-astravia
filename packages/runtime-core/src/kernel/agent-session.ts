import type {
	AgentSessionState,
	QueuedSessionInputResult,
	SessionContextRecord,
	SessionInput,
	SessionInputQueueMode,
	SessionSendOptions,
	SessionSendResult,
	SessionStreamingBehavior,
	TurnResult,
	TurnSessionIdentity,
} from "./contracts.js";
import { sessionBusyError, sessionClosedError } from "./errors.js";
import { type ClearedSessionInputs, SessionInputQueue, type SessionInputQueueSnapshot } from "./session-input-queue.js";
import type { TurnPipeline } from "./turn-pipeline.js";

export interface CreateAgentSessionOptions {
	readonly id: string;
	readonly pipeline: TurnPipeline;
	readonly cwd?: string;
	readonly steeringMode?: SessionInputQueueMode;
	readonly followUpMode?: SessionInputQueueMode;
	/** 输入队列任何可观察变化后的同步回调；宿主用于镜像广播与持久化（ADR-0060）。 */
	readonly onQueueChange?: (snapshot: SessionInputQueueSnapshot) => void;
}

export class AgentSession {
	private readonly identity: MutableTurnSessionIdentity;
	private readonly pipeline: TurnPipeline;
	private readonly inputQueue: SessionInputQueue;
	private currentState: AgentSessionState = "idle";
	private activeController: AbortController | undefined;
	private activeTurn: Promise<TurnResult> | undefined;
	private continuationRequested = false;
	private continuationDrain: Promise<void> | undefined;
	private readonly continuationContext: SessionContextRecord[] = [];
	private readonly nextTurnContext: SessionContextRecord[] = [];
	private contextWrite: Promise<void> = Promise.resolve();
	private readonly continuationWaiters: Array<{
		resolve(): void;
		reject(error: unknown): void;
	}> = [];

	private constructor(options: CreateAgentSessionOptions) {
		this.identity = new MutableTurnSessionIdentity(options.id);
		this.pipeline = options.pipeline;
		this.inputQueue = new SessionInputQueue({
			steeringMode: options.steeringMode,
			followUpMode: options.followUpMode,
			onChange: options.onQueueChange,
		});
	}

	static async create(options: CreateAgentSessionOptions): Promise<AgentSession> {
		const session = new AgentSession(options);
		await options.pipeline.createSession(options.id, options.cwd);
		return session;
	}

	static async resume(options: CreateAgentSessionOptions): Promise<AgentSession> {
		const session = new AgentSession(options);
		await options.pipeline.resumeSession(options.id);
		return session;
	}

	get state(): AgentSessionState {
		return this.currentState;
	}

	get id(): string {
		return this.identity.sessionId;
	}

	get pendingMessageCount(): number {
		return this.inputQueue.pendingCount;
	}

	getSteeringMessages(): readonly SessionInput["message"][] {
		return this.inputQueue.steeringInputs.flatMap((input) => (input.message ? [input.message] : []));
	}

	getFollowUpMessages(): readonly SessionInput["message"][] {
		return this.inputQueue.followUpInputs.flatMap((input) => (input.message ? [input.message] : []));
	}

	get steeringMode(): SessionInputQueueMode {
		return this.inputQueue.steeringMode;
	}

	get followUpMode(): SessionInputQueueMode {
		return this.inputQueue.followUpMode;
	}

	setSteeringMode(mode: SessionInputQueueMode): void {
		this.inputQueue.setSteeringMode(mode);
	}

	setFollowUpMode(mode: SessionInputQueueMode): void {
		this.inputQueue.setFollowUpMode(mode);
	}

	async send(input: SessionInput): Promise<TurnResult>;
	async send(input: SessionInput, options: SessionSendOptions): Promise<SessionSendResult>;
	async send(input: SessionInput, options: SessionSendOptions = {}): Promise<SessionSendResult> {
		await this.contextWrite;
		if (this.currentState === "closed" || this.currentState === "closing") {
			throw sessionClosedError();
		}
		if (this.currentState !== "idle") {
			if (!options.streamingBehavior) throw sessionBusyError();
			return this.queueInput(options.streamingBehavior, input);
		}

		const trailingContext = [...(input.trailingContext ?? []), ...this.nextTurnContext.splice(0)];
		return this.startTurn(trailingContext.length > 0 ? { ...input, trailingContext } : input);
	}

	async continue(): Promise<TurnResult> {
		await this.contextWrite;
		if (this.currentState === "closed" || this.currentState === "closing") {
			throw sessionClosedError();
		}
		if (this.currentState !== "idle") throw sessionBusyError();
		return this.startTurn();
	}

	async retry(): Promise<TurnResult> {
		await this.contextWrite;
		if (this.currentState === "closed" || this.currentState === "closing") {
			throw sessionClosedError();
		}
		if (this.currentState !== "idle") throw sessionBusyError();
		return this.startTurn(undefined, [], true);
	}

	/**
	 * 请求一次异步续跑。
	 *
	 * 与显式 continue 不同：活动 Turn 期间到达的多个请求会合并，并在当前 Turn
	 * 完成后串行启动一次 continuation。后台任务和子代理通知使用该入口唤醒
	 * 空闲 Session，避免绕过 Session 的并发状态机。
	 */
	requestContinuation(context: readonly SessionContextRecord[] = []): Promise<void> {
		if (this.currentState === "closed" || this.currentState === "closing") {
			return Promise.reject(sessionClosedError());
		}
		this.continuationRequested = true;
		this.continuationContext.push(...context);
		const completion = new Promise<void>((resolve, reject) => {
			this.continuationWaiters.push({ resolve, reject });
		});
		this.scheduleRequestedContinuations();
		return completion;
	}

	steer(input: SessionInput): QueuedSessionInputResult {
		return this.queueInput("steer", input);
	}

	followUp(input: SessionInput): QueuedSessionInputResult {
		return this.queueInput("followUp", input);
	}

	queueContext(
		behavior: SessionStreamingBehavior,
		context: readonly SessionContextRecord[],
	): QueuedSessionInputResult {
		if (this.currentState === "closed" || this.currentState === "closing") {
			throw sessionClosedError();
		}
		return {
			status: "queued",
			behavior,
			pendingCount: this.inputQueue.enqueueContext(behavior, context),
		};
	}

	queueNextTurnContext(context: readonly SessionContextRecord[]): void {
		if (this.currentState === "closed" || this.currentState === "closing") {
			throw sessionClosedError();
		}
		this.nextTurnContext.push(...context);
	}

	recordContext(context: readonly SessionContextRecord[]): Promise<void> {
		if (this.currentState === "closed" || this.currentState === "closing") {
			return Promise.reject(sessionClosedError());
		}
		const write = this.contextWrite.then(async () => {
			if (this.currentState !== "idle") throw sessionBusyError();
			await this.pipeline.recordContext(this.identity, context);
		});
		this.contextWrite = write.catch(() => undefined);
		return write;
	}

	clearQueue(): ClearedSessionInputs {
		return this.inputQueue.clear();
	}

	listQueue(): SessionInputQueueSnapshot {
		return this.inputQueue.list();
	}

	removeQueued(id: string): boolean {
		return this.inputQueue.remove(id);
	}

	reorderQueuedFollowUps(ids: readonly string[]): void {
		this.inputQueue.reorderFollowUps(ids);
	}

	/** 「立即发送」的 streaming 形态：followUp 条目提升为 steering，工具间隙注入当前 turn。 */
	promoteQueuedToSteering(id: string): boolean {
		return this.inputQueue.promoteToSteering(id);
	}

	restoreQueue(snapshot: SessionInputQueueSnapshot): void {
		this.inputQueue.restore(snapshot);
	}

	/**
	 * 「立即发送」某条排队消息：running 时**打断当前 turn**、以该条目立刻开启新 turn
	 * （在 kernel 内原子完成 take → cancel → start，没有渲染端等待/超时竞态）；
	 * 空闲时直接开启新 turn。其余排队条目保留并保持可消费（用户显式要继续，
	 * 不落入 pause-on-terminal）。
	 */
	async sendQueuedNow(
		id: string,
	): Promise<{ readonly status: "missing" } | { readonly status: "started"; readonly turn: Promise<TurnResult> }> {
		if (this.currentState === "closed" || this.currentState === "closing") {
			throw sessionClosedError();
		}
		// 先取出条目再打断：确保这条消息绝不因中途失败而丢失在「已出队未发送」状态——
		// takeById 失败即早退，成功后它只存在于本调用栈，随 startTurn 进入持久化。
		const input = this.inputQueue.takeById(id);
		if (!input) return { status: "missing" };
		if (this.currentState !== "idle") {
			await this.cancel("send queued message now");
		}
		await this.contextWrite;
		// cancel 的 pause-on-terminal 会冻结其余排队条目；用户点「立即发送」表达的
		// 是继续消费，解除暂停让它们在新 turn 的自然停止点接力。
		this.inputQueue.resume();
		return { status: "started", turn: this.startTurn(input) };
	}

	/**
	 * 解除 pause-on-terminal 并继续消费队列：空闲时以 followUp 队首开启新 turn，
	 * 其余条目由该 turn 的自然停止点接力消费；running 时仅解除暂停。
	 */
	async resumeQueue(): Promise<TurnResult | undefined> {
		if (this.currentState === "closed" || this.currentState === "closing") {
			throw sessionClosedError();
		}
		this.inputQueue.resume();
		if (this.currentState !== "idle") return undefined;
		await this.contextWrite;
		// contextWrite 让出事件循环期间可能有别的 send 抢先起了 turn；重查状态，
		// 已在跑就把消费交给该 turn 的自然停止点。
		if (this.currentState !== "idle") return undefined;
		const head = this.inputQueue.takeFollowUpHead();
		if (!head) return undefined;
		return this.startTurn(head);
	}

	async cancel(reason?: string): Promise<void> {
		if (this.currentState !== "running" && this.currentState !== "cancelling") return;
		this.currentState = "cancelling";
		this.activeController?.abort(reason);
		await this.activeTurn;
	}

	async close(): Promise<void> {
		if (this.currentState === "closed") return;
		if (!this.activeTurn) {
			await this.contextWrite;
			this.inputQueue.clear();
			this.nextTurnContext.length = 0;
			this.currentState = "closed";
			this.rejectContinuationWaiters(sessionClosedError());
			return;
		}

		this.currentState = "closing";
		this.activeController?.abort("Session closed");
		await this.activeTurn;
		this.inputQueue.clear();
		this.nextTurnContext.length = 0;
		this.currentState = "closed";
		this.rejectContinuationWaiters(sessionClosedError());
	}

	private queueInput(behavior: SessionStreamingBehavior, input: SessionInput): QueuedSessionInputResult {
		if (this.currentState === "closed" || this.currentState === "closing") {
			throw sessionClosedError();
		}
		const { id, pendingCount } = this.inputQueue.enqueueWithId(behavior, input);
		return { status: "queued", behavior, pendingCount, id };
	}

	private async startTurn(
		input?: SessionInput,
		continuationContext: readonly SessionContextRecord[] = [],
		retrying = false,
	): Promise<TurnResult> {
		this.currentState = "running";
		const controller = new AbortController();
		this.activeController = controller;
		const turn = input
			? this.pipeline.run(this.identity, input, controller.signal, this.inputQueue)
			: retrying
				? this.pipeline.retry(this.identity, controller.signal, this.inputQueue)
				: this.pipeline.continue(this.identity, controller.signal, this.inputQueue, continuationContext);
		this.activeTurn = turn;

		try {
			const result = await turn;
			// pause-on-terminal（ADR-0060）：aborted/failed 收尾时冻结残留队列，
			// 避免它们在下一个不相干的 turn 里被自然停止点突然消费。
			if (result.status !== "completed" && this.inputQueue.pendingCount > 0) {
				this.inputQueue.pause();
			}
			return result;
		} catch (error) {
			if (this.inputQueue.pendingCount > 0) this.inputQueue.pause();
			throw error;
		} finally {
			this.finishActiveTurn();
		}
	}

	private async drainRequestedContinuations(): Promise<void> {
		while (this.continuationRequested && this.currentState === "idle") {
			this.continuationRequested = false;
			const waiters = this.continuationWaiters.splice(0);
			const context = this.continuationContext.splice(0);
			try {
				await this.startTurn(undefined, context);
				for (const waiter of waiters) waiter.resolve();
			} catch (error) {
				for (const waiter of waiters) waiter.reject(error);
			}
		}
	}

	private finishActiveTurn(): void {
		this.activeController = undefined;
		this.activeTurn = undefined;
		this.currentState = this.currentState === "closing" ? "closed" : "idle";
		this.scheduleRequestedContinuations();
	}

	private scheduleRequestedContinuations(): void {
		if (!this.continuationRequested || this.continuationDrain) return;
		if (this.currentState === "closed" || this.currentState === "closing") {
			this.rejectContinuationWaiters(sessionClosedError());
			return;
		}
		if (this.currentState !== "idle") return;
		this.continuationDrain = this.drainRequestedContinuations();
		void this.continuationDrain.then(() => {
			this.continuationDrain = undefined;
			if (this.continuationRequested) this.scheduleRequestedContinuations();
		});
	}

	private rejectContinuationWaiters(error: unknown): void {
		this.continuationRequested = false;
		this.continuationContext.length = 0;
		for (const waiter of this.continuationWaiters.splice(0)) waiter.reject(error);
	}
}

class MutableTurnSessionIdentity implements TurnSessionIdentity {
	private currentSessionId: string;

	constructor(sessionId: string) {
		this.currentSessionId = sessionId;
	}

	get sessionId(): string {
		return this.currentSessionId;
	}

	transition(sessionId: string): void {
		if (!sessionId) throw new Error("Conversation continuation requires a target session ID");
		this.currentSessionId = sessionId;
	}
}

export async function createAgentSession(options: CreateAgentSessionOptions): Promise<AgentSession> {
	return AgentSession.create(options);
}

export async function resumeAgentSession(options: CreateAgentSessionOptions): Promise<AgentSession> {
	return AgentSession.resume(options);
}
