import type { TeamSessionDocument } from "@vetta/agent-team";
import { createAssistantMessage } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import { projectTeamConversationDisplay } from "./team-conversation-display.js";

describe("projectTeamConversationDisplay", () => {
	it("loads every member's native Conversation history as one display source", async () => {
		const session = {
			id: "team-session",
			executionMode: "full-access",
			memberRuntime: {
				leader: { sessionId: "runtime-leader", sessionPath: "C:/sessions/leader.jsonl" },
				reviewer: { sessionId: "runtime-reviewer", sessionPath: "C:/sessions/reviewer.jsonl" },
			},
		} as unknown as TeamSessionDocument;
		const readHistory = vi.fn(async (runtimeSessionId: string) => [
			{
				type: "message" as const,
				entryId: `${runtimeSessionId}-message`,
				message: {
					...createAssistantMessage(
						{ api: "openai-responses", provider: "test", model: "fixture" },
						{ timestamp: 1 },
					),
					content: [{ type: "text" as const, text: runtimeSessionId }],
				},
			},
		]);

		const display = await projectTeamConversationDisplay({ session, readHistory });

		expect(display.memberConversations.map((item) => item.memberId)).toEqual(["leader", "reviewer"]);
		expect(readHistory).toHaveBeenCalledTimes(2);
		expect(display.memberConversations[0]?.history[0]).toMatchObject({ type: "message" });
	});
});
