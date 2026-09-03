import type { TeamMemberTurnAttempt, TeamWorkItem } from "./collaboration.js";

/** Public task state. No member transcript, tool output or private reasoning crosses this boundary. */
export interface TeamTaskSnapshot {
	readonly teamTaskId: string;
	readonly workItem: TeamWorkItem;
	readonly attempt?: TeamMemberTurnAttempt;
	readonly result?: { readonly messageId: string; readonly authorId: string; readonly text: string };
}

export interface TeamTaskCaller {
	readonly sourceRuntimeSessionId: string;
	readonly sourceTurnId: string;
	readonly toolCallId: string;
	readonly signal: AbortSignal;
}

export interface TeamDelegateTaskRequest extends TeamTaskCaller {
	readonly requestId: string;
	readonly targetHandle: string;
	readonly objective: string;
}

export interface TeamTaskRequest extends TeamTaskCaller {
	readonly teamTaskId: string;
}

export interface TeamWaitTasksRequest extends TeamTaskCaller {
	readonly teamTaskIds: readonly string[];
	readonly timeoutMs: number;
}

export interface TeamWaitTasksResult {
	readonly reason: "state-changed" | "timeout";
	readonly tasks: readonly TeamTaskSnapshot[];
}

export interface TeamTaskControlPort {
	delegateTask(input: TeamDelegateTaskRequest): Promise<TeamTaskSnapshot>;
	getTask(input: TeamTaskRequest): Promise<TeamTaskSnapshot>;
	waitTasks(input: TeamWaitTasksRequest): Promise<TeamWaitTasksResult>;
	resumeTask(input: TeamTaskRequest & { readonly mode: "continue" | "retry" }): Promise<TeamTaskSnapshot>;
	cancelTask(input: TeamTaskRequest): Promise<TeamTaskSnapshot>;
}

export interface TeamMessageModelIdentity {
	readonly api: string;
	readonly provider: string;
	readonly model: string;
}

export interface TeamSendMessageRequest extends TeamTaskCaller {
	readonly requestId: string;
	readonly recipientHandles: readonly string[];
	readonly intent: "inform" | "question";
	readonly text: string;
	readonly modelIdentity: TeamMessageModelIdentity;
}

export interface TeamSendMessageResult {
	readonly messageId: string;
	readonly deliveryIds: readonly string[];
}

export interface TeamMessageControlPort {
	sendMessage(input: TeamSendMessageRequest): Promise<TeamSendMessageResult>;
}

export type TeamTaskAction = "delegate" | "resume" | "cancel";

export function isDefaultTeamTaskActionAllowed(input: {
	readonly action: TeamTaskAction;
	readonly leaderMemberId: string;
	readonly sourceMemberId: string;
	readonly targetMemberId: string;
}): boolean {
	if (input.action === "delegate") {
		return input.sourceMemberId === input.leaderMemberId && input.sourceMemberId !== input.targetMemberId;
	}
	if (input.action === "cancel") {
		return input.sourceMemberId === input.leaderMemberId && input.sourceMemberId !== input.targetMemberId;
	}
	return input.sourceMemberId === input.leaderMemberId || input.sourceMemberId === input.targetMemberId;
}
