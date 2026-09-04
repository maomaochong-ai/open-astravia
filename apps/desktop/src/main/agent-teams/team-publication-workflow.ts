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
			if (item.state === "completed" && publication.state === "completed") continue;

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
			if (assistant?.role !== "assistant" || assistantText(assistant).trim().length === 0) {
				await this.markNeedsRecovery(session, publication, item, attempt, publicMessageId);
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

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}
