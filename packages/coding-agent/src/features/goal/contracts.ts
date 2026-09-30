export const CODING_AGENT_GOAL_EXTENSION_ID = "coding-agent.goal";

export const CODING_AGENT_GOAL_STATUSES = ["active", "paused", "blocked", "usage_limited", "complete"] as const;

export type CodingAgentGoalStatus = (typeof CODING_AGENT_GOAL_STATUSES)[number];

export interface CodingAgentGoalState {
	readonly goalId: string;
	readonly objective: string;
	readonly status: CodingAgentGoalStatus;
	readonly statusDetail?: string;
	readonly tokensUsed: number;
	readonly timeUsedSeconds: number;
	readonly continuationCount: number;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type CodingAgentGoalSnapshot = CodingAgentGoalState | null;

export type CodingAgentGoalUpdateListener = (state: CodingAgentGoalSnapshot) => void;

export function isCodingAgentGoalStatus(value: unknown): value is CodingAgentGoalStatus {
	return typeof value === "string" && (CODING_AGENT_GOAL_STATUSES as readonly string[]).includes(value);
}

export function isTerminalGoalStatus(status: CodingAgentGoalStatus): boolean {
	return status !== "active";
}
