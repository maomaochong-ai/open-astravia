import type { PromptAttachmentRef, RuntimeFailure } from "@vetta/runtime-core";
import type { ConversationMessageRecord } from "@vetta/runtime-core/conversation";
import type { AgentProfile, AgentTeamDocument, TeamDefinition } from "./contracts.js";
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
	readonly retryAfter?: number;
}

export interface TeamWorkItem {
	readonly id: string;
	readonly requestTurnId: string;
	readonly createdByParticipantId: string;
	readonly assignedToParticipantId: string;
	readonly objective: string;
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
	readonly createdAt: number;
	readonly updatedAt: number;
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

export interface TeamMessageRoutingRecord {
	readonly customType: "agent-team.message-routing.v1";
	readonly messageEntryId: string;
	readonly addressedParticipantIds?: readonly string[];
	readonly requestId?: string;
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
}

export interface TeamCompactionReference {
	readonly sharedCheckpointId: string;
	readonly throughConversationRevision: number;
	readonly sourceFingerprint: string;
	readonly projectionPolicyId: string;
}

export interface TeamPublicConversationMessage {
	readonly entryId: string;
	readonly record: ConversationMessageRecord;
	readonly routing?: TeamMessageRoutingRecord;
}

const WORK_ITEM_TRANSITIONS: Readonly<Record<TeamWorkItemState, readonly TeamWorkItemState[]>> = {
	queued: ["running", "waiting", "attention-required", "cancelled", "failed"],
	running: ["waiting", "attention-required", "completed", "cancelled", "failed"],
	waiting: ["queued", "running", "attention-required", "cancelled", "failed"],
	"attention-required": ["queued", "waiting", "cancelled", "failed"],
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
	if (/(credit|billing|balance|quota_exhausted)/.test(code)) {
		return {
			category: "insufficient-credit",
			retryability: "after-external-change",
			code: failure.code,
			...(retryAfter === undefined ? {} : { retryAfter }),
		};
	}
	if (/(auth|unauthorized|forbidden|api.?key)/.test(code)) {
		return { category: "authentication", retryability: "after-external-change", code: failure.code };
	}
	if (/(rate|429|too_many_requests)/.test(code)) {
		return {
			category: "rate-limit",
			retryability: "automatic",
			code: failure.code,
			...(retryAfter === undefined ? {} : { retryAfter }),
		};
	}
	if (/(network|timeout|timed.?out|connection|econn)/.test(code)) {
		return { category: "network", retryability: "automatic", code: failure.code };
	}
	if (/(context|token.?limit|length)/.test(code)) {
		return { category: "context-overflow", retryability: "manual", code: failure.code };
	}
	if (/(invalid|bad.?request|400)/.test(code)) {
		return { category: "invalid-request", retryability: "never", code: failure.code };
	}
	return {
		category: failure.origin === "provider" ? "provider-unavailable" : "unknown",
		retryability: failure.retryable ? "automatic" : "never",
		code: failure.code,
		...(retryAfter === undefined ? {} : { retryAfter }),
	};
}

export function isTeamWorkItem(value: unknown): value is TeamWorkItem {
	if (!isRecord(value)) return false;
	return (
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.requestTurnId) &&
		isNonEmptyString(value.createdByParticipantId) &&
		isNonEmptyString(value.assignedToParticipantId) &&
		isNonEmptyString(value.objective) &&
		Array.isArray(value.contextEntryIds) &&
		isTeamWorkItemState(value.state) &&
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
		typeof value.lastProgressAt === "number"
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
