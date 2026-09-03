import type { TeamMemberTurnAttemptMode } from "@vetta/agent-team";
import type { PromptAttachmentRef } from "@vetta/runtime-core";

export interface TeamMemberTurnRequest {
	readonly teamSessionId: string;
	readonly memberId: string;
	readonly promptText: string;
	readonly requestId: string;
	readonly sourceTurnId: string;
	readonly createdByParticipantId: string;
	readonly signal?: AbortSignal;
	readonly attachments?: readonly PromptAttachmentRef[];
	readonly modelKey?: string;
	readonly reasoning?: string;
	readonly mode?: TeamMemberTurnAttemptMode;
	readonly waitingMemberId?: string;
	readonly expectedWorkItemRevision?: number;
	/** Public entries represented directly by this prompt and therefore not imported twice. */
	readonly directContextEntryIds?: readonly string[];
	readonly workItemKind?: "task" | "question";
}
