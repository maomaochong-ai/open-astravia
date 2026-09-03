import {
	type classifyTeamAttemptTerminal,
	isTeamContextProjectionReceipt,
	isTeamMemberTurnAttempt,
	isTeamMessageDelivery,
	isTeamPublicationOperationRecord,
	isTeamSharedContextCheckpoint,
	isTeamSharedContextGeneration,
	isTeamWorkItem,
	type TeamContextProjectionReceipt,
	type TeamMemberTurnAttempt,
	type TeamMemberTurnAttemptMode,
	type TeamMessageDelivery,
	type TeamPublicationOperationRecord,
	type TeamSessionDocument,
	type TeamSharedContextCheckpoint,
	type TeamSharedContextGeneration,
	type TeamWorkItem,
	transitionTeamMessageDelivery,
	transitionTeamWorkItem,
} from "@vetta/agent-team";
import type { ConversationDocument, PromptAttachmentRef } from "@vetta/runtime-core";
import { TeamOperationQueue } from "./team-operation-queue.js";

export interface TeamCollaborationConversationPort {
	readSessionDocument(sessionId: string): ConversationDocument;
	appendSessionMetadataEntry(sessionId: string, customType: string, data?: unknown): Promise<void>;
}

export interface TeamCollaborationState {
	readonly workItems: readonly TeamWorkItem[];
	readonly attempts: readonly TeamMemberTurnAttempt[];
	readonly deliveries: readonly TeamMessageDelivery[];
	readonly publications: readonly TeamPublicationOperationRecord[];
	readonly checkpoints: readonly TeamSharedContextCheckpoint[];
	readonly contextGenerations: readonly TeamSharedContextGeneration[];
	readonly contextReceipts: readonly TeamContextProjectionReceipt[];
}

export interface TeamWorkItemInput {
	readonly session: TeamSessionDocument;
	readonly memberId: string;
	readonly requestId: string;
	readonly originToolCallId?: string;
	readonly createdByParticipantId: string;
	readonly objective: string;
	readonly attachments?: readonly PromptAttachmentRef[];
	readonly kind?: "task" | "question";
}

export class TeamCollaborationStore {
	private readonly mutations = new TeamOperationQueue();
	private readonly listeners = new Map<string, Set<() => void>>();

	constructor(private readonly conversation: TeamCollaborationConversationPort) {}

	readDocument(session: TeamSessionDocument): ConversationDocument {
		const coordination = session.coordinationRuntime;
		if (!coordination) throw new Error("Team coordination conversation is unavailable");
		return this.conversation.readSessionDocument(coordination.sessionId);
	}

	subscribe(sessionId: string, listener: () => void): () => void {
		const listeners = this.listeners.get(sessionId) ?? new Set<() => void>();
		listeners.add(listener);
		this.listeners.set(sessionId, listeners);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) this.listeners.delete(sessionId);
		};
	}

	read(session: TeamSessionDocument): TeamCollaborationState {
		const coordination = session.coordinationRuntime;
		if (!coordination)
			return {
				workItems: [],
				attempts: [],
				deliveries: [],
				publications: [],
				checkpoints: [],
				contextGenerations: [],
				contextReceipts: [],
			};
		const entries = this.readDocument(session).entries;
		const workItems = new Map<string, TeamWorkItem>();
		const attempts = new Map<string, TeamMemberTurnAttempt>();
		const deliveries = new Map<string, TeamMessageDelivery>();
		const publications = new Map<string, TeamPublicationOperationRecord>();
		const checkpoints = new Map<string, TeamSharedContextCheckpoint>();
		const contextGenerations = new Map<string, TeamSharedContextGeneration>();
		const contextReceipts = new Map<string, TeamContextProjectionReceipt>();
		for (const entry of entries) {
			if (entry.type !== "custom") continue;
			if (entry.customType === "agent-team.work-item.v1" && isTeamWorkItem(entry.data)) {
				workItems.set(entry.data.id, entry.data);
			}
			if (entry.customType === "agent-team.member-attempt.v1" && isTeamMemberTurnAttempt(entry.data)) {
				attempts.set(entry.data.id, entry.data);
			}
			if (entry.customType === "agent-team.message-delivery.v1" && isTeamMessageDelivery(entry.data)) {
				deliveries.set(entry.data.id, entry.data);
			}
			if (
				entry.customType === "agent-team.publication-operation.v1" &&
				isTeamPublicationOperationRecord(entry.data)
			) {
				publications.set(entry.data.operationId, entry.data);
			}
			if (entry.customType === "agent-team.shared-checkpoint.v1" && isTeamSharedContextCheckpoint(entry.data)) {
				checkpoints.set(entry.data.id, entry.data);
			}
			if (entry.customType === "agent-team.context-generation.v1" && isTeamSharedContextGeneration(entry.data)) {
				contextGenerations.set(entry.data.id, entry.data);
			}
			if (entry.customType === "agent-team.context-receipt.v1" && isTeamContextProjectionReceipt(entry.data)) {
				contextReceipts.set(JSON.stringify([entry.data.participantId, entry.data.generationId]), entry.data);
			}
		}
		return {
			workItems: [...workItems.values()],
			attempts: [...attempts.values()],
			deliveries: [...deliveries.values()],
			publications: [...publications.values()],
			checkpoints: [...checkpoints.values()],
			contextGenerations: [...contextGenerations.values()],
			contextReceipts: [...contextReceipts.values()],
		};
	}

	async append(session: TeamSessionDocument, customType: string, data: unknown): Promise<void> {
		const coordination = session.coordinationRuntime;
		if (!coordination) throw new Error("Team coordination conversation is unavailable");
		await this.conversation.appendSessionMetadataEntry(coordination.sessionId, customType, data);
		if (customType === "agent-team.work-item.v1") {
			for (const listener of this.listeners.get(session.id) ?? []) {
				try {
					listener();
				} catch {
					// A listener cannot roll back an already durable state transition.
				}
			}
		}
	}

	enqueue(input: TeamWorkItemInput): Promise<{ workItem: TeamWorkItem; created: boolean }> {
		return this.mutations.run(input.session.id, () => this.getOrCreateWorkItem(input));
	}

	enqueueAssignment(input: TeamWorkItemInput): Promise<{ workItem: TeamWorkItem; created: boolean }> {
		return this.mutations.run(input.session.id, async () => {
			const existing = this.read(input.session).workItems.find((item) => item.requestTurnId === input.requestId);
			if (existing && existing.assignedToParticipantId !== input.memberId) {
				throw new Error("Team assignment request id was reused with a different target");
			}
			return this.getOrCreateWorkItem(input);
		});
	}

	private async getOrCreateWorkItem(input: TeamWorkItemInput): Promise<{ workItem: TeamWorkItem; created: boolean }> {
		if (!input.session.memberRuntime[input.memberId]) {
			throw new Error(`Team member runtime not found: ${input.memberId}`);
		}
		const workItemId = `work:${input.requestId}:${input.memberId}`;
		let workItem = this.read(input.session).workItems.find((item) => item.id === workItemId);
		const created = workItem === undefined;
		if (!workItem) {
			const now = Date.now();
			workItem = {
				id: workItemId,
				requestTurnId: input.requestId,
				...(input.originToolCallId ? { originToolCallId: input.originToolCallId } : {}),
				createdByParticipantId: input.createdByParticipantId,
				assignedToParticipantId: input.memberId,
				objective: input.objective,
				...(input.kind ? { kind: input.kind } : {}),
				contextEntryIds: [],
				...(input.attachments?.length ? { artifactRefs: [...input.attachments] } : {}),
				state: "queued",
				createdAt: now,
				updatedAt: now,
				revision: 0,
			};
			await this.append(input.session, "agent-team.work-item.v1", workItem);
		} else if (
			workItem.assignedToParticipantId !== input.memberId ||
			workItem.objective !== input.objective ||
			workItem.createdByParticipantId !== input.createdByParticipantId ||
			(input.originToolCallId !== undefined && workItem.originToolCallId !== input.originToolCallId) ||
			(workItem.kind ?? "task") !== (input.kind ?? "task") ||
			!sameArtifacts(workItem.artifactRefs ?? [], input.attachments ?? [])
		) {
			throw new Error(`Team work item identity was reused with different content: ${workItemId}`);
		}
		return { workItem, created };
	}

	createDeliveries(
		session: TeamSessionDocument,
		deliveries: readonly TeamMessageDelivery[],
	): Promise<readonly TeamMessageDelivery[]> {
		return this.mutations.run(session.id, async () => {
			const current = this.read(session).deliveries;
			const result: TeamMessageDelivery[] = [];
			for (const delivery of deliveries) {
				const existing = current.find((candidate) => candidate.id === delivery.id);
				if (existing) {
					if (
						existing.messageId !== delivery.messageId ||
						existing.fromParticipantId !== delivery.fromParticipantId ||
						existing.toParticipantId !== delivery.toParticipantId ||
						existing.intent !== delivery.intent
					) {
						throw new Error(`Team delivery identity was reused with different content: ${delivery.id}`);
					}
					result.push(existing);
					continue;
				}
				await this.append(session, "agent-team.message-delivery.v1", delivery);
				result.push(delivery);
			}
			return result;
		});
	}

	updateDelivery(
		session: TeamSessionDocument,
		deliveryId: string,
		input: { readonly state: TeamMessageDelivery["state"]; readonly replyMessageId?: string },
	): Promise<TeamMessageDelivery> {
		return this.mutations.run(session.id, async () => {
			const current = this.read(session).deliveries.find((delivery) => delivery.id === deliveryId);
			if (!current) throw new Error(`Team message delivery not found: ${deliveryId}`);
			if (current.state === input.state && current.replyMessageId === input.replyMessageId) return current;
			const next = transitionTeamMessageDelivery(current, { ...input, updatedAt: Date.now() });
			await this.append(session, "agent-team.message-delivery.v1", next);
			return next;
		});
	}

	ensureSharedContext(
		session: TeamSessionDocument,
		checkpoint: TeamSharedContextCheckpoint,
		generation: TeamSharedContextGeneration,
	): Promise<{ readonly checkpoint: TeamSharedContextCheckpoint; readonly generation: TeamSharedContextGeneration }> {
		return this.mutations.run(session.id, async () => {
			const current = this.read(session);
			const existingCheckpoint = current.checkpoints.find((candidate) => candidate.id === checkpoint.id);
			if (existingCheckpoint && existingCheckpoint.sourceFingerprint !== checkpoint.sourceFingerprint) {
				throw new Error(`Team shared checkpoint id collision: ${checkpoint.id}`);
			}
			const resolvedCheckpoint = existingCheckpoint ?? checkpoint;
			if (!existingCheckpoint) await this.append(session, "agent-team.shared-checkpoint.v1", checkpoint);
			const existingGeneration = this.read(session).contextGenerations.find(
				(candidate) => candidate.id === generation.id,
			);
			if (
				existingGeneration &&
				(existingGeneration.checkpointId !== generation.checkpointId ||
					existingGeneration.sourceFingerprint !== generation.sourceFingerprint)
			) {
				throw new Error(`Team shared generation id collision: ${generation.id}`);
			}
			const resolvedGeneration = existingGeneration ?? generation;
			if (!existingGeneration) await this.append(session, "agent-team.context-generation.v1", generation);
			return { checkpoint: resolvedCheckpoint, generation: resolvedGeneration };
		});
	}

	begin(
		input: TeamWorkItemInput & {
			readonly sourceTurnId: string;
			readonly mode: TeamMemberTurnAttemptMode;
		},
	): Promise<{ workItem: TeamWorkItem; attempt: TeamMemberTurnAttempt; created: boolean }> {
		return this.mutations.run(input.session.id, async () => {
			const admitted = await this.getOrCreateWorkItem(input);
			let { workItem } = admitted;
			if (workItem.state === "running") throw new Error(`Team work item is already running: ${workItem.id}`);
			if (workItem.state === "completed" || workItem.state === "cancelled" || workItem.state === "failed") {
				throw new Error(`Team work item is terminal: ${workItem.id}`);
			}
			if (workItem.state === "attention-required") {
				workItem = transitionTeamWorkItem(workItem, { state: "queued", updatedAt: Date.now() });
				await this.append(input.session, "agent-team.work-item.v1", workItem);
			}
			if (workItem.state === "queued" || workItem.state === "waiting") {
				workItem = transitionTeamWorkItem(workItem, { state: "running", updatedAt: Date.now() });
			}
			const workItemId = workItem.id;
			const priorAttempts = this.read(input.session).attempts.filter((attempt) => attempt.workItemId === workItemId);
			const attemptNumber = priorAttempts.reduce((maximum, attempt) => Math.max(maximum, attempt.attempt), 0) + 1;
			const attempt: TeamMemberTurnAttempt = {
				id: `attempt:${workItemId}:${attemptNumber}`,
				workItemId,
				participantConversationId: input.session.memberRuntime[input.memberId]?.sessionId ?? "",
				sourceTurnId: input.sourceTurnId,
				attempt: attemptNumber,
				mode: input.mode,
				state: "running",
				lastProgressAt: Date.now(),
			};
			workItem = { ...workItem, currentAttemptId: attempt.id };
			await this.append(input.session, "agent-team.work-item.v1", workItem);
			await this.append(input.session, "agent-team.member-attempt.v1", attempt);
			return { workItem, attempt, created: admitted.created };
		});
	}

	releaseQueued(
		session: TeamSessionDocument,
		workItemId: string,
		state: "cancelled" | "waiting",
	): Promise<TeamWorkItem | undefined> {
		return this.mutations.run(session.id, async () => {
			const item = this.read(session).workItems.find((candidate) => candidate.id === workItemId);
			if (!item || item.state !== "queued") return;
			const next = transitionTeamWorkItem(item, { state, updatedAt: Date.now() });
			await this.append(session, "agent-team.work-item.v1", next);
			return next;
		});
	}

	async settle(
		session: TeamSessionDocument,
		workItem: TeamWorkItem,
		attempt: TeamMemberTurnAttempt,
		terminal: ReturnType<typeof classifyTeamAttemptTerminal>,
		resultMessageId?: string,
	): Promise<TeamWorkItem> {
		return this.mutations.run(session.id, async () => {
			const current = this.read(session).workItems.find((item) => item.id === workItem.id);
			if (!current || current.currentAttemptId !== attempt.id) {
				throw new Error(`Team attempt no longer owns the work item: ${attempt.id}`);
			}
			const nextAttempt: TeamMemberTurnAttempt = {
				...attempt,
				...terminal,
				...(terminal.state === "waiting-retry"
					? { nextRetryAt: Date.now() + automaticRetryDelay(attempt.attempt, terminal.issue?.retryAfter) }
					: {}),
				lastProgressAt: Date.now(),
			};
			const workItemState = workItemStateForAttempt(nextAttempt);
			if (current.state !== "running") {
				if (current.state === workItemState && current.resultMessageId === resultMessageId) return current;
				throw new Error(`Team attempt is already settled: ${attempt.id}`);
			}
			const nextWorkItem = transitionTeamWorkItem(current, {
				state: workItemState,
				updatedAt: Date.now(),
				...(resultMessageId ? { resultMessageId } : {}),
				...(nextAttempt.issue ? { issue: nextAttempt.issue } : {}),
			});
			await this.append(session, "agent-team.member-attempt.v1", nextAttempt);
			await this.append(session, "agent-team.work-item.v1", nextWorkItem);
			return nextWorkItem;
		});
	}

	completePublished(
		session: TeamSessionDocument,
		workItemId: string,
		attemptId: string,
		resultMessageId: string,
	): Promise<TeamWorkItem> {
		return this.mutations.run(session.id, async () => {
			const state = this.read(session);
			const item = state.workItems.find((candidate) => candidate.id === workItemId);
			if (!item) throw new Error(`Team work item not found: ${workItemId}`);
			if (item.state === "completed" && item.resultMessageId === resultMessageId) return item;
			if (item.currentAttemptId !== attemptId) {
				throw new Error(`Team publication attempt no longer owns the work item: ${attemptId}`);
			}
			if (item.state !== "running" && item.state !== "waiting" && item.state !== "attention-required") {
				throw new Error(`Team publication cannot complete work item from state: ${item.state}`);
			}
			const attempt = state.attempts.find((candidate) => candidate.id === attemptId);
			if (!attempt) throw new Error(`Team attempt not found: ${attemptId}`);
			if (attempt.state !== "completed") {
				await this.append(session, "agent-team.member-attempt.v1", {
					...attempt,
					state: "completed",
					lastProgressAt: Date.now(),
				});
			}
			const next = transitionTeamWorkItem(item, {
				state: "completed",
				updatedAt: Date.now(),
				resultMessageId,
			});
			await this.append(session, "agent-team.work-item.v1", next);
			return next;
		});
	}

	recoverOrphanedAttempt(session: TeamSessionDocument, workItemId: string): Promise<TeamWorkItem | undefined> {
		return this.mutations.run(session.id, async () => {
			const state = this.read(session);
			const item = state.workItems.find((candidate) => candidate.id === workItemId);
			if (!item || item.state !== "running" || !item.currentAttemptId) return item;
			const attempt = state.attempts.find((candidate) => candidate.id === item.currentAttemptId);
			if (!attempt || attempt.state !== "running") return item;
			const issue = {
				category: "host-interrupted" as const,
				retryability: "automatic" as const,
				code: "team_host_interrupted",
			};
			const now = Date.now();
			await this.append(session, "agent-team.member-attempt.v1", {
				...attempt,
				state: "waiting-retry",
				issue,
				nextRetryAt: now,
				lastProgressAt: now,
			});
			const next = transitionTeamWorkItem(item, { state: "waiting", issue, updatedAt: now });
			await this.append(session, "agent-team.work-item.v1", next);
			return next;
		});
	}

	cancelIdle(session: TeamSessionDocument, workItemId: string): Promise<void> {
		return this.mutations.run(session.id, async () => {
			const item = this.read(session).workItems.find((candidate) => candidate.id === workItemId);
			if (!item) throw new Error(`Team work item not found: ${workItemId}`);
			if (item.state !== "queued" && item.state !== "waiting" && item.state !== "attention-required") return;
			await this.append(
				session,
				"agent-team.work-item.v1",
				transitionTeamWorkItem(item, { state: "cancelled", updatedAt: Date.now() }),
			);
		});
	}

	requeue(
		session: TeamSessionDocument,
		workItemId: string,
		expectedRevision: number,
	): Promise<{ readonly workItem: TeamWorkItem; readonly requeued: boolean }> {
		return this.mutations.run(session.id, async () => {
			const item = this.read(session).workItems.find((candidate) => candidate.id === workItemId);
			if (!item) throw new Error(`Team work item not found: ${workItemId}`);
			if (item.revision !== expectedRevision) return { workItem: item, requeued: false };
			if (item.state !== "waiting" && item.state !== "attention-required")
				throw new Error(`Team task cannot resume from state: ${item.state}`);
			const next = transitionTeamWorkItem(item, { state: "queued", updatedAt: Date.now() });
			await this.append(session, "agent-team.work-item.v1", next);
			return { workItem: next, requeued: true };
		});
	}
}

function sameArtifacts(left: readonly PromptAttachmentRef[], right: readonly PromptAttachmentRef[]): boolean {
	const keys = (refs: readonly PromptAttachmentRef[]) =>
		refs.map((ref) => JSON.stringify([ref.kind, ref.path])).sort();
	const leftKeys = keys(left);
	const rightKeys = keys(right);
	return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

function workItemStateForAttempt(attempt: TeamMemberTurnAttempt): TeamWorkItem["state"] {
	switch (attempt.state) {
		case "completed":
			return "completed";
		case "cancelled":
			return "cancelled";
		case "non-retryable-failure":
			return "failed";
		case "awaiting-resource":
			return "attention-required";
		default:
			return "waiting";
	}
}

function automaticRetryDelay(attempt: number, providerDelay: number | undefined): number {
	if (providerDelay !== undefined) return Math.max(0, Math.min(providerDelay, 60_000));
	return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 30_000);
}
