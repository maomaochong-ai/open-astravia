import { describe, expect, it } from "vitest";
import {
	parseCreateAgentProfileInput,
	parseCreateTeamInput,
	parseDeleteAgentProfileInput,
	parseDeleteTeamInput,
	parseSendTeamMessageInput,
	parseTeamSessionDocument,
	parseUpdateAgentProfileInput,
	parseUpdateTeamInput,
} from "../src/validation.js";

describe("Agent Team IPC input validation", () => {
	it("accepts complete profile and team inputs", () => {
		expect(
			parseCreateAgentProfileInput({
				name: "Researcher",
				mentionHandle: "researcher",
				blueprintId: "researcher",
				abilities: { skills: ["search"] },
			}),
		).toMatchObject({ name: "Researcher", mentionHandle: "researcher" });
		expect(
			parseCreateTeamInput({
				name: "Product team",
				members: [
					{
						agentProfileId: "agent-1",
						handle: "leader",
						bindingKind: "reference",
						leader: true,
					},
				],
			}),
		).toMatchObject({ name: "Product team" });
	});

	it("rejects unknown properties and invalid revisions", () => {
		expect(() =>
			parseUpdateAgentProfileInput({
				expectedRevision: 0,
				name: "Agent",
				description: "",
				mentionHandle: "agent",
				abilities: { skills: [], mcpServers: [], plugins: [] },
			}),
		).toThrow("Invalid update agent profile input");
		expect(() =>
			parseSendTeamMessageInput({
				requestId: "request-1",
				text: "Hello",
				targetMemberIds: [],
				privateTrace: true,
			}),
		).toThrow("Invalid send team message input");
	});

	it("accepts structured attachments and rejects an empty team request", () => {
		expect(
			parseSendTeamMessageInput({
				requestId: "request-attachments",
				text: "",
				targetMemberIds: [],
				attachments: [{ kind: "file", path: "C:/workspace/notes.txt" }],
			}),
		).toMatchObject({ attachments: [{ kind: "file", path: "C:/workspace/notes.txt" }] });
		expect(() =>
			parseSendTeamMessageInput({
				requestId: "request-empty",
				text: " ",
				targetMemberIds: [],
			}),
		).toThrow("Invalid send team message input");
	});

	it("validates reviewed cascade deletion and atomic team roster updates", () => {
		expect(
			parseDeleteAgentProfileInput({
				expectedRevision: 2,
				expectedTeamIds: ["team-1", "team-2"],
				expectedTeamRevisions: { "team-1": 3, "team-2": 4 },
			}),
		).toEqual({
			expectedRevision: 2,
			expectedTeamIds: ["team-1", "team-2"],
			expectedTeamRevisions: { "team-1": 3, "team-2": 4 },
		});
		expect(parseDeleteTeamInput({ expectedRevision: 3 })).toEqual({ expectedRevision: 3 });
		expect(
			parseUpdateTeamInput({
				expectedRevision: 3,
				name: "Delivery",
				description: "",
				members: [
					{ kind: "existing", memberId: "member-1", leader: false },
					{ kind: "new", agentProfileId: "agent-2", bindingKind: "copy", leader: true },
				],
			}),
		).toMatchObject({ name: "Delivery", members: [{ kind: "existing" }, { kind: "new" }] });
		expect(() =>
			parseUpdateTeamInput({
				expectedRevision: 3,
				name: "Delivery",
				description: "",
				members: [],
			}),
		).toThrow("Invalid update team input");
	});

	it("rejects sessions whose runtime roster or events reference unknown members", () => {
		const session = {
			schemaVersion: 1,
			revision: 0,
			id: "session",
			teamId: "team",
			name: "Team",
			cwd: "C:/workspace",
			leaderMemberId: "leader",
			memberHandles: { leader: "leader" },
			createdAt: 1,
			updatedAt: 1,
			events: [],
			memberRuntime: {
				leader: {
					sessionId: "runtime",
					sessionPath: "C:/sessions/runtime.jsonl",
					agentProfileRevision: 1,
					deliveredEventIds: [],
				},
			},
		};
		expect(parseTeamSessionDocument(session)).toMatchObject({ id: "session" });
		expect(
			parseTeamSessionDocument({
				...session,
				activeMemberIds: ["leader"],
				memberHandles: { leader: "agent", "removed-member": "agent" },
			}),
		).toMatchObject({ id: "session" });
		expect(() =>
			parseTeamSessionDocument({
				...session,
				events: [
					{
						type: "member-result",
						id: "result",
						requestId: "request",
						memberId: "missing",
						sourceTurnId: "turn",
						text: "result",
						timestamp: 2,
					},
				],
			}),
		).toThrow("unknown member");
	});
});
