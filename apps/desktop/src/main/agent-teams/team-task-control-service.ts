import type {
	TeamDelegateTaskRequest,
	TeamExternalConditionChange,
	TeamSessionDocument,
	TeamTaskAction,
	TeamTaskCaller,
	TeamTaskControlPort,
	TeamTaskRequest,
	TeamTaskSnapshot,
	TeamWaitTasksRequest,
	TeamWaitTasksResult,
	TeamWorkItem,
} from "@vetta/agent-team";
import { matchesTeamExternalConditionChange } from "@vetta/agent-team";
import type { ConversationDocument } from "@vetta/runtime-core";
import { getAppLogger } from "../logger.js";
import type { TeamCollaborationStore } from "./team-collaboration-store.js";
import type { TeamMemberScheduler } from "./team-member-scheduler.js";
import type { TeamMemberTurnRequest } from "./team-member-turn-request.js";
import { waitForTeamTasks } from "./team-task-waiter.js";

const log = getAppLogger("agent-team-tasks");

export interface TeamTaskControlHost {
	readSession(id: string): Promise<TeamSessionDocument>;
	readConversation(id: string): ConversationDocument;
	runMemberTurn(input: TeamMemberTurnRequest): Promise<TeamSessionDocument>;
	cancelMemberTurn(sessionId: string, workItemId: string): void;
	authorizeTask(
		session: TeamSessionDocument,
		sourceMemberId: string,
		targetMemberId: string,
		action: TeamTaskAction,
	): boolean;
	resolveTarget(session: TeamSessionDocument, handle: string): string | undefined;
	onAdmitted(session: TeamSessionDocument, workItem: TeamWorkItem, created: boolean): Promise<void>;
	onSettled(session: TeamSessionDocument, workItem: TeamWorkItem): Promise<void>;
	onRequeued(
		session: TeamSessionDocument,
		workItem: TeamWorkItem,
		trigger: "manual" | "automatic" | "external-change",
	): void;
}

interface TaskExecution {
	readonly teamSessionId: string;
	readonly controller: AbortController;
	readonly completion: Promise<void>;
	readonly admittedRevision: number;
}

interface ScheduledRetry {
	readonly teamSessionId: string;
	readonly handle: ReturnType<typeof setTimeout>;
}

interface PendingExternalChanges {
	readonly teamSessionId: string;
	readonly changes: readonly TeamExternalConditionChange[];
}

const MAX_AUTOMATIC_ATTEMPTS = 3;

/** Owns accepted task lifetimes, independently of the model call that dispatched them. */
export class TeamTaskControlService {
	private readonly executions = new Map<string, TaskExecution>();
	private readonly scheduledRetries = new Map<string, ScheduledRetry>();
	private readonly pendingExternalChanges = new Map<string, PendingExternalChanges>();

	constructor(
		private readonly store: TeamCollaborationStore,
		private readonly scheduler: TeamMemberScheduler,
		private readonly host: TeamTaskControlHost,
	) {}

	forSession(teamSessionId: string): TeamTaskControlPort {
		return {
			delegateTask: (input) => this.delegateTask(teamSessionId, input),
			getTask: (input) => this.getTask(teamSessionId, input),
			waitTasks: (input) => this.waitTasks(teamSessionId, input),
			resumeTask: (input) => this.resumeTask(teamSessionId, input),
			cancelTask: (input) => this.cancelTask(teamSessionId, input),
		};
	}

	hasPending(teamSessionId: string): boolean {
		return (
			[...this.executions.values()].some((execution) => execution.teamSessionId === teamSessionId) ||
			[...this.scheduledRetries.values()].some((retry) => retry.teamSessionId === teamSessionId)
		);
	}

	abortTeam(teamSessionId: string): void {
		for (const execution of this.executions.values()) {
			if (execution.teamSessionId === teamSessionId) execution.controller.abort();
		}
		for (const [key, retry] of this.scheduledRetries) {
			if (retry.teamSessionId !== teamSessionId) continue;
			clearTimeout(retry.handle);
			this.scheduledRetries.delete(key);
		}
		for (const [key, pending] of this.pendingExternalChanges) {
			if (pending.teamSessionId === teamSessionId) this.pendingExternalChanges.delete(key);
		}
	}

	async recoverSession(session: TeamSessionDocument): Promise<void> {
		for (const item of this.store.read(session).workItems) {
			if (item.state === "running") await this.store.recoverOrphanedAttempt(session, item.id);
		}
		for (const item of this.store.read(session).workItems) {
			if (item.state === "queued") {
				this.start(item.currentAttemptId ? "recovery" : "initial", session, item);
				continue;
			}
			this.scheduleAutomaticRetry(session, item);
		}
	}

	startAdmitted(
		session: TeamSessionDocument,
		item: TeamWorkItem,
		mode: "initial" | "continue" | "retry" | "recovery",
	): void {
		this.start(mode, session, item);
	}

	async notifyExternalConditionChanged(
		session: TeamSessionDocument,
		change: TeamExternalConditionChange,
	): Promise<number> {
		let resumed = 0;
		for (const snapshot of this.store.read(session).workItems) {
			const latestSession = await this.host.readSession(session.id);
			const item = this.store.read(latestSession).workItems.find((candidate) => candidate.id === snapshot.id);
			if (!item) continue;
			if (item.state === "running") {
				this.rememberExternalChange(latestSession.id, item.id, change);
				continue;
			}
			if (!this.matchesExternalWait(latestSession, item, change)) continue;
			if (await this.requeueAndStart(latestSession, item, "retry", "external-change")) resumed += 1;
		}
		return resumed;
	}

	async onWorkItemSettled(session: TeamSessionDocument, item: TeamWorkItem): Promise<void> {
		const key = executionKey(session.id, item.id);
		const changes = this.pendingExternalChanges.get(key)?.changes ?? [];
		this.pendingExternalChanges.delete(key);
		if (
			item.state === "attention-required" &&
			changes.some((change) => this.matchesExternalWait(session, item, change))
		) {
			if (await this.requeueAndStart(session, item, "retry", "external-change")) return;
		}
		this.scheduleAutomaticRetry(session, item, this.executions.get(key)?.controller);
	}

	private async caller(teamSessionId: string, input: TeamTaskCaller) {
		input.signal.throwIfAborted();
		const session = await this.host.readSession(teamSessionId);
		input.signal.throwIfAborted();
		const source = Object.entries(session.memberRuntime).find(
			([, runtime]) => runtime.sessionId === input.sourceRuntimeSessionId,
		);
		if (!source || !isActiveMember(session, source[0]))
			throw new Error("Source session is not a persistent member of this Agent Team");
		return { session, sourceMemberId: source[0] };
	}

	private authorize(session: TeamSessionDocument, source: string, target: string, action: TeamTaskAction): void {
		if (!isActiveMember(session, target)) throw new Error(`Target is not an active Team member: ${target}`);
		if (!this.host.authorizeTask(session, source, target, action))
			throw new Error(`Team task ${action} is not permitted for this member`);
	}

	private async delegateTask(teamSessionId: string, input: TeamDelegateTaskRequest): Promise<TeamTaskSnapshot> {
		const { session, sourceMemberId } = await this.caller(teamSessionId, input);
		const target = this.host.resolveTarget(session, input.targetHandle);
		if (!target) throw new Error(`Unknown team member handle: ${input.targetHandle}`);
		this.authorize(session, sourceMemberId, target, "delegate");
		const requestId = `task:${sourceMemberId}:${input.sourceTurnId}:${input.requestId}`;
		const admitted = await this.store.enqueueAssignment({
			session,
			memberId: target,
			requestId,
			originToolCallId: input.toolCallId,
			createdByParticipantId: sourceMemberId,
			objective: input.objective,
		});
		await this.host.onAdmitted(session, admitted.workItem, admitted.created);
		// Admission is durable now. The caller's AbortSignal no longer owns this work.
		if (admitted.workItem.state === "queued") this.start("initial", session, admitted.workItem);
		return this.snapshot(session, admitted.workItem.id);
	}

	private async getTask(teamSessionId: string, input: TeamTaskRequest): Promise<TeamTaskSnapshot> {
		const { session } = await this.caller(teamSessionId, input);
		return this.snapshot(session, input.teamTaskId);
	}

	private async waitTasks(teamSessionId: string, input: TeamWaitTasksRequest): Promise<TeamWaitTasksResult> {
		if (
			!Number.isInteger(input.timeoutMs) ||
			input.timeoutMs < 0 ||
			input.timeoutMs > 60_000 ||
			input.teamTaskIds.length === 0 ||
			input.teamTaskIds.length > 8 ||
			new Set(input.teamTaskIds).size !== input.teamTaskIds.length
		) {
			throw new Error("Invalid Team task wait bounds");
		}
		const { session, sourceMemberId } = await this.caller(teamSessionId, input);
		const read = () => input.teamTaskIds.map((id) => this.snapshot(session, id));
		const tasks = read();
		const wait = () =>
			waitForTeamTasks({
				read,
				subscribe: (listener) => this.store.subscribe(session.id, listener),
				signal: input.signal,
				timeoutMs: input.timeoutMs,
			});
		if (input.timeoutMs === 0 || tasks.some((task) => isActionable(task.workItem))) return wait();
		return this.scheduler.whileWaiting(
			session.id,
			sourceMemberId,
			tasks.map((task) => task.workItem.assignedToParticipantId),
			wait,
		);
	}

	private async resumeTask(
		teamSessionId: string,
		input: TeamTaskRequest & { readonly mode: "continue" | "retry" },
	): Promise<TeamTaskSnapshot> {
		const { session, sourceMemberId } = await this.caller(teamSessionId, input);
		const snapshot = this.snapshot(session, input.teamTaskId);
		const item = snapshot.workItem;
		this.authorize(session, sourceMemberId, item.assignedToParticipantId, "resume");
		if (item.state === "queued" || item.state === "running") return snapshot;
		if (item.state !== "waiting" && item.state !== "attention-required")
			throw new Error(`Team task cannot resume from state: ${item.state}`);
		await this.requeueAndStart(session, item, input.mode, "manual");
		return this.snapshot(session, item.id);
	}

	private async cancelTask(teamSessionId: string, input: TeamTaskRequest): Promise<TeamTaskSnapshot> {
		const { session, sourceMemberId } = await this.caller(teamSessionId, input);
		const item = this.snapshot(session, input.teamTaskId).workItem;
		this.authorize(session, sourceMemberId, item.assignedToParticipantId, "cancel");
		this.executions.get(executionKey(session.id, item.id))?.controller.abort();
		this.clearScheduledRetry(session.id, item.id);
		this.host.cancelMemberTurn(session.id, item.id);
		await this.store.cancelIdle(session, item.id);
		return this.snapshot(session, item.id);
	}

	private start(
		mode: "initial" | "continue" | "retry" | "recovery",
		session: TeamSessionDocument,
		item: TeamWorkItem,
	): void {
		const key = executionKey(session.id, item.id);
		this.clearScheduledRetry(session.id, item.id);
		const previous = this.executions.get(key);
		if (previous?.admittedRevision === item.revision) return;
		const controller = new AbortController();
		const completion = (previous?.completion ?? Promise.resolve())
			.then(async () => {
				try {
					await this.host.runMemberTurn({
						teamSessionId: session.id,
						memberId: item.assignedToParticipantId,
						requestId: item.requestTurnId,
						promptText: item.objective,
						sourceTurnId: `${item.requestTurnId}:${item.assignedToParticipantId}:${mode}:${item.revision}`,
						createdByParticipantId: item.createdByParticipantId,
						attachments: item.artifactRefs,
						workItemKind: item.kind,
						...(item.kind === "question"
							? {
									directContextEntryIds: this.store
										.read(session)
										.deliveries.filter((delivery) => delivery.workItemId === item.id)
										.map((delivery) => delivery.messageId),
								}
							: {}),
						mode,
						signal: controller.signal,
						...(mode !== "initial" ? { expectedWorkItemRevision: item.revision } : {}),
					});
				} catch (error) {
					await this.store.releaseQueued(session, item.id, controller.signal.aborted ? "cancelled" : "waiting");
					log.warn("Team task execution stopped", {
						teamSessionId: session.id,
						workItemId: item.id,
						cancelled: controller.signal.aborted,
						errorName: error instanceof Error ? error.name : "UnknownError",
					});
				}
				const latestSession = await this.host.readSession(session.id);
				const latest = this.store.read(latestSession).workItems.find((candidate) => candidate.id === item.id);
				if (latest) await this.host.onSettled(latestSession, latest);
			})
			.catch((error: unknown) => {
				// Storage can itself be unavailable. Keep its durable state for restart recovery.
				log.error("Team task state could not be settled", {
					teamSessionId: session.id,
					workItemId: item.id,
					errorName: error instanceof Error ? error.name : "UnknownError",
				});
			})
			.finally(() => {
				if (this.executions.get(key)?.controller === controller) this.executions.delete(key);
			});
		this.executions.set(key, { teamSessionId: session.id, controller, completion, admittedRevision: item.revision });
	}

	private scheduleAutomaticRetry(
		session: TeamSessionDocument,
		item: TeamWorkItem,
		currentExecution?: AbortController,
	): void {
		if (item.state !== "waiting" || !item.currentAttemptId) return;
		const attempt = this.store.read(session).attempts.find((candidate) => candidate.id === item.currentAttemptId);
		if (
			attempt?.state !== "waiting-retry" ||
			attempt.attempt >= MAX_AUTOMATIC_ATTEMPTS ||
			attempt.nextRetryAt === undefined
		) {
			return;
		}
		const key = executionKey(session.id, item.id);
		const existingExecution = this.executions.get(key);
		if (this.scheduledRetries.has(key) || (existingExecution && existingExecution.controller !== currentExecution))
			return;
		const handle = setTimeout(
			() => {
				this.scheduledRetries.delete(key);
				void this.host
					.readSession(session.id)
					.then(async (latestSession) => {
						const latest = this.store.read(latestSession).workItems.find((candidate) => candidate.id === item.id);
						if (!latest || latest.state !== "waiting" || latest.revision !== item.revision) return;
						await this.requeueAndStart(latestSession, latest, "retry", "automatic");
					})
					.catch((error: unknown) => {
						log.warn("Team automatic retry could not be scheduled", {
							teamSessionId: session.id,
							workItemId: item.id,
							errorName: error instanceof Error ? error.name : "UnknownError",
						});
					});
			},
			Math.max(0, attempt.nextRetryAt - Date.now()),
		);
		this.scheduledRetries.set(key, { teamSessionId: session.id, handle });
	}

	private async requeueAndStart(
		session: TeamSessionDocument,
		item: TeamWorkItem,
		mode: "continue" | "retry",
		trigger: "manual" | "automatic" | "external-change",
	): Promise<boolean> {
		const result = await this.store.requeue(session, item.id, item.revision);
		if (!result.requeued) return false;
		try {
			this.host.onRequeued(session, result.workItem, trigger);
		} catch (error) {
			log.warn("Team recovery observation could not be published", {
				teamSessionId: session.id,
				workItemId: item.id,
				errorName: error instanceof Error ? error.name : "UnknownError",
			});
		}
		this.start(mode, session, result.workItem);
		return true;
	}

	private matchesExternalWait(
		session: TeamSessionDocument,
		item: TeamWorkItem,
		change: TeamExternalConditionChange,
	): boolean {
		if (item.state !== "attention-required" || !item.currentAttemptId) return false;
		const attempt = this.store.read(session).attempts.find((candidate) => candidate.id === item.currentAttemptId);
		return attempt?.state === "awaiting-resource" && matchesTeamExternalConditionChange(attempt.issue, change);
	}

	private rememberExternalChange(
		teamSessionId: string,
		workItemId: string,
		change: TeamExternalConditionChange,
	): void {
		const key = executionKey(teamSessionId, workItemId);
		const changes = this.pendingExternalChanges.get(key)?.changes ?? [];
		if (
			changes.some(
				(candidate) =>
					candidate.category === change.category &&
					candidate.provider === change.provider &&
					candidate.modelId === change.modelId,
			)
		) {
			return;
		}
		this.pendingExternalChanges.set(key, { teamSessionId, changes: [...changes, change] });
	}

	private clearScheduledRetry(teamSessionId: string, itemId: string): void {
		const key = executionKey(teamSessionId, itemId);
		const retry = this.scheduledRetries.get(key);
		if (!retry) return;
		clearTimeout(retry.handle);
		this.scheduledRetries.delete(key);
	}

	private snapshot(session: TeamSessionDocument, id: string): TeamTaskSnapshot {
		const state = this.store.read(session);
		const workItem = state.workItems.find((item) => item.id === id);
		if (!workItem) throw new Error(`Team task not found: ${id}`);
		const attempt = state.attempts.find((candidate) => candidate.id === workItem.currentAttemptId);
		const document = session.coordinationRuntime
			? this.host.readConversation(session.coordinationRuntime.sessionId)
			: undefined;
		const result = document?.entries.find((entry) => entry.id === workItem.resultMessageId);
		return {
			teamTaskId: id,
			workItem,
			...(attempt ? { attempt } : {}),
			...(result?.type === "message" && result.kind === "agent"
				? {
						result: {
							messageId: result.id,
							authorId: result.author.id,
							text: result.message.content
								.filter((block) => block.type === "text")
								.map((block) => block.text)
								.join("\n"),
						},
					}
				: {}),
		};
	}
}

function isActiveMember(session: TeamSessionDocument, id: string): boolean {
	return !!session.memberRuntime[id] && (session.activeMemberIds?.includes(id) ?? true);
}

function executionKey(sessionId: string, itemId: string): string {
	return JSON.stringify([sessionId, itemId]);
}

function isActionable(item: TeamWorkItem): boolean {
	return item.state !== "queued" && item.state !== "running";
}
