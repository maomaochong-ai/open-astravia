import { describe, expect, it, vi } from "vitest";
import { createTeamDelegateTool, createTeamListMembersTool } from "../src/runtime-tools.js";

describe("team delegate runtime tool", () => {
	it("lists only the roster returned by the persistent Team port", async () => {
		const roster = {
			teamId: "team",
			teamName: "Team",
			teamRevision: 1,
			leaderParticipantId: "leader",
			members: [],
		};
		const listMembers = vi.fn().mockResolvedValue(roster);
		const tool = createTeamListMembersTool({ listMembers });

		const result = await tool.execute({
			sessionId: "leader-runtime",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: {},
			signal: new AbortController().signal,
		});

		expect(listMembers).toHaveBeenCalledWith({ sourceRuntimeSessionId: "leader-runtime" });
		expect(result.details).toEqual(roster);
		expect(tool.description).toContain("Subagents");
	});

	it("passes the runtime turn identity to the delegation port", async () => {
		const delegate = vi.fn().mockResolvedValue({
			memberId: "builder-1",
			memberHandle: "builder",
			summary: "Implemented the change",
			state: "completed",
		});
		const tool = createTeamDelegateTool({ delegate });

		const result = await tool.execute({
			sessionId: "leader-runtime",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: { target: "builder", objective: "Implement the change" },
			signal: new AbortController().signal,
		});

		expect(delegate).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceRuntimeSessionId: "leader-runtime",
				sourceTurnId: "turn-1",
				targetHandle: "builder",
				objective: "Implement the change",
			}),
		);
		expect(result.content).toEqual([{ type: "text", text: "Implemented the change" }]);
		expect(tool.description).toContain("Never use this for a subagent");
	});
});
