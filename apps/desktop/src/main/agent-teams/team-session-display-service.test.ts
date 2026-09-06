import { createAssistantMessage } from "@vetta/ai";
import type { ConversationDocument } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { projectTeamPublicMessages } from "./team-session-display-service.js";

describe("projectTeamPublicMessages", () => {
	it("hides member-routed Agent messages while keeping the user request and public answer", () => {
		const document = {
			revision: 4,
			activeLeafId: "public-answer",
			entries: [
				{
					type: "message",
					kind: "user",
					id: "user-request",
					turnId: "request",
					author: { kind: "user", id: "local-user" },
					message: { role: "user", content: "Ask the Team", timestamp: 1 },
				},
				{
					type: "message",
					kind: "agent",
					id: "internal-instruction",
					turnId: "leader-runtime-turn",
					author: { kind: "agent", id: "leader" },
					message: {
						...createAssistantMessage({ api: "test", provider: "test", model: "fixture" }, { timestamp: 2 }),
						content: [{ type: "text", text: "Please reply" }],
					},
				},
				{
					type: "custom",
					customType: "agent-team.message-routing.v1",
					data: {
						customType: "agent-team.message-routing.v1",
						messageEntryId: "internal-instruction",
						addressedParticipantIds: ["researcher", "builder", "reviewer"],
					},
				},
				{
					type: "message",
					kind: "agent",
					id: "public-answer",
					turnId: "request",
					author: { kind: "agent", id: "leader" },
					message: {
						...createAssistantMessage({ api: "test", provider: "test", model: "fixture" }, { timestamp: 3 }),
						content: [{ type: "text", text: "Everyone replied" }],
					},
				},
			],
		} as unknown as ConversationDocument;

		expect(projectTeamPublicMessages(document).map((message) => message.id)).toEqual([
			"user-request",
			"public-answer",
		]);
	});
});
