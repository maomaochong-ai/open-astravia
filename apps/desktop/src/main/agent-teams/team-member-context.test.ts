import {
	createTeamSharedContextCheckpoint,
	createTeamSharedContextGeneration,
	type TeamContextProjectionReceipt,
	type TeamPublicationOperationRecord,
} from "@vetta/agent-team";
import { type ConversationDocument, createEmptyConversationDocument } from "@vetta/runtime-core/conversation";
import { describe, expect, it } from "vitest";
import { buildTeamMemberPinnedContext, restoreTeamMemberPinnedContext } from "./team-member-context.js";

describe("Team member pinned context", () => {
	it("restores a captured policy delta without selecting another participant's latest receipt", () => {
		const input = restorationFixture();
		const restored = restoreTeamMemberPinnedContext(structuredClone(input));
		expect(restored.records.map((record) => record.content)).toEqual(["PUBLIC", "MEMBER_DELTA"]);
		expect(JSON.stringify(restored)).not.toContain("OTHER_MEMBER_DELTA");
	});

	it.each(["receipt", "checkpoint", "generation", "fingerprint", "policy", "conversation", "delta"] as const)(
		"rejects incomplete or mismatched %s instead of silently dropping public context",
		(missing) => {
			const input = restorationFixture();
			if (missing === "receipt") input.state.contextReceipts = [];
			if (missing === "checkpoint") input.state.checkpoints = [];
			if (missing === "generation") input.state.contextGenerations = [];
			if (missing === "fingerprint") input.state.checkpoints[0]!.sourceFingerprint = "wrong";
			if (missing === "policy") input.state.checkpoints[0]!.policyVersion = "wrong";
			if (missing === "conversation") input.coordinationConversationId = "other";
			if (missing === "delta")
				input.state.contextReceipts[0] = { ...input.state.contextReceipts[0]!, additionalRecords: undefined };
			expect(() => restoreTeamMemberPinnedContext(input)).toThrow(/context/);
		},
	);

	it("excludes only proven imports and this member's published results without mutating storage", () => {
		const checkpoint = createTeamSharedContextCheckpoint({
			coordinationConversationId: "coordination",
			throughConversationRevision: 2,
			policyVersion: "public-results-v1",
			memberHandles: {},
			records: [
				{
					eventId: "public-result",
					type: "agent-team.member-result.v1",
					text: "published",
					timestamp: 1,
					metadata: { teamSessionId: "team", requestId: "turn", sourceMemberId: "member" },
				},
			],
		});
		const entry = {
			id: "import",
			type: "custom_message" as const,
			customType: "agent-team.member-result.v1",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			content: "published",
			display: false,
			modelVisible: true,
			details: { sourceEntryId: "public-result", sourceConversationId: "coordination" },
		};
		const memberDocument: ConversationDocument = {
			...createEmptyConversationDocument({ sessionId: "member", createdAt: 1 }),
			entries: [
				entry,
				{ ...entry, id: "other-conversation", details: { ...entry.details, sourceConversationId: "other" } },
				{ ...entry, id: "other-source", details: { ...entry.details, sourceEntryId: "unknown" } },
				{ ...entry, id: "unrelated-custom", customType: "custom.own" },
			],
		};
		const publication: TeamPublicationOperationRecord = {
			customType: "agent-team.publication-operation.v1",
			operationId: "publication",
			workItemId: "work",
			sourceParticipantConversationId: "member",
			sourceTurnId: "turn",
			sourceMessageEntryId: "private-answer",
			publicMessageEntryId: "public-result",
			state: "completed",
			generation: 1,
		};
		const pinned = buildTeamMemberPinnedContext({
			checkpoint,
			generation: createTeamSharedContextGeneration({ teamRevision: 1, checkpoint }),
			additionalRecords: [],
			memberDocument,
			participantConversationId: "member",
			publications: [
				publication,
				{
					...publication,
					operationId: "other",
					sourceParticipantConversationId: "other",
					sourceMessageEntryId: "other-answer",
				},
			],
		});
		expect(pinned.conversationProjections).toEqual([
			{ entryId: "import", kind: "omit-entry" },
			{ entryId: "private-answer", kind: "omit-assistant-text" },
		]);
		expect(memberDocument.entries).toHaveLength(4);
		expect(pinned.records).toHaveLength(1);
	});
});

function restorationFixture() {
	const checkpoint = {
		id: "checkpoint",
		coordinationConversationId: "coordination",
		fromConversationRevision: 0,
		throughConversationRevision: 1,
		sourceEntryIds: ["public"],
		sourceFingerprint: "fingerprint",
		policyVersion: "policy",
		summaryRecords: [
			{
				sourceEntryId: "public",
				sourceTurnId: "turn",
				sourceAuthorId: "leader",
				kind: "agent-message" as const,
				content: "PUBLIC",
				sourceTimestamp: 1,
				projectionPolicyId: "policy",
			},
		],
	};
	const generation = createTeamSharedContextGeneration({ teamRevision: 1, checkpoint });
	const receipt: TeamContextProjectionReceipt = {
		participantId: "member",
		participantConversationId: "member-conversation",
		generationId: generation.id,
		checkpointId: checkpoint.id,
		projectionPolicyId: "policy",
		sourceEntryIds: ["public", "delta"],
		sourceFingerprint: "fingerprint",
		deliveredAt: 2,
		additionalRecords: [{ ...checkpoint.summaryRecords[0]!, sourceEntryId: "delta", content: "MEMBER_DELTA" }],
	};
	return {
		memberId: "member",
		participantConversationId: "member-conversation",
		checkpointId: checkpoint.id,
		coordinationConversationId: "coordination",
		memberDocument: createEmptyConversationDocument({ sessionId: "member-conversation", createdAt: 1 }),
		state: {
			workItems: [],
			attempts: [],
			deliveries: [],
			publications: [],
			checkpoints: [checkpoint],
			contextGenerations: [generation],
			contextReceipts: [
				receipt,
				{
					...receipt,
					participantId: "other",
					participantConversationId: "other-conversation",
					additionalRecords: [{ ...receipt.additionalRecords![0]!, content: "OTHER_MEMBER_DELTA" }],
				},
			],
		},
	};
}
