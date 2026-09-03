import {
	findTeamPrivateEntriesCoveredByCheckpoint,
	projectTeamCheckpointSessionContext,
	stableTeamEventId,
	type TeamCheckpointGeneration,
	type TeamContextImportRecord,
	type TeamPublicationOperationRecord,
	type TeamSharedContextCheckpoint,
} from "@vetta/agent-team";
import type { CodingAgentPinnedModelContext } from "@vetta/coding-agent/runtime";
import type { ConversationDocument } from "@vetta/runtime-core/conversation";
import type { TeamCollaborationState } from "./team-collaboration-store.js";

/** Owns the Team-to-Coding Agent adapter, without changing either Conversation. */
export function buildTeamMemberPinnedContext(input: {
	readonly checkpoint: TeamSharedContextCheckpoint;
	readonly generation: TeamCheckpointGeneration;
	readonly additionalRecords: readonly TeamContextImportRecord[];
	readonly memberDocument: ConversationDocument;
	readonly participantConversationId: string;
	readonly publications: readonly TeamPublicationOperationRecord[];
}): CodingAgentPinnedModelContext {
	const records = projectTeamCheckpointSessionContext(input);
	const sourceIds = new Set<unknown>([
		...input.checkpoint.sourceEntryIds,
		...input.additionalRecords.map((record) => record.sourceEntryId),
	]);
	const legacyImportIds = input.memberDocument.entries.flatMap((entry) => {
		if (entry.type !== "custom_message" || !LEGACY_IMPORT_TYPES.has(entry.customType)) return [];
		const metadata = entry.details;
		if (!metadata || typeof metadata !== "object") return [];
		if (
			!("sourceConversationId" in metadata) ||
			metadata.sourceConversationId !== input.checkpoint.coordinationConversationId
		)
			return [];
		return "sourceEntryId" in metadata && sourceIds.has(metadata.sourceEntryId) ? [entry.id] : [];
	});
	return {
		id: stableTeamEventId([input.generation.id, ...records.map((record) => JSON.stringify(record))]),
		records,
		conversationProjections: [
			...legacyImportIds.map((entryId) => ({ entryId, kind: "omit-entry" as const })),
			...findTeamPrivateEntriesCoveredByCheckpoint({
				checkpoint: input.checkpoint,
				participantConversationId: input.participantConversationId,
				publications: input.publications,
			}).map((entryId) => ({ entryId, kind: "omit-assistant-text" as const })),
		],
	};
}

/** Restores only the version actually admitted for this participant, never another member's latest version. */
export function restoreTeamMemberPinnedContext(input: {
	readonly memberId: string;
	readonly participantConversationId: string;
	readonly checkpointId: string;
	readonly coordinationConversationId: string;
	readonly state: TeamCollaborationState;
	readonly memberDocument: ConversationDocument;
}): CodingAgentPinnedModelContext {
	const { state, checkpointId, participantConversationId } = input;
	const receipt = [...state.contextReceipts]
		.reverse()
		.find(
			(candidate) =>
				candidate.participantId === input.memberId &&
				candidate.participantConversationId === participantConversationId &&
				candidate.checkpointId === checkpointId,
		);
	const checkpoint = state.checkpoints.find((candidate) => candidate.id === checkpointId);
	const generation = state.contextGenerations.find((candidate) => candidate.id === receipt?.generationId);
	if (
		!receipt ||
		!checkpoint ||
		!generation ||
		generation.checkpointId !== checkpointId ||
		checkpoint.coordinationConversationId !== input.coordinationConversationId ||
		generation.coordinationConversationId !== input.coordinationConversationId ||
		receipt.sourceFingerprint !== checkpoint.sourceFingerprint ||
		generation.sourceFingerprint !== checkpoint.sourceFingerprint ||
		receipt.projectionPolicyId !== checkpoint.policyVersion ||
		generation.projectionPolicyId !== checkpoint.policyVersion
	) {
		throw new Error(`Team member context references are incomplete or inconsistent: ${input.memberId}`);
	}
	const additionalRecords = receipt.additionalRecords ?? [];
	const sourceIds = new Set([
		...checkpoint.sourceEntryIds,
		...additionalRecords.map((record) => record.sourceEntryId),
	]);
	if (
		sourceIds.size !== receipt.sourceEntryIds.length ||
		new Set(receipt.sourceEntryIds).size !== receipt.sourceEntryIds.length ||
		!receipt.sourceEntryIds.every((id) => sourceIds.has(id)) ||
		new Set(additionalRecords.map((record) => record.sourceEntryId)).size !== additionalRecords.length ||
		additionalRecords.some((record) => record.projectionPolicyId !== receipt.projectionPolicyId)
	) {
		throw new Error(
			`Team member context delta is unavailable; a new context admission is required: ${input.memberId}`,
		);
	}
	return buildTeamMemberPinnedContext({
		checkpoint,
		generation: { ...generation, checkpointId },
		additionalRecords,
		memberDocument: input.memberDocument,
		participantConversationId,
		publications: state.publications,
	});
}

const LEGACY_IMPORT_TYPES = new Set([
	"agent-team.user-message.v1",
	"agent-team.member-result.v1",
	"agent-team.member-delegation.v1",
]);
