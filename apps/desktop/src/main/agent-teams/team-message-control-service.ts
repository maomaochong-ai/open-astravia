import {
	stableTeamEventId,
	type TeamMessageControlPort,
	type TeamMessageDelivery,
	type TeamMessageRoutingRecord,
	type TeamSendMessageRequest,
	type TeamSendMessageResult,
	type TeamSessionDocument,
	type TeamWorkItem,
} from "@vetta/agent-team";
import { createAssistantMessage } from "@vetta/ai";
import type { ConversationMessageRecord } from "@vetta/runtime-core/conversation";
import type { TeamCollaborationStore } from "./team-collaboration-store.js";

export interface TeamMessageControlHost {
	readSession(id: string): Promise<TeamSessionDocument>;
	resolveTarget(session: TeamSessionDocument, handle: string): string | undefined;
	appendMessage(sessionId: string, message: ConversationMessageRecord): Promise<{ readonly entryId: string }>;
	appendMetadata(sessionId: string, customType: string, data: unknown): Promise<void>;
	startWorkItem(session: TeamSessionDocument, workItem: TeamWorkItem): void;
	onDelivery(session: TeamSessionDocument, delivery: TeamMessageDelivery): void;
}

/** Persists public messages and per-recipient delivery before any recipient execution starts. */
export class TeamMessageControlService {
	constructor(
		private readonly store: TeamCollaborationStore,
		private readonly host: TeamMessageControlHost,
	) {}

	forSession(teamSessionId: string): TeamMessageControlPort {
		return { sendMessage: (input) => this.sendMessage(teamSessionId, input) };
	}

	async recoverSession(session: TeamSessionDocument): Promise<void> {
		for (const delivery of this.store.read(session).deliveries) {
			if (delivery.state === "pending") {
				if (delivery.intent === "inform") {
					const delivered = await this.store.updateDelivery(session, delivery.id, { state: "delivered" });
					this.host.onDelivery(session, delivered);
					continue;
				}
				const item = await this.ensureQuestionWorkItem(session, delivery);
				const waiting = await this.store.updateDelivery(session, delivery.id, { state: "waiting" });
				this.host.onDelivery(session, waiting);
				if (item.state === "queued") this.host.startWorkItem(session, item);
				continue;
			}
			const item = delivery.workItemId
				? this.store.read(session).workItems.find((candidate) => candidate.id === delivery.workItemId)
				: undefined;
			if (item) await this.reconcileWorkItem(session, item);
		}
	}

	async reconcileWorkItem(session: TeamSessionDocument, item: TeamWorkItem): Promise<void> {
		const delivery = this.store.read(session).deliveries.find((candidate) => candidate.workItemId === item.id);
		if (!delivery || delivery.state !== "waiting") return;
		const state =
			item.state === "completed"
				? "responded"
				: item.state === "cancelled"
					? "cancelled"
					: item.state === "failed"
						? "failed"
						: undefined;
		if (!state) return;
		const updated = await this.store.updateDelivery(session, delivery.id, {
			state,
			...(state === "responded" && item.resultMessageId ? { replyMessageId: item.resultMessageId } : {}),
		});
		this.host.onDelivery(session, updated);
	}

	private async sendMessage(teamSessionId: string, input: TeamSendMessageRequest): Promise<TeamSendMessageResult> {
		input.signal.throwIfAborted();
		const session = await this.host.readSession(teamSessionId);
		const sourceMemberId = Object.entries(session.memberRuntime).find(
			([, runtime]) => runtime.sessionId === input.sourceRuntimeSessionId,
		)?.[0];
		if (!sourceMemberId || !isActiveMember(session, sourceMemberId)) {
			throw new Error("Source session is not a persistent member of this Agent Team");
		}
		const recipients = input.recipientHandles.map((handle) => {
			const participantId = this.host.resolveTarget(session, handle);
			if (!participantId || !isActiveMember(session, participantId))
				throw new Error(`Unknown team member handle: ${handle}`);
			if (participantId === sourceMemberId) throw new Error("A Team member cannot address itself");
			return participantId;
		});
		if (new Set(recipients).size !== recipients.length) throw new Error("Team message recipients must be unique");
		const messageId = stableTeamEventId([
			"agent-message",
			session.id,
			sourceMemberId,
			input.sourceTurnId,
			input.requestId,
		]);
		const routing: TeamMessageRoutingRecord = {
			customType: "agent-team.message-routing.v1",
			messageEntryId: messageId,
			addressedParticipantIds: recipients,
			requestId: input.requestId,
			intent: input.intent,
		};
		const coordination = session.coordinationRuntime;
		if (!coordination) throw new Error("Team coordination conversation is unavailable");
		const document = this.store.readDocument(session);
		const existingRouting = document.entries.find(
			(entry) =>
				entry.type === "custom" &&
				entry.customType === routing.customType &&
				isRouting(entry.data) &&
				entry.data.messageEntryId === messageId,
		);
		if (
			existingRouting?.type === "custom" &&
			isRouting(existingRouting.data) &&
			(!sameIds(existingRouting.data.addressedParticipantIds ?? [], recipients) ||
				existingRouting.data.requestId !== input.requestId ||
				existingRouting.data.intent !== input.intent)
		) {
			throw new Error(`Team message request id was reused with different routing: ${input.requestId}`);
		}
		const existingMessage = document.entries.find((entry) => entry.id === messageId);
		if (
			existingMessage &&
			(existingMessage.type !== "message" ||
				existingMessage.kind !== "agent" ||
				existingMessage.author.id !== sourceMemberId ||
				existingMessage.turnId !== input.sourceTurnId ||
				agentText(existingMessage.message.content) !== input.text)
		) {
			throw new Error(`Team message request id was reused with different content: ${input.requestId}`);
		}
		const timestamp =
			existingMessage?.type === "message" && existingMessage.kind === "agent"
				? existingMessage.message.timestamp
				: Date.now();
		const agentProfileId = session.memberRuntime[sourceMemberId]?.agentProfileId;
		await this.host.appendMessage(coordination.sessionId, {
			kind: "agent",
			id: messageId,
			turnId: input.sourceTurnId,
			timestamp,
			author: { kind: "agent", id: sourceMemberId, ...(agentProfileId ? { agentId: agentProfileId } : {}) },
			message: {
				...createAssistantMessage(input.modelIdentity, { timestamp }),
				content: [{ type: "text", text: input.text }],
			},
		});
		if (!existingRouting) await this.host.appendMetadata(coordination.sessionId, routing.customType, routing);
		const pending = recipients.map((toParticipantId): TeamMessageDelivery => {
			const id = stableTeamEventId(["delivery", messageId, toParticipantId]);
			const requestId = `question:${id}`;
			return {
				id,
				messageId,
				fromParticipantId: sourceMemberId,
				toParticipantId,
				intent: input.intent,
				state: "pending",
				...(input.intent === "question" ? { workItemId: `work:${requestId}:${toParticipantId}` } : {}),
				sourceTurnId: input.sourceTurnId,
				toolCallId: input.toolCallId,
				createdAt: timestamp,
				updatedAt: timestamp,
			};
		});
		const deliveries = await this.store.createDeliveries(session, pending);
		input.signal.throwIfAborted();
		for (const delivery of deliveries) {
			if (delivery.state !== "pending") continue;
			if (input.intent === "inform") {
				const delivered = await this.store.updateDelivery(session, delivery.id, { state: "delivered" });
				this.host.onDelivery(session, delivered);
				continue;
			}
			const requestId = `question:${delivery.id}`;
			const admitted = await this.store.enqueue({
				session,
				memberId: delivery.toParticipantId,
				requestId,
				...(delivery.toolCallId ? { originToolCallId: delivery.toolCallId } : {}),
				createdByParticipantId: sourceMemberId,
				objective: questionPrompt(session, delivery, input.text),
				kind: "question",
			});
			const waiting = await this.store.updateDelivery(session, delivery.id, { state: "waiting" });
			this.host.onDelivery(session, waiting);
			if (admitted.workItem.state === "queued") this.host.startWorkItem(session, admitted.workItem);
		}
		return { messageId, deliveryIds: deliveries.map((delivery) => delivery.id) };
	}

	private async ensureQuestionWorkItem(
		session: TeamSessionDocument,
		delivery: TeamMessageDelivery,
	): Promise<TeamWorkItem> {
		const existing = delivery.workItemId
			? this.store.read(session).workItems.find((candidate) => candidate.id === delivery.workItemId)
			: undefined;
		if (existing) return existing;
		const entry = this.store.readDocument(session).entries.find((candidate) => candidate.id === delivery.messageId);
		if (entry?.type !== "message" || entry.kind !== "agent") {
			throw new Error(`Team question message not found: ${delivery.messageId}`);
		}
		const text = entry.message.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
		const requestId = `question:${delivery.id}`;
		return (
			await this.store.enqueue({
				session,
				memberId: delivery.toParticipantId,
				requestId,
				...(delivery.toolCallId ? { originToolCallId: delivery.toolCallId } : {}),
				createdByParticipantId: delivery.fromParticipantId,
				objective: questionPrompt(session, delivery, text),
				kind: "question",
			})
		).workItem;
	}
}

function isActiveMember(session: TeamSessionDocument, id: string): boolean {
	return !!session.memberRuntime[id] && (session.activeMemberIds?.includes(id) ?? true);
}
function sameIds(left: readonly string[], right: readonly string[]): boolean {
	const sortedLeft = [...left].sort();
	const sortedRight = [...right].sort();
	return sortedLeft.length === sortedRight.length && sortedLeft.every((id, index) => id === sortedRight[index]);
}
function isRouting(value: unknown): value is TeamMessageRoutingRecord {
	return (
		typeof value === "object" &&
		value !== null &&
		"messageEntryId" in value &&
		typeof value.messageEntryId === "string"
	);
}

function agentText(content: readonly { readonly type: string; readonly text?: string }[]): string {
	return content.flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("\n");
}

function questionPrompt(session: TeamSessionDocument, delivery: TeamMessageDelivery, text: string): string {
	return `Answer this public question from @${session.memberHandles[delivery.fromParticipantId] ?? delivery.fromParticipantId}: ${text}`;
}
