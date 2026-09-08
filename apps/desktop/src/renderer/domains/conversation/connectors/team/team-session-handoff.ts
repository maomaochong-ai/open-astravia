import type { AgentTeamDocument, TeamSessionWorkspaceSelection, TeamUserMessageMention } from "@vetta/agent-team";
import type { PromptAttachmentRef, SessionExecutionMode } from "@vetta/runtime-core";

export interface TeamSessionSendHandoff {
	readonly sessionId: string;
	readonly requestId: string;
	readonly text: string;
	readonly memberMentions: readonly TeamUserMessageMention[];
	readonly attachments: readonly PromptAttachmentRef[];
	readonly timestamp: number;
	readonly modelKey?: string;
	readonly reasoning?: string;
	readonly executionMode: SessionExecutionMode;
	readonly workspace?: TeamSessionWorkspaceSelection;
}

export interface TeamSessionHandoff extends TeamSessionSendHandoff {
	readonly document?: AgentTeamDocument;
}

interface TeamSessionHandoffEntry {
	readonly handoff: TeamSessionHandoff;
	claimed: boolean;
}

const handoffs = new Map<string, TeamSessionHandoffEntry>();

/** Keeps the first-paint snapshot and first request alive across the route handoff. */
export function stageTeamSessionHandoff(handoff: TeamSessionHandoff): void {
	handoffs.set(handoff.sessionId, { handoff, claimed: false });
}

export function takeTeamSessionHandoff(sessionId: string): TeamSessionHandoff | undefined {
	const entry = handoffs.get(sessionId);
	if (entry) handoffs.delete(sessionId);
	return entry?.handoff;
}

export function peekTeamSessionHandoff(sessionId: string): TeamSessionHandoff | undefined {
	return handoffs.get(sessionId)?.handoff;
}

/** Claims the one-shot submission without hiding its first-paint data from StrictMode effect replays. */
export function claimTeamSessionHandoff(sessionId: string): TeamSessionHandoff | undefined {
	const entry = handoffs.get(sessionId);
	if (!entry || entry.claimed) return undefined;
	entry.claimed = true;
	return entry.handoff;
}

export function releaseTeamSessionHandoff(sessionId: string): void {
	const entry = handoffs.get(sessionId);
	if (entry) entry.claimed = false;
}

export function clearTeamSessionHandoff(sessionId: string): void {
	handoffs.delete(sessionId);
}
