import {
	type classifyTeamAttemptTerminal,
	isTeamMemberTurnAttempt,
	isTeamWorkItem,
	type TeamMemberTurnAttempt,
	type TeamMemberTurnAttemptMode,
	type TeamSessionDocument,
	type TeamWorkItem,
	transitionTeamWorkItem,
} from "@vetta/agent-team";
import type { ConversationDocument, PromptAttachmentRef } from "@vetta/runtime-core";

export interface TeamCollaborationConversationPort {
	readSessionDocument(sessionId: string): ConversationDocument;
	appendSessionMetadataEntry(sessionId: string, customType: string, data?: unknown): Promise<void>;
}

export interface TeamCollaborationState {
	readonly workItems: readonly TeamWorkItem[];
	readonly attempts: readonly TeamMemberTurnAttempt[];
}

export class TeamCollaborationStore {
	constructor(private readonly conversation: TeamCollaborationConversationPort) {}

	read(session: TeamSessionDocument): TeamCollaborationState {
		const coordination = session.coordinationRuntime;
		if (!coordination) return { workItems: [], attempts: [] };
		const entries = this.conversation.readSessionDocument(coordination.sessionId).entries;
		const workItems = new Map<string, TeamWorkItem>();
		const attempts = new Map<string, TeamMemberTurnAttempt>();
		for (const entry of entries) {
			if (entry.type !== "custom") continue;
			if (entry.customType === "agent-team.work-item.v1" && isTeamWorkItem(entry.data)) {
				workItems.set(entry.data.id, entry.data);
			}
			if (entry.customType === "agent-team.member-attempt.v1" && isTeamMemberTurnAttempt(entry.data)) {
				attempts.set(entry.data.id, entry.data);
			}
		}
		return { workItems: [...workItems.values()], attempts: [...attempts.values()] };
	}

	async append(session: TeamSessionDocument, customType: string, data: unknown): Promise<void> {
		const coordination = session.coordinationRuntime;
		if (!coordination) throw new Error("Team coordination conversation is unavailable");
		await this.conversation.appendSessionMetadataEntry(coordination.sessionId, customType, data);
	}

	async begin(input: {
		readonly session: TeamSessionDocument;
		readonly memberId: string;
		readonly requestId: string;
		readonly sourceTurnId: string;
		readonly createdByParticipantId: string;
		readonly objective: string;
		readonly attachments?: readonly PromptAttachmentRef[];
		readonly mode: TeamMemberTurnAttemptMode;
	}): Promise<{ workItem: TeamWorkItem; attempt: TeamMemberTurnAttempt; created: boolean }> {
		const state = this.read(input.session);
		const workItemId = `work:${input.requestId}:${input.memberId}`;
		let workItem = state.workItems.find((item) => item.id === workItemId);
		const created = workItem === undefined;
		if (!workItem) {
			const now = Date.now();
			workItem = {
				id: workItemId,
				requestTurnId: input.requestId,
				createdByParticipantId: input.createdByParticipantId,
				assignedToParticipantId: input.memberId,
				objective: input.objective,
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
			workItem.createdByParticipantId !== input.createdByParticipantId
		) {
			throw new Error(`Team work item identity was reused with different content: ${workItemId}`);
		}
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
		const priorAttempts = state.attempts.filter((attempt) => attempt.workItemId === workItemId);
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
		return { workItem, attempt, created };
	}

	async settle(
		session: TeamSessionDocument,
		workItem: TeamWorkItem,
		attempt: TeamMemberTurnAttempt,
		terminal: ReturnType<typeof classifyTeamAttemptTerminal>,
		resultMessageId?: string,
	): Promise<TeamWorkItem> {
		const nextAttempt: TeamMemberTurnAttempt = {
			...attempt,
			...terminal,
			lastProgressAt: Date.now(),
		};
		const workItemState = workItemStateForAttempt(nextAttempt);
		const nextWorkItem = transitionTeamWorkItem(workItem, {
			state: workItemState,
			updatedAt: Date.now(),
			...(resultMessageId ? { resultMessageId } : {}),
			...(nextAttempt.issue ? { issue: nextAttempt.issue } : {}),
		});
		await this.append(session, "agent-team.member-attempt.v1", nextAttempt);
		await this.append(session, "agent-team.work-item.v1", nextWorkItem);
		return nextWorkItem;
	}
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
