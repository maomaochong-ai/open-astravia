import type { Message } from "@vetta/ai";
import type { ConversationDocument, RuntimeDocumentParticipantContext } from "@vetta/runtime-core";
import { selectConversationDocumentEntries } from "@vetta/runtime-core/conversation";
import type { StoredSessionEvent } from "@vetta/runtime-core/kernel";
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
	private persistenceTail: Promise<void> = Promise.resolve();
	private latestPersistence: Promise<void> = Promise.resolve();
	private activeTurn = false;
	private activeSince: number | undefined;

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
		this.commit(next);
		return next;
	}

	clear(goalId: string): null {
		this.requireGoal(goalId);
		this.commit(null);
		return null;
	}

	recordContinuation(): void {
		if (!this.state || this.state.status !== "active") return;
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
		if (this.pendingSnapshots.length > 0) return;
		this.restore(latestGoalSnapshot(document) ?? null);
	}

	async onSessionEvent(event: StoredSessionEvent): Promise<void> {
		if (event.type === "turn.started") {
			this.activeTurn = true;
			if (this.state?.status === "active") this.activeSince = this.options.now();
			return;
		}
		if (event.type === "message.appended" && event.message.role === "assistant") {
			this.recordUsage(event.message);
			this.schedulePendingSnapshot();
			await this.latestPersistence;
			return;
		}
		if (event.type === "message.appended" && event.message.role === "toolResult") {
			this.schedulePendingSnapshot();
			await this.latestPersistence;
			return;
		}
		if (event.type === "turn.completed" || event.type === "turn.cancelled" || event.type === "turn.failed") {
			this.finishTiming();
			this.activeTurn = false;
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
		if (!this.state) return;
		if (elapsed === 0) return;
		this.commit({
			...this.state,
			timeUsedSeconds: this.state.timeUsedSeconds + elapsed,
			updatedAt: new Date(this.options.now()).toISOString(),
		});
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
		this.state = cloneGoal(snapshot);
		for (const listener of this.listeners) listener(cloneGoal(snapshot));
	}

	private schedulePendingSnapshot(): void {
		const context = this.documentContext;
		if (!context) return;
		const snapshot = this.pendingSnapshots.splice(0).at(-1);
		if (snapshot === undefined) return;
		const operation = this.persistenceTail.then(() =>
			context.appendCustomEntry({
				entryId: this.options.createId(),
				customType: GOAL_SNAPSHOT_TYPE,
				data: snapshot,
				timestamp: new Date(this.options.now()).toISOString(),
			}),
		);
		this.latestPersistence = operation;
		this.persistenceTail = operation.catch(() => undefined);
	}
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
