import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { TeamRosterSnapshot } from "./collaboration.js";

const TeamListMembersInputSchema = Type.Object({}, { additionalProperties: false });
export type TeamListMembersInput = Static<typeof TeamListMembersInputSchema>;

export interface TeamRosterPort {
	listMembers(input: { readonly sourceRuntimeSessionId: string }): Promise<TeamRosterSnapshot>;
}

export function createTeamListMembersTool(port: TeamRosterPort): RuntimeToolDefinition<TeamListMembersInput> {
	return {
		name: "team_list_members",
		label: "team_list_members",
		description:
			"List the persistent members of this Agent Team, including the leader, responsibilities, availability, and currently effective capabilities. Subagents are temporary private helpers and never appear here.",
		inputSchema: TeamListMembersInputSchema,
		async execute({ sessionId }) {
			const roster = await port.listMembers({ sourceRuntimeSessionId: sessionId });
			return { content: [{ type: "text", text: JSON.stringify(roster) }], details: roster };
		},
	};
}
export const TeamDelegateInputSchema = Type.Object(
	{
		target: Type.String({ minLength: 1, description: "Team member handle, without @." }),
		objective: Type.String({ minLength: 1, maxLength: 16_000, description: "Focused work to hand off." }),
	},
	{ additionalProperties: false },
);
export type TeamDelegateInput = Static<typeof TeamDelegateInputSchema>;
export interface TeamDelegationResult {
	readonly memberId: string;
	readonly memberHandle: string;
	readonly summary: string;
	readonly state: "completed" | "waiting" | "attention-required";
}
export interface TeamDelegationPort {
	delegate(input: {
		readonly sourceRuntimeSessionId: string;
		readonly sourceTurnId: string;
		readonly targetHandle: string;
		readonly objective: string;
		readonly signal: AbortSignal;
	}): Promise<TeamDelegationResult>;
}
export function createTeamDelegateTool(port: TeamDelegationPort): RuntimeToolDefinition<TeamDelegateInput> {
	return {
		name: "team_delegate",
		label: "team_delegate",
		description:
			"Delegate a focused task to another persistent member of this Agent Team and wait for that member's public result. Use a handle from team_list_members. Never use this for a subagent: subagents are temporary private helpers, not Team members.",
		inputSchema: TeamDelegateInputSchema,
		async execute({ sessionId, turnId, input, signal }) {
			const result = await port.delegate({
				sourceRuntimeSessionId: sessionId,
				sourceTurnId: turnId,
				targetHandle: input.target,
				objective: input.objective,
				signal,
			});
			const text =
				result.state === "completed"
					? result.summary
					: `The persistent Team work item is ${result.state}; no final member message is available yet.`;
			return { content: [{ type: "text", text }], details: result };
		},
	};
}
