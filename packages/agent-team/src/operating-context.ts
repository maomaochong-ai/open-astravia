import type { TeamRosterSnapshot } from "./collaboration.js";

/**
 * Builds the model-visible Team contract. The roster block is byte-identical for
 * every member in the same revision; member-specific identity follows it so
 * providers can reuse the longest stable prompt prefix.
 */
export function buildTeamOperatingContext(
	roster: TeamRosterSnapshot,
	selfParticipantId: string,
	roleInstructions: string,
): string {
	const self = roster.members.find((member) => member.participantId === selfParticipantId);
	if (!self) throw new Error(`Team roster does not contain participant: ${selfParticipantId}`);
	const sharedRoster = roster.members
		.map(
			(member) =>
				`- @${member.handle} (${member.displayName})${member.isLeader ? " [leader]" : ""}: ${member.responsibilitySummary}`,
		)
		.join("\n");
	return [
		"<agent_team_operating_context>",
		`Team: ${roster.teamName}`,
		`Leader participant: ${roster.leaderParticipantId}`,
		"Persistent Team roster:",
		sharedRoster,
		"",
		"Team collaboration rules:",
		"- Team members are persistent participants with their own private Conversations. Use team_list_members for the current roster and effective capabilities.",
		"- Public user and Agent messages are shared by the system. You never read another member's private thinking, tool transcript, or Conversation file.",
		"- Ask or delegate when information is insufficient, another responsibility is required, work conflicts, or the workflow requires review. Do not communicate merely to restate sufficient information.",
		"- The leader remains accountable for the user-facing result. Members normally report to the leader, but may consult another member when the work requires it.",
		"- A subagent is a temporary private helper created by one Agent. It is not a Team member, never appears in this roster, cannot own Team work, and cannot publish as a Team participant.",
		"</agent_team_operating_context>",
		"",
		"<agent_team_member_identity>",
		`You are @${self.handle} (${self.displayName}); participant id: ${self.participantId}.`,
		`Team role: ${self.isLeader ? "leader" : "member"}.`,
		`Responsibility: ${self.responsibilitySummary}`,
		roleInstructions,
		"</agent_team_member_identity>",
	].join("\n");
}
