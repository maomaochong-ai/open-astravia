import type { PromptAttachmentRef, RuntimeFailure } from "@vetta/runtime-core";
import type { ConversationMessageRecord } from "@vetta/runtime-core/conversation";
import type { AgentProfile, AgentTeamDocument, TeamDefinition, TeamSessionDocument } from "./contracts.js";
import { resolveMemberProfile } from "./domain.js";

export type TeamCapabilityKind = "skill" | "scene" | "mcp" | "plugin" | "tool" | (string & {});

/** Subagent controls belong to private child execution, never Team-member coordination. */
export const TEAM_SUBAGENT_TOOL_NAMES = Object.freeze([
	"spawn_agent",
	"dispatch_workflows",
	"list_agents",
	"wait_agent",
	"interrupt_agent",
	"send_message",
	"followup_task",
] as const);

export function filterTeamMemberActiveToolNames(toolNames: readonly string[]): string[] {
	const denied = new Set<string>(TEAM_SUBAGENT_TOOL_NAMES);
	return toolNames.filter((toolName) => !denied.has(toolName));
}

export interface TeamCapabilityDescriptor {
	readonly kind: TeamCapabilityKind;
	readonly id: string;
	readonly label: string;
	readonly summary?: string;
}

export interface TeamRosterMemberDescriptor {
	readonly participantId: string;
	readonly handle: string;
	readonly displayName: string;
	readonly isLeader: boolean;
	readonly role: string;
	readonly responsibilitySummary: string;
	readonly capabilities: readonly TeamCapabilityDescriptor[];
	readonly availability: "idle" | "running" | "unavailable";
	readonly profileRevision: number;
}

export interface TeamRosterSnapshot {
	readonly teamId: string;
	readonly teamName: string;
	readonly teamRevision: number;
	readonly leaderParticipantId: string;
	readonly members: readonly TeamRosterMemberDescriptor[];
}

export interface TeamRosterRuntimeFacts {
	readonly capabilitiesByParticipantId?: Readonly<Record<string, readonly TeamCapabilityDescriptor[]>>;
	readonly availabilityByParticipantId?: Readonly<Record<string, TeamRosterMemberDescriptor["availability"]>>;
}

export function buildTeamRosterSnapshot(
	document: Pick<AgentTeamDocument, "agents">,
	team: TeamDefinition,
	facts: TeamRosterRuntimeFacts = {},
): TeamRosterSnapshot {
	return {
		teamId: team.id,
		teamName: team.name,
		teamRevision: team.revision,
		leaderParticipantId: team.leaderMemberId,
		members: team.members.map((member) => {
			const profile = resolveMemberProfile(document, member);
			return {
				participantId: member.id,
				handle: member.handle,
				displayName: profile.name,
				isLeader: member.id === team.leaderMemberId,
				role: profile.blueprintId,
				responsibilitySummary: profile.description,
				capabilities: facts.capabilitiesByParticipantId?.[member.id] ?? [],
				availability: facts.availabilityByParticipantId?.[member.id] ?? "idle",
				profileRevision: profile.revision,
			};
		}),
	};
}

export type TeamWorkItemState =
	| "queued"
	| "running"
	| "waiting"
	| "attention-required"
	| "completed"
	| "failed"
	| "cancelled";

export type TeamMemberTurnAttemptState =
	| "scheduled"
	| "running"
	| "waiting-retry"
	| "interrupted"
	| "awaiting-resource"
	| "completed"
	| "cancelled"
	| "non-retryable-failure";

export type TeamMemberTurnAttemptMode = "initial" | "continue" | "retry" | "recovery";

export type TeamExecutionIssueCategory =
	| "network"
	| "rate-limit"
	| "provider-unavailable"
	| "insufficient-credit"
	| "authentication"
	| "host-interrupted"
	| "context-overflow"
	| "invalid-request"
	| "policy-rejected"
	| "unknown";

export interface TeamExecutionIssue {
	readonly category: TeamExecutionIssueCategory;
	readonly retryability: "automatic" | "manual" | "after-external-change" | "never";
	readonly code: string;
	/** Safe provider identity used to scope an external-condition wake-up. */
	readonly provider?: string;
	/** Safe model identity used to avoid waking unrelated provider work. */
	readonly modelId?: string;
	readonly retryAfter?: number;
}

export type TeamExternalConditionCategory = Extract<
	TeamExecutionIssueCategory,
	"authentication" | "insufficient-credit"
>;

/** Host-owned fact that a non-Agent condition has changed and affected work may be retried. */
export interface TeamExternalConditionChange {
	readonly category: TeamExternalConditionCategory;
	readonly provider?: string;
	readonly modelId?: string;
}

export interface TeamWorkItem {
	readonly id: string;
	readonly requestTurnId: string;
	/** Tool call that admitted this work, when it originated from Team collaboration tooling. */
	readonly originToolCallId?: string;
	readonly createdByParticipantId: string;
	readonly assignedToParticipantId: string;
	readonly objective: string;
	/** Legacy records omit this and are ordinary delegated tasks. */
	readonly kind?: "task" | "question";
	readonly contextEntryIds: readonly string[];
	readonly artifactRefs?: readonly PromptAttachmentRef[];
	readonly state: TeamWorkItemState;
	readonly resultMessageId?: string;
	readonly currentAttemptId?: string;
	readonly lastIssue?: TeamExecutionIssue;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly revision: number;
}

export interface TeamMemberTurnAttempt {
	readonly id: string;
	readonly workItemId: string;
	readonly participantConversationId: string;
	readonly sourceTurnId: string;
	readonly attempt: number;
	readonly mode: TeamMemberTurnAttemptMode;
	readonly state: TeamMemberTurnAttemptState;
	readonly lastProgressAt: number;
	readonly nextRetryAt?: number;
	readonly issue?: TeamExecutionIssue;
}

export interface TeamMessageDelivery {
	readonly id: string;
	readonly messageId: string;
	readonly fromParticipantId: string;
	readonly toParticipantId: string;
	readonly intent: "inform" | "question";
	readonly state: "pending" | "delivered" | "waiting" | "responded" | "failed" | "cancelled";
	readonly replyMessageId?: string;
	readonly workItemId?: string;
	readonly sourceTurnId?: string;
	readonly toolCallId?: string;
	readonly createdAt: number;
	readonly updatedAt: number;
}

const DELIVERY_TRANSITIONS: Readonly<Record<TeamMessageDelivery["state"], readonly TeamMessageDelivery["state"][]>> = {
	pending: ["delivered", "waiting", "failed", "cancelled"],
	delivered: [],
	waiting: ["responded", "failed", "cancelled"],
	responded: [],
	failed: [],
	cancelled: [],
};

export function transitionTeamMessageDelivery(
	delivery: TeamMessageDelivery,
	input: {
		readonly state: TeamMessageDelivery["state"];
		readonly updatedAt: number;
		readonly replyMessageId?: string;
	},
): TeamMessageDelivery {
	if (!DELIVERY_TRANSITIONS[delivery.state].includes(input.state)) {
		throw new Error(`Invalid Team message delivery transition: ${delivery.state} -> ${input.state}`);
	}
	if ((input.state === "responded") !== !!input.replyMessageId) {
		throw new Error("Only a responded Team delivery requires a reply message");
	}
	return {
		...delivery,
		state: input.state,
		updatedAt: input.updatedAt,
		...(input.replyMessageId ? { replyMessageId: input.replyMessageId } : {}),
	};
}

export interface TeamConversationBindingRecord {
	readonly customType: "agent-team.binding.v1";
	readonly teamId: string;
	readonly teamRevision: number;
	readonly coordinationConversationId: string;
	readonly participants: readonly {
		readonly participantId: string;
		readonly conversationId: string;
		readonly role: "leader" | "member";
	}[];
}

/** Latest logical Team state persisted inside its ordinary coordination Conversation. */
export interface TeamSessionStateRecord {
	readonly customType: "agent-team.session-state.v1";
	readonly session: TeamSessionDocument;
}

/** Completion marker written only after every legacy event has an equivalent ordinary Conversation projection. */
export interface TeamLegacyEventsMigrationRecord {
	readonly customType: "agent-team.legacy-events-migration.v1";
	readonly teamSessionId: string;
	readonly coordinationConversationId: string;
	readonly sourceFingerprint: string;
	readonly migratedEventIds: readonly string[];
	readonly resultSources: readonly {
		readonly messageEntryId: string;
		readonly sourceTurnId: string;
	}[];
	readonly completedAt: number;
}

export interface TeamMessageRoutingRecord {
	readonly customType: "agent-team.message-routing.v1";
	readonly messageEntryId: string;
	readonly addressedParticipantIds?: readonly string[];
	readonly requestId?: string;
	readonly intent?: "inform" | "question";
}

export interface TeamPublicationOperationRecord {
	readonly customType: "agent-team.publication-operation.v1";
	readonly operationId: string;
	readonly workItemId: string;
	readonly sourceParticipantConversationId: string;
	readonly sourceTurnId: string;
	readonly sourceMessageEntryId: string;
	readonly publicMessageEntryId?: string;
	readonly state: "prepared" | "message-published" | "completed" | "needs-recovery";
	readonly generation: number;
}

export interface TeamSharedContextGeneration {
	readonly id: string;
	readonly coordinationConversationId: string;
	readonly teamRevision: number;
	readonly throughConversationRevision: number;
	readonly throughEntryId?: string;
	readonly checkpointId?: string;
	readonly sourceFingerprint: string;
	readonly projectionPolicyId: string;
}

export interface TeamContextImportRecord {
	readonly sourceEntryId: string;
	readonly sourceTurnId: string;
	readonly sourceAuthorId: string;
	readonly kind: "user-message" | "agent-message" | "team-event" | "summary";
	readonly content: string;
	readonly sourceTimestamp: number;
	readonly projectionPolicyId: string;
}

export interface TeamSharedContextCheckpoint {
	readonly id: string;
	readonly coordinationConversationId: string;
	readonly fromConversationRevision: number;
	readonly throughConversationRevision: number;
	readonly sourceEntryIds: readonly string[];
	readonly sourceFingerprint: string;
	readonly policyVersion: string;
	readonly summaryRecords: readonly TeamContextImportRecord[];
	/** Public source entries represented by the synthetic summary record. Legacy/raw checkpoints omit this. */
	readonly summarizedSourceEntryIds?: readonly string[];
	readonly parentCheckpointId?: string;
}

export interface TeamCompactionReference {
	readonly sharedCheckpointId: string;
	readonly throughConversationRevision: number;
	readonly sourceFingerprint: string;
	readonly projectionPolicyId: string;
}

export interface TeamContextProjectionReceipt {
	readonly participantId: string;
	readonly participantConversationId: string;
	readonly generationId: string;
	readonly checkpointId: string;
	readonly projectionPolicyId: string;
	readonly sourceEntryIds: readonly string[];
	readonly sourceFingerprint: string;
	readonly deliveredAt: number;
	/** Captured policy-specific delta; common content stays in the referenced checkpoint. */
	readonly additionalRecords?: readonly TeamContextImportRecord[];
}

export interface TeamPublicConversationMessage {
	readonly entryId: string;
	readonly record: ConversationMessageRecord;
	readonly routing?: TeamMessageRoutingRecord;
}

const WORK_ITEM_TRANSITIONS: Readonly<Record<TeamWorkItemState, readonly TeamWorkItemState[]>> = {
	queued: ["running", "waiting", "attention-required", "cancelled", "failed"],
	running: ["waiting", "attention-required", "completed", "cancelled", "failed"],
	waiting: ["queued", "running", "attention-required", "completed", "cancelled", "failed"],
	"attention-required": ["queued", "waiting", "completed", "cancelled", "failed"],
	completed: [],
	failed: [],
	cancelled: [],
};

export function transitionTeamWorkItem(
	item: TeamWorkItem,
	input: {
		readonly state: TeamWorkItemState;
		readonly updatedAt: number;
		readonly resultMessageId?: string;
		readonly currentAttemptId?: string;
		readonly issue?: TeamExecutionIssue;
	},
): TeamWorkItem {
	if (!WORK_ITEM_TRANSITIONS[item.state].includes(input.state)) {
		throw new Error(`Invalid Team work item transition: ${item.state} -> ${input.state}`);
	}
	if (input.state === "completed" && !input.resultMessageId) {
		throw new Error("Completed Team work item requires a result message");
	}
	if (input.state !== "completed" && input.resultMessageId) {
		throw new Error("Only a completed Team work item can reference a result message");
	}
	return {
		...item,
		state: input.state,
		updatedAt: input.updatedAt,
		revision: item.revision + 1,
		...(input.resultMessageId ? { resultMessageId: input.resultMessageId } : {}),
		...(input.currentAttemptId ? { currentAttemptId: input.currentAttemptId } : {}),
		...(input.issue ? { lastIssue: input.issue } : {}),
	};
}

export function classifyTeamAttemptTerminal(input: {
	readonly hasPublishableMessage: boolean;
	readonly cancelled: boolean;
	readonly issue?: TeamExecutionIssue;
}): Pick<TeamMemberTurnAttempt, "state" | "issue"> {
	if (input.cancelled) return { state: "cancelled" };
	if (input.hasPublishableMessage) return { state: "completed" };
	if (!input.issue) return { state: "interrupted" };
	if (input.issue.retryability === "automatic") return { state: "waiting-retry", issue: input.issue };
	if (input.issue.retryability === "manual" || input.issue.retryability === "after-external-change") {
		return { state: "awaiting-resource", issue: input.issue };
	}
	return { state: "non-retryable-failure", issue: input.issue };
}

export function classifyTeamExecutionIssue(failure: RuntimeFailure): TeamExecutionIssue {
	const code = `${failure.code} ${failure.details?.providerCode ?? ""}`.toLowerCase();
	const retryAfter = failure.details?.retryAfterMs;
	const identity = {
		...(failure.details?.provider ? { provider: failure.details.provider } : {}),
		...(failure.details?.modelId ? { modelId: failure.details.modelId } : {}),
	};
	if (/(credit|billing|balance|quota_exhausted)/.test(code)) {
		return {
			category: "insufficient-credit",
			retryability: "after-external-change",
			code: failure.code,
			...identity,
			...(retryAfter === undefined ? {} : { retryAfter }),
		};
	}
	if (/(auth|unauthorized|forbidden|api.?key)/.test(code)) {
		return {
			category: "authentication",
			retryability: "after-external-change",
			code: failure.code,
			...identity,
		};
	}
	if (/(rate|429|too_many_requests)/.test(code)) {
		return {
			category: "rate-limit",
			retryability: "automatic",
			code: failure.code,
			...identity,
			...(retryAfter === undefined ? {} : { retryAfter }),
		};
	}
	if (/(network|timeout|timed.?out|connection|econn)/.test(code)) {
		return {
			category: "network",
			retryability: "automatic",
			code: failure.code,
			...identity,
			...(retryAfter === undefined ? {} : { retryAfter }),
		};
	}
	if (/(context|token.?limit|length)/.test(code)) {
		return { category: "context-overflow", retryability: "manual", code: failure.code, ...identity };
	}
	if (/(invalid|bad.?request|400)/.test(code)) {
		return { category: "invalid-request", retryability: "never", code: failure.code, ...identity };
	}
	return {
		category: failure.origin === "provider" ? "provider-unavailable" : "unknown",
		retryability: failure.retryable ? "automatic" : "never",
		code: failure.code,
		...identity,
		...(retryAfter === undefined ? {} : { retryAfter }),
	};
}

export function matchesTeamExternalConditionChange(
	issue: TeamExecutionIssue | undefined,
	change: TeamExternalConditionChange,
): boolean {
	if (issue?.retryability !== "after-external-change" || issue.category !== change.category) return false;
	if (change.provider && issue.provider && change.provider !== issue.provider) return false;
	if (change.modelId && issue.modelId && change.modelId !== issue.modelId) return false;
	return true;
}

export function isTeamWorkItem(value: unknown): value is TeamWorkItem {
	if (!isRecord(value)) return false;
	return (
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.requestTurnId) &&
		(value.originToolCallId === undefined || isNonEmptyString(value.originToolCallId)) &&
		isNonEmptyString(value.createdByParticipantId) &&
		isNonEmptyString(value.assignedToParticipantId) &&
		isNonEmptyString(value.objective) &&
		(value.kind === undefined || value.kind === "task" || value.kind === "question") &&
		Array.isArray(value.contextEntryIds) &&
		isTeamWorkItemState(value.state) &&
		(value.lastIssue === undefined || isTeamExecutionIssue(value.lastIssue)) &&
		typeof value.createdAt === "number" &&
		typeof value.updatedAt === "number" &&
		Number.isInteger(value.revision)
	);
}

export function isTeamMemberTurnAttempt(value: unknown): value is TeamMemberTurnAttempt {
	if (!isRecord(value)) return false;
	return (
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.workItemId) &&
		isNonEmptyString(value.participantConversationId) &&
		isNonEmptyString(value.sourceTurnId) &&
		Number.isInteger(value.attempt) &&
		(value.mode === "initial" || value.mode === "continue" || value.mode === "retry" || value.mode === "recovery") &&
		isTeamMemberTurnAttemptState(value.state) &&
		(value.issue === undefined || isTeamExecutionIssue(value.issue)) &&
		(value.nextRetryAt === undefined || typeof value.nextRetryAt === "number") &&
		typeof value.lastProgressAt === "number"
	);
}

export function isTeamMessageDelivery(value: unknown): value is TeamMessageDelivery {
	if (!isRecord(value)) return false;
	return (
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.messageId) &&
		isNonEmptyString(value.fromParticipantId) &&
		isNonEmptyString(value.toParticipantId) &&
		(value.intent === "inform" || value.intent === "question") &&
		(value.state === "pending" ||
			value.state === "delivered" ||
			value.state === "waiting" ||
			value.state === "responded" ||
			value.state === "failed" ||
			value.state === "cancelled") &&
		(value.replyMessageId === undefined || isNonEmptyString(value.replyMessageId)) &&
		(value.workItemId === undefined || isNonEmptyString(value.workItemId)) &&
		(value.sourceTurnId === undefined || isNonEmptyString(value.sourceTurnId)) &&
		(value.toolCallId === undefined || isNonEmptyString(value.toolCallId)) &&
		typeof value.createdAt === "number" &&
		typeof value.updatedAt === "number"
	);
}

export function isTeamPublicationOperationRecord(value: unknown): value is TeamPublicationOperationRecord {
	if (!isRecord(value)) return false;
	return (
		value.customType === "agent-team.publication-operation.v1" &&
		isNonEmptyString(value.operationId) &&
		isNonEmptyString(value.workItemId) &&
		isNonEmptyString(value.sourceParticipantConversationId) &&
		isNonEmptyString(value.sourceTurnId) &&
		isNonEmptyString(value.sourceMessageEntryId) &&
		(value.publicMessageEntryId === undefined || isNonEmptyString(value.publicMessageEntryId)) &&
		(value.state === "prepared" ||
			value.state === "message-published" ||
			value.state === "completed" ||
			value.state === "needs-recovery") &&
		Number.isInteger(value.generation)
	);
}

export function isTeamLegacyEventsMigrationRecord(value: unknown): value is TeamLegacyEventsMigrationRecord {
	if (!isRecord(value)) return false;
	return (
		value.customType === "agent-team.legacy-events-migration.v1" &&
		isNonEmptyString(value.teamSessionId) &&
		isNonEmptyString(value.coordinationConversationId) &&
		isNonEmptyString(value.sourceFingerprint) &&
		Array.isArray(value.migratedEventIds) &&
		value.migratedEventIds.every(isNonEmptyString) &&
		Array.isArray(value.resultSources) &&
		value.resultSources.every(
			(source) =>
				isRecord(source) && isNonEmptyString(source.messageEntryId) && isNonEmptyString(source.sourceTurnId),
		) &&
		typeof value.completedAt === "number"
	);
}

export function resolveProfileResponsibility(profile: AgentProfile): string {
	return profile.description.trim() || profile.name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isTeamWorkItemState(value: unknown): value is TeamWorkItemState {
	return (
		value === "queued" ||
		value === "running" ||
		value === "waiting" ||
		value === "attention-required" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
	);
}

function isTeamMemberTurnAttemptState(value: unknown): value is TeamMemberTurnAttemptState {
	return (
		value === "scheduled" ||
		value === "running" ||
		value === "waiting-retry" ||
		value === "interrupted" ||
		value === "awaiting-resource" ||
		value === "completed" ||
		value === "cancelled" ||
		value === "non-retryable-failure"
	);
}

function isTeamExecutionIssue(value: unknown): value is TeamExecutionIssue {
	if (!isRecord(value)) return false;
	return (
		isTeamExecutionIssueCategory(value.category) &&
		(value.retryability === "automatic" ||
			value.retryability === "manual" ||
			value.retryability === "after-external-change" ||
			value.retryability === "never") &&
		isNonEmptyString(value.code) &&
		(value.provider === undefined || isNonEmptyString(value.provider)) &&
		(value.modelId === undefined || isNonEmptyString(value.modelId)) &&
		(value.retryAfter === undefined || typeof value.retryAfter === "number")
	);
}

function isTeamExecutionIssueCategory(value: unknown): value is TeamExecutionIssueCategory {
	return (
		value === "network" ||
		value === "rate-limit" ||
		value === "provider-unavailable" ||
		value === "insufficient-credit" ||
		value === "authentication" ||
		value === "host-interrupted" ||
		value === "context-overflow" ||
		value === "invalid-request" ||
		value === "policy-rejected" ||
		value === "unknown"
	);
}
