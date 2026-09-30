import type { CodingAgentGoalState } from "@vetta/coding-agent/session-extensions";

export interface StartedSessionGoal {
	readonly sessionId: string;
	readonly state: CodingAgentGoalState;
}

/** 新会话页负责把主输入框的目标发送意图物化成 Session；已有会话直接调用 Runtime。 */
export type StartNewSessionGoal = (objective: string) => Promise<StartedSessionGoal | null>;
