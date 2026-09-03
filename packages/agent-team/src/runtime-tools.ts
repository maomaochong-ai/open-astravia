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
