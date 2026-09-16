import {
	markTeamMemberContextDelivered,
	type TeamMemberTurnAttempt,
	type TeamObservationPublisher,
	type TeamPublicationOperationRecord,
	type TeamSessionDocument,
	type TeamWorkItem,
	teamMemberResultMessageId,
} from "@vetta/agent-team";
import type { AssistantMessage } from "@vetta/ai";
import type { RuntimeHost } from "@vetta/runtime-core";
import type { TeamCollaborationStore } from "./team-collaboration-store.js";
import { isTeamAttemptFinalResult } from "./team-member-result.js";
import { publicAssistantMessage } from "./team-public-message.js";
import type { TeamSessionStateRepository } from "./team-session-state-repository.js";

export interface TeamPublicationWorkflowOptions {
	readonly runtime: () => RuntimeHost;
	readonly collaborationStore: TeamCollaborationStore;
	readonly sessionState: TeamSessionStateRepository;
	readonly observations: (session: TeamSessionDocument) => TeamObservationPublisher | undefined;
}

interface ResumePublicationInput {
	readonly session: TeamSessionDocument;
	readonly publication: TeamPublicationOperationRecord;
	readonly item: TeamWorkItem;
	readonly attempt: TeamMemberTurnAttempt;
	readonly assistant: AssistantMessage;
	readonly recovered: boolean;
	readonly completeWorkItem: (publicMessageId: string) => Promise<void>;
}

/** Sole process manager for prepared -> message-published -> completed public results. */
export class TeamPublicationWorkflow {
	constructor(private readonly options: TeamPublicationWorkflowOptions) {}

	/**
	 * Publishes the visible portion of an attempt that ended without a final result.
	 * The work item is deliberately not completed here; the caller settles it with
	 * the attempt's terminal state after the message and its receipt are durable.
	 */
	async publishPartialAttempt(input: {
		readonly session: TeamSessionDocument;
		readonly item: TeamWorkItem;
		readonly attempt: TeamMemberTurnAttempt;
		readonly sourceTurnId: string;
		readonly sourceMessageEntryId: string;
		readonly assistant: AssistantMessage;
		readonly recovered?: boolean;
		readonly purpose?: "terminal-partial";
	}): Promise<string> {
		const runtimeState = input.session.memberRuntime[input.item.assignedToParticipantId];
		if (!runtimeState) throw new Error(`Team member runtime not found: ${input.item.assignedToParticipantId}`);
		const publicMessageId = teamMemberResultMessageId(
			input.session.id,
			input.item.requestTurnId,
			input.item.assignedToParticipantId,
			input.sourceTurnId,
		);
		const publication: TeamPublicationOperationRecord = {
			customType: "agent-team.publication-operation.v1",
			operationId: `publish:${input.item.id}:${input.attempt.id}`,
			workItemId: input.item.id,
			...(input.purpose ? { purpose: input.purpose } : {}),
			sourceParticipantConversationId: runtimeState.sessionId,
			sourceTurnId: input.sourceTurnId,
			sourceMessageEntryId: input.sourceMessageEntryId,
			publicMessageEntryId: publicMessageId,
			state: "prepared",
			generation: input.attempt.attempt,
		};
		const existingPublication = this.options.collaborationStore
			.read(input.session)
			.publications.find((candidate) => candidate.operationId === publication.operationId);
		if (!existingPublication) {
			await this.options.collaborationStore.append(input.session, publication.customType, publication);
			this.publishObservation(input.session, publication, input.item, input.attempt, input.recovered === true);
		}
		const coordination = input.session.coordinationRuntime;
		if (!coordination) throw new Error("Team coordination conversation is unavailable");
		const existingMessage = this.options
			.runtime()
			.readSessionDocument(coordination.sessionId)
			.entries.find((entry) => entry.id === publicMessageId);
		if (existingMessage?.type !== "message" || existingMessage.kind !== "agent") {
			await this.options.runtime().appendConversationMessage(coordination.sessionId, {
				kind: "agent",
				id: publicMessageId,
				turnId: input.item.requestTurnId,
				timestamp: input.assistant.timestamp ?? Date.now(),
				author: {
					kind: "agent",
					id: input.item.assignedToParticipantId,
					agentId: runtimeState.agentProfileId,
				},
				message: publicAssistantMessage(input.assistant),
			});
		}
		let currentPublication = existingPublication ?? publication;
		if (currentPublication.state !== "message-published" && currentPublication.state !== "completed") {
			const messagePublished = {
				...currentPublication,
				publicMessageEntryId: publicMessageId,
				state: "message-published",
			} satisfies TeamPublicationOperationRecord;
			await this.options.collaborationStore.append(input.session, messagePublished.customType, messagePublished);
			this.publishObservation(input.session, messagePublished, input.item, input.attempt, input.recovered === true);
			currentPublication = messagePublished;
		}
		return publicMessageId;
	}

	/** Publishes and closes a terminal partial without completing its work item. */
	async publishTerminalAttempt(input: {
		readonly session: TeamSessionDocument;
		readonly item: TeamWorkItem;
		readonly attempt: TeamMemberTurnAttempt;
		readonly sourceTurnId: string;
		readonly sourceMessageEntryId: string;
		readonly assistant: AssistantMessage;
		readonly recovered?: boolean;
	}): Promise<string> {
		const publicMessageId = await this.publishPartialAttempt(input);
		const publication = this.options.collaborationStore
			.read(input.session)
			.publications.find((candidate) => candidate.operationId === `publish:${input.item.id}:${input.attempt.id}`);
		if (!publication || publication.state === "completed") return publicMessageId;
		const completed = {
			...publication,
			purpose: "terminal-partial",
			publicMessageEntryId: publicMessageId,
			state: "completed",
		} satisfies TeamPublicationOperationRecord;
		await this.options.collaborationStore.append(input.session, completed.customType, completed);
		this.publishObservation(input.session, completed, input.item, input.attempt, input.recovered === true);
		return publicMessageId;
	}

	async publishAttempt(input: {
		readonly session: TeamSessionDocument;
		readonly item: TeamWorkItem;
		readonly attempt: TeamMemberTurnAttempt;
		readonly sourceTurnId: string;
		readonly sourceMessageEntryId: string;
		readonly assistant: AssistantMessage;
		readonly completeWorkItem: (publicMessageId: string) => Promise<void>;
	}): Promise<string> {
		const runtimeState = input.session.memberRuntime[input.item.assignedToParticipantId];
		if (!runtimeState) throw new Error(`Team member runtime not found: ${input.item.assignedToParticipantId}`);
		const publicMessageId = teamMemberResultMessageId(
			input.session.id,
			input.item.requestTurnId,
			input.item.assignedToParticipantId,
			input.sourceTurnId,
		);
		const publication: TeamPublicationOperationRecord = {
			customType: "agent-team.publication-operation.v1",
			operationId: `publish:${input.item.id}:${input.attempt.id}`,
			workItemId: input.item.id,
			purpose: "result",
			sourceParticipantConversationId: runtimeState.sessionId,
			sourceTurnId: input.sourceTurnId,
			sourceMessageEntryId: input.sourceMessageEntryId,
			publicMessageEntryId: publicMessageId,
			state: "prepared",
			generation: input.attempt.attempt,
		};
		await this.options.collaborationStore.append(input.session, publication.customType, publication);
		this.publishObservation(input.session, publication, input.item, input.attempt, false);
		await this.resume({
			session: input.session,
			publication,
			item: input.item,
			attempt: input.attempt,
			assistant: input.assistant,
			recovered: false,
			completeWorkItem: input.completeWorkItem,
		});
		return publicMessageId;
	}

	async recover(session: TeamSessionDocument): Promise<void> {
		const coordination = session.coordinationRuntime;
		if (!coordination) return;
		const state = this.options.collaborationStore.read(session);
		await this.recoverLegacyPublicMessages(session, state.workItems, state.attempts, state.publications);
		for (const publication of this.options.collaborationStore.read(session).publications) {
			const state = this.options.collaborationStore.read(session);
			const item = state.workItems.find((candidate) => candidate.id === publication.workItemId);
			const attempt = state.attempts.find(
				(candidate) =>
					candidate.workItemId === publication.workItemId &&
					candidate.sourceTurnId === publication.sourceTurnId &&
					candidate.attempt === publication.generation,
			);
			if (!item || !attempt || (item.currentAttemptId !== attempt.id && item.state !== "completed")) continue;
			if (publication.state === "completed") continue;

			const publicMessageId =
				publication.publicMessageEntryId ??
				teamMemberResultMessageId(
					session.id,
					item.requestTurnId,
					item.assignedToParticipantId,
					publication.sourceTurnId,
				);
			const publicEntry = this.options
				.runtime()
				.readSessionDocument(coordination.sessionId)
				.entries.find((entry) => entry.id === publicMessageId);
			const sourceEntry = this.options
				.runtime()
				.getFullHistory(publication.sourceParticipantConversationId)
				.find((entry) => entry.type === "message" && entry.entryId === publication.sourceMessageEntryId);
			const assistant =
				publicEntry?.type === "message" && publicEntry.kind === "agent"
					? publicEntry.message
					: sourceEntry?.type === "message"
						? sourceEntry.message
						: undefined;
			if (assistant?.role !== "assistant" || !hasPublicAssistantContent(assistant)) {
				await this.markNeedsRecovery(session, publication, item, attempt, publicMessageId);
				continue;
			}
			if (
				publication.purpose === "terminal-partial" ||
				item.state === "cancelled" ||
				attempt.state === "cancelled"
			) {
				await this.publishTerminalAttempt({
					session,
					item,
					attempt,
					sourceTurnId: publication.sourceTurnId,
					sourceMessageEntryId: publication.sourceMessageEntryId,
					assistant,
					recovered: true,
				});
				await this.restoreDeliveredContext(session, item, state);
				continue;
			}
			// Progress published from a failed or interrupted attempt keeps its work item
			// open. Only a final result may drive recovery to completion.
			if (!isTeamAttemptFinalResult(assistant)) {
				await this.publishPartialAttempt({
					session,
					item,
					attempt,
					sourceTurnId: publication.sourceTurnId,
					sourceMessageEntryId: publication.sourceMessageEntryId,
					assistant,
				});
				continue;
			}
			await this.resume({
				session,
				publication: { ...publication, publicMessageEntryId: publicMessageId },
				item,
				attempt,
				assistant,
				recovered: true,
				completeWorkItem: async (messageId) => {
					await this.options.collaborationStore.completePublished(session, item.id, attempt.id, messageId);
				},
			});
			await this.restoreDeliveredContext(session, item, state);
		}
	}

	/**
	 * Older Team sessions persisted member history before the public publication
	 * ledger was introduced. Rehydrate those terminal turns once so reopening a
	 * session does not silently lose the visible assistant/tool trail.
	 */
	private async recoverLegacyPublicMessages(
		session: TeamSessionDocument,
		items: readonly TeamWorkItem[],
		attempts: readonly TeamMemberTurnAttempt[],
		publications: readonly TeamPublicationOperationRecord[],
	): Promise<void> {
		const coordination = session.coordinationRuntime;
		if (!coordination) return;
		const existingIds = new Set(
			this.options
				.runtime()
				.readSessionDocument(coordination.sessionId)
				.entries.flatMap((entry) => (entry.type === "message" ? [entry.id] : [])),
		);
		const itemById = new Map(items.map((item) => [item.id, item]));
		for (const attempt of attempts) {
			if (!isTerminalAttempt(attempt.state)) continue;
			const item = itemById.get(attempt.workItemId);
			if (!item) continue;
			const runtimeState = session.memberRuntime[item.assignedToParticipantId];
			if (!runtimeState) continue;
			const publication = publications.find(
				(candidate) => candidate.operationId === `publish:${item.id}:${attempt.id}`,
			);
			const history = this.options.runtime().getFullHistory(runtimeState.sessionId);
			const objective = item.objective.trim();
			const matchingUserIndex = history.reduce(
				(index, entry, currentIndex) =>
					entry.type === "message" &&
					entry.message.role === "user" &&
					entry.message.timestamp <= attempt.lastProgressAt &&
					objective.length > 0 &&
					messageText(entry.message.content).includes(objective)
						? currentIndex
						: index,
				-1,
			);
			const lastUserIndex =
				matchingUserIndex >= 0
					? matchingUserIndex
					: history.reduce(
							(index, entry, currentIndex) =>
								entry.type === "message" &&
								entry.message.role === "user" &&
								entry.message.timestamp <= attempt.lastProgressAt
									? currentIndex
									: index,
							-1,
						);
			const nextUserOffset = history
				.slice(lastUserIndex + 1)
				.findIndex((entry) => entry.type === "message" && entry.message.role === "user");
			const attemptHistory = history.slice(
				lastUserIndex + 1,
				nextUserOffset >= 0 ? lastUserIndex + 1 + nextUserOffset : undefined,
			);
			const candidates = attemptHistory.flatMap((entry) => {
				if (
					entry.type !== "message" ||
					entry.message.role !== "assistant" ||
					!hasPublicAssistantContent(entry.message)
				)
					return [];
				return [{ entryId: entry.entryId, message: entry.message }];
			});
			const lastCandidate = candidates.at(-1);
			if (!lastCandidate?.entryId) continue;
			const publicMessageId = teamMemberResultMessageId(
				session.id,
				item.requestTurnId,
				item.assignedToParticipantId,
				publication?.sourceTurnId ?? attempt.sourceTurnId,
			);
			if (existingIds.has(publicMessageId)) continue;
			const terminalMessage = {
				...lastCandidate.message,
				content: candidates.flatMap((candidate) => publicAssistantMessage(candidate.message).content),
				...(attempt.state !== "completed" && item.state !== "completed"
					? {
							stopReason:
								item.state === "cancelled" || attempt.state === "cancelled"
									? ("aborted" as const)
									: ("error" as const),
						}
					: {}),
			};
			await this.publishTerminalAttempt({
				session,
				item,
				attempt,
				sourceTurnId: publication?.sourceTurnId ?? attempt.sourceTurnId,
				sourceMessageEntryId: publication?.sourceMessageEntryId ?? lastCandidate.entryId,
				assistant: terminalMessage,
				recovered: true,
			});
			existingIds.add(publicMessageId);
		}
	}

	private async resume(input: ResumePublicationInput): Promise<void> {
		const coordination = input.session.coordinationRuntime;
		if (!coordination) throw new Error("Team coordination conversation is unavailable");
		const publicMessageId = input.publication.publicMessageEntryId;
		if (!publicMessageId) throw new Error("Team publication is missing public message id");
		const runtimeState = input.session.memberRuntime[input.item.assignedToParticipantId];
		if (!runtimeState) throw new Error(`Team member runtime not found: ${input.item.assignedToParticipantId}`);
		const existing = this.options
			.runtime()
			.readSessionDocument(coordination.sessionId)
			.entries.find((entry) => entry.id === publicMessageId);
		if (existing?.type !== "message" || existing.kind !== "agent") {
			await this.options.runtime().appendConversationMessage(coordination.sessionId, {
				kind: "agent",
				id: publicMessageId,
				turnId: input.item.requestTurnId,
				timestamp: input.assistant.timestamp ?? Date.now(),
				author: {
					kind: "agent",
					id: input.item.assignedToParticipantId,
					agentId: runtimeState.agentProfileId,
				},
				message: publicAssistantMessage(input.assistant),
			});
		}
		if (input.publication.state !== "message-published" && input.publication.state !== "completed") {
			const messagePublished = {
				...input.publication,
				state: "message-published",
			} satisfies TeamPublicationOperationRecord;
			await this.options.collaborationStore.append(input.session, messagePublished.customType, messagePublished);
			this.publishObservation(input.session, messagePublished, input.item, input.attempt, input.recovered);
		}
		await input.completeWorkItem(publicMessageId);
		const completed = { ...input.publication, state: "completed" } satisfies TeamPublicationOperationRecord;
		await this.options.collaborationStore.append(input.session, completed.customType, completed);
		this.publishObservation(input.session, completed, input.item, input.attempt, input.recovered);
	}

	private async markNeedsRecovery(
		session: TeamSessionDocument,
		publication: TeamPublicationOperationRecord,
		item: TeamWorkItem,
		attempt: TeamMemberTurnAttempt,
		publicMessageId: string,
	): Promise<void> {
		if (publication.state === "needs-recovery") return;
		const needsRecovery = {
			...publication,
			publicMessageEntryId: publicMessageId,
			state: "needs-recovery",
		} satisfies TeamPublicationOperationRecord;
		await this.options.collaborationStore.append(session, needsRecovery.customType, needsRecovery);
		this.publishObservation(session, needsRecovery, item, attempt, true);
	}

	private async restoreDeliveredContext(
		session: TeamSessionDocument,
		item: TeamWorkItem,
		state: ReturnType<TeamCollaborationStore["read"]>,
	): Promise<void> {
		const current = this.options.sessionState.get(session.id) ?? session;
		const directContextEntryIds = state.deliveries
			.filter((delivery) => delivery.workItemId === item.id)
			.map((delivery) => delivery.messageId);
		const delivered = new Set(current.memberRuntime[item.assignedToParticipantId]?.deliveredEventIds ?? []);
		if (!directContextEntryIds.some((entryId) => !delivered.has(entryId))) return;
		await this.options.sessionState.persist(
			markTeamMemberContextDelivered({
				session: current,
				memberId: item.assignedToParticipantId,
				deliveredEventIds: directContextEntryIds,
				timestamp: Date.now(),
			}),
		);
	}

	private publishObservation(
		session: TeamSessionDocument,
		publication: TeamPublicationOperationRecord,
		item: TeamWorkItem,
		attempt: TeamMemberTurnAttempt,
		recovered: boolean,
	): void {
		this.options.observations(session)?.publishPublication({
			teamId: session.teamId,
			coordinationConversationId: session.coordinationRuntime?.sessionId ?? session.id,
			participantId: item.assignedToParticipantId,
			workItemId: item.id,
			attemptId: attempt.id,
			...(item.originToolCallId ? { toolCallId: item.originToolCallId } : {}),
			requestTurnId: item.requestTurnId,
			sourceTurnId: publication.sourceTurnId,
			...(publication.publicMessageEntryId ? { resultMessageId: publication.publicMessageEntryId } : {}),
			operationId: publication.operationId,
			phase: publication.state,
			sourceParticipantConversationId: publication.sourceParticipantConversationId,
			sourceMessageEntryId: publication.sourceMessageEntryId,
			generation: publication.generation,
			recovered,
		});
	}
}

function hasPublicAssistantContent(message: AssistantMessage): boolean {
	return publicAssistantMessage(message).content.some((part) => part.type === "text" || part.type === "toolCall");
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			if (!part || typeof part !== "object") return false;
			const candidate = part as { type?: unknown; text?: unknown };
			return candidate.type === "text" && typeof candidate.text === "string";
		})
		.map((part) => part.text)
		.join("");
}

function isTerminalAttempt(state: TeamMemberTurnAttempt["state"]): boolean {
	return (
		state === "completed" || state === "cancelled" || state === "non-retryable-failure" || state === "waiting-retry"
	);
}
