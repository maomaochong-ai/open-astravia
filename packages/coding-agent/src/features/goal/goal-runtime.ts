import type { Message } from "@astravia/ai";
import type { ConversationDocument, RuntimeDocumentParticipantContext } from "@astravia/runtime-core";
import { selectConversationDocumentEntries } from "@astravia/runtime-core/conversation";
import type { StoredSessionEvent } from "@astravia/runtime-core/kernel";
import type {
	CodingAgentGoalSnapshot,
	CodingAgentGoalState,
	CodingAgentGoalStatus,
	CodingAgentGoalUpdateListener,
} from "./contracts.js";
import { GOAL_SNAPSHOT_TYPE, parseGoalSnapshot } from "./goal-snapshot.js";

export interface CodingAgentGoalRuntimeOptions {
	readonly createId: () => string;
	readonly now: () => number;
}

export class CodingAgentGoalRuntime {
	private state: CodingAgentGoalSnapshot = null;
	private readonly listeners = new Set<CodingAgentGoalUpdateListener>();
	private documentContext: RuntimeDocumentParticipantContext | undefined;
	private readonly pendingSnapshots: CodingAgentGoalSnapshot[] = [];
	private pendingSnapshotWrites = 0;
	private persistenceTail: Promise<void> = Promise.resolve();
	private latestPersistence: Promise<void> = Promise.resolve();
	private activeTurn = false;
	private activeSince: number | undefined;
	private activeTurnGoalId: string | undefined;
	private pendingAutomaticGoalId: string | undefined;
	private activeTurnIsAutomatic = false;
	/**
	 * 本轮是否留下了用户可验证的成果（正文、工具调用、工具结果）。thinking 不计：
	 * 只烧推理预算、正文一个 token 都没产出的自动续跑经常是截断或空转，把它算成
	 * 进展会让 goal 永远续下去，并反复撞上同一个失败。
	 */
	private activeTurnHasVisibleProgress = false;
	private activeTurnHasSuccessfulTool = false;
	private consecutiveEmptyTurns = 0;
	private consecutiveExecutionFailures = 0;

	constructor(private readonly options: CodingAgentGoalRuntimeOptions) {}

	readState(): CodingAgentGoalSnapshot {
		return cloneGoal(this.state);
	}

	create(objective: string): CodingAgentGoalState {
		const normalized = objective.trim();
		if (normalized.length === 0) throw new Error("Goal objective must not be empty");
		if (this.state && this.state.status !== "complete") {
			throw new Error("An unfinished goal already exists; update or clear it before creating another goal");
		}
		const timestamp = new Date(this.options.now()).toISOString();
		const next: CodingAgentGoalState = {
			goalId: this.options.createId(),
			objective: normalized,
			status: "active",
			tokensUsed: 0,
			timeUsedSeconds: 0,
			continuationCount: 0,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.resetProgressAudit();
		this.commit(next);
		return next;
	}

	update(goalId: string, status: CodingAgentGoalStatus, statusDetail?: string): CodingAgentGoalState {
		const current = this.requireGoal(goalId);
		if (status === "active" && !["paused", "blocked", "usage_limited"].includes(current.status)) {
			throw new Error(`Goal cannot resume from ${current.status}`);
		}
		if (current.status !== "active" && status !== "active") {
			throw new Error(`Goal cannot transition from ${current.status} to ${status}`);
		}
		if (status === current.status) return current;
		const next: CodingAgentGoalState = {
			...current,
			status,
			...(statusDetail?.trim() ? { statusDetail: statusDetail.trim() } : { statusDetail: undefined }),
			updatedAt: new Date(this.options.now()).toISOString(),
		};
		if (status === "active") this.resetProgressAudit();
		this.commit(next);
		return next;
	}

	clear(goalId: string): null {
		this.requireGoal(goalId);
		this.resetProgressAudit();
		this.commit(null);
		return null;
	}

	recordContinuation(): void {
		if (!this.state || this.state.status !== "active") return;
		this.pendingAutomaticGoalId = this.state.goalId;
		this.commit({
			...this.state,
			continuationCount: this.state.continuationCount + 1,
			updatedAt: new Date(this.options.now()).toISOString(),
		});
	}

	subscribe(listener: CodingAgentGoalUpdateListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	initialize(document: ConversationDocument, context: RuntimeDocumentParticipantContext): void {
		if (this.documentContext) throw new Error("Coding Agent Goal Runtime is already initialized");
		this.documentContext = context;
		const restored = latestGoalSnapshot(document) ?? null;
		if (restored?.status === "active") {
			this.commit({
				...restored,
				status: "paused",
				statusDetail: "Restored after the session stopped; resume explicitly to continue",
				updatedAt: new Date(this.options.now()).toISOString(),
			});
		} else {
			this.restore(restored);
		}
	}

	onDocumentChanged(document: ConversationDocument): void {
		// Earlier queued snapshots must not overwrite a newer user or tool update.
		if (this.pendingSnapshots.length > 0 || this.pendingSnapshotWrites > 0) return;
		this.restore(latestGoalSnapshot(document) ?? null);
	}

	async onSessionEvent(event: StoredSessionEvent): Promise<void> {
		if (event.type === "turn.started") {
			this.activeTurn = true;
			this.activeTurnGoalId = this.state?.status === "active" ? this.state.goalId : undefined;
			this.activeTurnIsAutomatic = this.pendingAutomaticGoalId === this.activeTurnGoalId;
			this.pendingAutomaticGoalId = undefined;
			this.activeTurnHasVisibleProgress = false;
			this.activeTurnHasSuccessfulTool = false;
			if (this.activeTurnGoalId) this.activeSince = this.options.now();
			return;
		}
		if (event.type === "message.appended" && event.message.role === "assistant") {
			if (assistantHasVisibleProgress(event.message)) this.activeTurnHasVisibleProgress = true;
			this.recordUsage(event.message);
			this.schedulePendingSnapshot();
			await this.latestPersistence;
			return;
		}
		if (event.type === "message.appended" && event.message.role === "toolResult") {
			this.activeTurnHasVisibleProgress = true;
			if (!event.message.isError) this.activeTurnHasSuccessfulTool = true;
			this.schedulePendingSnapshot();
			await this.latestPersistence;
			return;
		}
		if (event.type === "turn.completed" || event.type === "turn.cancelled" || event.type === "turn.failed") {
			this.finishTiming();
			this.auditTurnOutcome(event.type);
			this.activeTurn = false;
			this.activeTurnGoalId = undefined;
			this.activeTurnIsAutomatic = false;
			this.activeTurnHasVisibleProgress = false;
			this.activeTurnHasSuccessfulTool = false;
			this.schedulePendingSnapshot();
			await this.latestPersistence;
		}
	}

	async flush(): Promise<void> {
		if (!this.activeTurn) this.schedulePendingSnapshot();
		await this.latestPersistence;
	}

	async dispose(): Promise<void> {
		this.finishTiming();
		this.activeTurn = false;
		this.schedulePendingSnapshot();
		await this.latestPersistence.catch(() => undefined);
		this.listeners.clear();
	}

	private recordUsage(message: Extract<Message, { role: "assistant" }>): void {
		if (!this.state || this.state.status !== "active") return;
		if (this.state.goalId !== this.activeTurnGoalId) return;
		const usage = message.usage;
		const consumed = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
		const tokensUsed = this.state.tokensUsed + Math.max(0, consumed);
		this.commit({
			...this.state,
			tokensUsed,
			updatedAt: new Date(this.options.now()).toISOString(),
		});
	}

	private finishTiming(): void {
		if (this.activeSince === undefined) return;
		const elapsed = Math.max(0, this.options.now() - this.activeSince) / 1_000;
		this.activeSince = undefined;
		if (!this.state || this.state.goalId !== this.activeTurnGoalId) return;
		if (elapsed === 0) return;
		this.commit({
			...this.state,
			timeUsedSeconds: this.state.timeUsedSeconds + elapsed,
			updatedAt: new Date(this.options.now()).toISOString(),
		});
	}

	private auditTurnOutcome(type: "turn.completed" | "turn.cancelled" | "turn.failed"): void {
		const current = this.state;
		if (!current || current.status !== "active" || current.goalId !== this.activeTurnGoalId) return;
		if (type === "turn.cancelled") return;
		if (type === "turn.failed" && !this.activeTurnHasSuccessfulTool) {
			this.consecutiveExecutionFailures += 1;
			if (this.consecutiveExecutionFailures >= 3) {
				this.blockCurrentGoal(
					current,
					"Execution failed for three consecutive goal turns; review the failure before resuming",
				);
			}
			return;
		}
		this.consecutiveExecutionFailures = 0;
		if (!this.activeTurnIsAutomatic) {
			this.consecutiveEmptyTurns = 0;
			return;
		}
		// 自动续跑轮以失败收尾时，中途跑过多少个成功工具都不算进展：这一轮没把 goal
		// 往前推，而 goal 还在 active，下一轮会立刻重复同一套动作，所以必须让它计数。
		if (type === "turn.failed" || !this.activeTurnHasVisibleProgress) {
			this.recordEmptyAutomaticTurn(current);
			return;
		}
		this.consecutiveEmptyTurns = 0;
	}

	private recordEmptyAutomaticTurn(current: CodingAgentGoalState): void {
		this.consecutiveEmptyTurns += 1;
		if (this.consecutiveEmptyTurns < 3) return;
		this.blockCurrentGoal(
			current,
			"No observable progress was produced for three consecutive goal continuations; review the goal before resuming",
		);
	}

	private blockCurrentGoal(current: CodingAgentGoalState, statusDetail: string): void {
		this.commit({
			...current,
			status: "blocked",
			statusDetail,
			updatedAt: new Date(this.options.now()).toISOString(),
		});
	}

	private resetProgressAudit(): void {
		this.pendingAutomaticGoalId = undefined;
		this.consecutiveEmptyTurns = 0;
		this.consecutiveExecutionFailures = 0;
	}

	private requireGoal(goalId: string): CodingAgentGoalState {
		if (!this.state) throw new Error("No goal exists");
		if (this.state.goalId !== goalId) throw new Error("Goal id does not match the current goal");
		return this.state;
	}

	private commit(next: CodingAgentGoalSnapshot): void {
		this.state = cloneGoal(next);
		this.pendingSnapshots.push(cloneGoal(next));
		if (!this.activeTurn) this.schedulePendingSnapshot();
		for (const listener of this.listeners) listener(cloneGoal(next));
	}

	private restore(snapshot: CodingAgentGoalSnapshot): void {
		if (sameGoal(this.state, snapshot)) return;
		if (
			this.state?.goalId !== snapshot?.goalId ||
			(snapshot?.status === "active" && this.state?.status !== "active")
		) {
			this.resetProgressAudit();
		}
		this.state = cloneGoal(snapshot);
		for (const listener of this.listeners) listener(cloneGoal(snapshot));
	}

	private schedulePendingSnapshot(): void {
		const context = this.documentContext;
		if (!context) return;
		const snapshot = this.pendingSnapshots.splice(0).at(-1);
		if (snapshot === undefined) return;
		this.pendingSnapshotWrites += 1;
		const operation = this.persistenceTail
			.then(() =>
				context.appendCustomEntry({
					entryId: this.options.createId(),
					customType: GOAL_SNAPSHOT_TYPE,
					data: snapshot,
					timestamp: new Date(this.options.now()).toISOString(),
				}),
			)
			.finally(() => {
				this.pendingSnapshotWrites -= 1;
			});
		this.latestPersistence = operation;
		this.persistenceTail = operation.catch(() => undefined);
	}
}

/** thinking 不是可验证的成果：只烧推理预算、正文与工具都没产出的轮次算空转。 */
function assistantHasVisibleProgress(message: Extract<Message, { role: "assistant" }>): boolean {
	return (
		message.content?.some((item) => {
			if (item.type === "text") return item.text.trim().length > 0;
			if (item.type === "thinking") return false;
			return true;
		}) ?? false
	);
}

function latestGoalSnapshot(document: ConversationDocument): CodingAgentGoalSnapshot | undefined {
	for (const entry of [...selectConversationDocumentEntries(document)].reverse()) {
		if (entry.type !== "custom" || entry.customType !== GOAL_SNAPSHOT_TYPE) continue;
		return parseGoalSnapshot(entry.data, entry.id);
	}
	return undefined;
}

function cloneGoal(state: CodingAgentGoalSnapshot): CodingAgentGoalSnapshot {
	return state ? { ...state } : null;
}

function sameGoal(left: CodingAgentGoalSnapshot, right: CodingAgentGoalSnapshot): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
