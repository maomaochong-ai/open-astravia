import type { ConversationDocument, RuntimeDocumentParticipantContext } from "@vetta/runtime-core";
import { selectConversationDocumentEntries } from "@vetta/runtime-core";
import type { StoredSessionEvent } from "@vetta/runtime-core/kernel";
import type { CodingAgentPermissionMode, CodingAgentPlanModeState, CodingAgentPlanStatus } from "./contracts.js";
import { PLAN_MODE_SNAPSHOT_TYPE, parsePlanModeSnapshot } from "./plan-mode-snapshot.js";

export type PlanModeStateListener = (state: CodingAgentPlanModeState) => void;

export interface CodingAgentPlanModeRuntimeOptions {
	readonly createEntryId: () => string;
	readonly now: () => number;
}

/** 一次 Turn admission 捕获的权限视图。 */
export interface PlanModeTurnBinding {
	/**
	 * 本 Turn 是否仍受 Plan 闸门约束。
	 *
	 * Turn 内只允许「放宽」被观察到：`exit_plan_mode` 获批是本 Turn 自己产生的状态，后续模型调用要能
	 * 立即拿回写工具去执行计划。「收紧」是外部更新，按 generation 规则从下一 Turn 生效，避免把一次
	 * 已经准入的执行中途改成另一套工具面。
	 */
	isPlanActive(): boolean;
}

const DEFAULT_STATE: CodingAgentPlanModeState = Object.freeze({ permissionMode: "default" });

/**
 * 一个 Session 内权限模式与计划的唯一状态所有者。
 *
 * 工具面闸门、执行闸门、提示词、`exit_plan_mode` 与宿主 endpoint 都读写这一份状态；持久化只经
 * Conversation Document 的 custom entry，因此会话恢复、分叉和树导航都能还原当时的模式。
 */
export class CodingAgentPlanModeRuntime {
	private state: CodingAgentPlanModeState = DEFAULT_STATE;
	private readonly listeners = new Set<PlanModeStateListener>();
	private documentContext: RuntimeDocumentParticipantContext | undefined;
	private readonly pendingSnapshots: CodingAgentPlanModeState[] = [];
	private persistenceTail: Promise<void> = Promise.resolve();
	private latestPersistence: Promise<void> = Promise.resolve();
	private activeTurn = false;

	constructor(private readonly options: CodingAgentPlanModeRuntimeOptions) {}

	readState(): CodingAgentPlanModeState {
		return this.state;
	}

	readPermissionMode(): CodingAgentPermissionMode {
		return this.state.permissionMode;
	}

	bindForTurn(): PlanModeTurnBinding {
		const admittedInPlanMode = this.state.permissionMode === "plan";
		return { isPlanActive: () => admittedInPlanMode && this.state.permissionMode === "plan" };
	}

	setPermissionMode(permissionMode: CodingAgentPermissionMode): void {
		if (this.state.permissionMode === permissionMode) return;
		this.commit({ ...this.state, permissionMode });
	}

	submitPlan(content: string): void {
		this.commit({ ...this.state, plan: this.createPlan(content, "pending-review") });
	}

	requestChanges(content: string): void {
		this.commit({ ...this.state, plan: this.createPlan(content, "changes-requested") });
	}

	dismissReview(content: string): void {
		this.commit({ ...this.state, plan: this.createPlan(content, "dismissed") });
	}

	/** 批准即开闸：计划定稿与权限放宽是同一次状态转换，不存在「已批准但仍只读」的中间态。 */
	approvePlan(content: string): void {
		this.commit({ permissionMode: "default", plan: this.createPlan(content, "approved") });
	}

	subscribe(listener: PlanModeStateListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	initialize(document: ConversationDocument, context: RuntimeDocumentParticipantContext): void {
		if (this.documentContext) throw new Error("Coding Agent Plan Mode Runtime is already initialized");
		this.documentContext = context;
		const snapshot = latestPlanModeSnapshot(document);
		if (snapshot) this.restore(snapshot);
		else if (this.state !== DEFAULT_STATE) this.captureSnapshot();
	}

	onDocumentChanged(document: ConversationDocument): void {
		// Turn 内的改动要等 toolResult 或 Turn 结束才落盘；此时回灌旧快照会撤销刚发生的审批。
		if (this.pendingSnapshots.length > 0) return;
		this.restore(latestPlanModeSnapshot(document) ?? DEFAULT_STATE);
	}

	async onSessionEvent(event: StoredSessionEvent): Promise<void> {
		if (event.type === "turn.started") {
			this.activeTurn = true;
			return;
		}
		if (event.type === "message.appended" && event.message.role === "toolResult") {
			this.schedulePendingSnapshots();
			await this.latestPersistence;
			return;
		}
		if (event.type === "turn.completed" || event.type === "turn.cancelled" || event.type === "turn.failed") {
			this.activeTurn = false;
			this.schedulePendingSnapshots();
			await this.latestPersistence;
		}
	}

	async dispose(): Promise<void> {
		this.listeners.clear();
		this.activeTurn = false;
		this.schedulePendingSnapshots();
		await this.latestPersistence.catch(() => undefined);
	}

	private createPlan(content: string, status: CodingAgentPlanStatus): NonNullable<CodingAgentPlanModeState["plan"]> {
		return { content, status, updatedAt: new Date(this.options.now()).toISOString() };
	}

	private commit(next: CodingAgentPlanModeState): void {
		this.state = Object.freeze(next);
		this.captureSnapshot();
		for (const listener of this.listeners) listener(this.state);
	}

	private restore(snapshot: CodingAgentPlanModeState): void {
		if (samePlanModeState(this.state, snapshot)) return;
		this.state = Object.freeze({ ...snapshot });
		for (const listener of this.listeners) listener(this.state);
	}

	private captureSnapshot(): void {
		this.pendingSnapshots.push(this.state);
		if (!this.activeTurn) this.schedulePendingSnapshots();
	}

	private schedulePendingSnapshots(): void {
		const context = this.documentContext;
		if (!context) return;
		// 同一批里只有最后一个快照有意义：恢复时只读最新一条。
		const snapshot = this.pendingSnapshots.splice(0).at(-1);
		if (!snapshot) return;
		const operation = this.persistenceTail.then(() =>
			context.appendCustomEntry({
				entryId: this.options.createEntryId(),
				customType: PLAN_MODE_SNAPSHOT_TYPE,
				data: snapshot,
				timestamp: new Date(this.options.now()).toISOString(),
			}),
		);
		this.latestPersistence = operation;
		this.persistenceTail = operation.catch(() => undefined);
	}
}

function latestPlanModeSnapshot(document: ConversationDocument): CodingAgentPlanModeState | undefined {
	for (const entry of [...selectConversationDocumentEntries(document)].reverse()) {
		if (entry.type !== "custom" || entry.customType !== PLAN_MODE_SNAPSHOT_TYPE) continue;
		return parsePlanModeSnapshot(entry.data, entry.id);
	}
	return undefined;
}

function samePlanModeState(left: CodingAgentPlanModeState, right: CodingAgentPlanModeState): boolean {
	return (
		left.permissionMode === right.permissionMode &&
		left.plan?.content === right.plan?.content &&
		left.plan?.status === right.plan?.status &&
		left.plan?.updatedAt === right.plan?.updatedAt
	);
}
