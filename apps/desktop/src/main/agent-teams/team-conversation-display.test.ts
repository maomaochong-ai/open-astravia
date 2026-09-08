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

	it("projects context usage for every member while retaining the legacy primary usage", async () => {
		const session = {
			id: "team-session",
			executionMode: "full-access",
			memberRuntime: {
				leader: { sessionId: "runtime-leader", sessionPath: "C:/sessions/leader.jsonl" },
				reviewer: { sessionId: "runtime-reviewer", sessionPath: "C:/sessions/reviewer.jsonl" },
			},
		} as unknown as TeamSessionDocument;

		const display = await projectTeamConversationDisplay({
			session,
			readHistory: async () => [],
			runtimeStates: [
				{
					memberId: "leader",
					runtimeSessionId: "runtime-leader",
					executionMode: "full-access",
					contextPercent: 25,
					contextTokens: 25_000,
					contextWindow: 100_000,
				},
				{
					memberId: "reviewer",
					runtimeSessionId: "runtime-reviewer",
					executionMode: "full-access",
					contextPercent: 50,
					contextWindow: 200_000,
				},
			],
		});

		expect(display.contextUsages).toEqual([
			{
				memberId: "leader",
				runtimeSessionId: "runtime-leader",
				percent: 25,
				contextTokens: 25_000,
				contextWindow: 100_000,
			},
			{
				memberId: "reviewer",
				runtimeSessionId: "runtime-reviewer",
				percent: 50,
				contextWindow: 200_000,
			},
		]);
		expect(display.contextUsage).toEqual(display.contextUsages?.[0]);
	});

	it("projects only queued and running work as durable member activity", async () => {
		const session = {
			id: "team-session",
			memberRuntime: {},
		} as unknown as TeamSessionDocument;
		const workItem = (id: string, assignedToParticipantId: string, state: string) => ({
			id,
			requestTurnId: "request",
			createdByParticipantId: "local-user",
			assignedToParticipantId,
			objective: id,
			contextEntryIds: [],
			state,
			createdAt: 1,
			updatedAt: 1,
			revision: 1,
		});

		const display = await projectTeamConversationDisplay({
			session,
			readHistory: async () => [],
			workItems: [
				workItem("queued", "leader", "queued"),
				workItem("running", "reviewer", "running"),
				workItem("waiting", "architect", "waiting"),
				workItem("completed", "executor", "completed"),
			] as never,
		});

		expect(display.workingMemberIds).toEqual(["leader", "reviewer"]);
	});

	it("copies only publication-linked tool evidence onto the public message", async () => {
		const session = {
			id: "team-session",
			memberRuntime: {
				reviewer: { sessionId: "runtime-reviewer", sessionPath: "C:/sessions/reviewer.jsonl" },
			},
		} as unknown as TeamSessionDocument;
		const assistant = createAssistantMessage(
			{ api: "openai-responses", provider: "test", model: "fixture" },
			{ timestamp: 1 },
		);
		const display = await projectTeamConversationDisplay({
			session,
			readHistory: async () => [
				{ type: "message", entryId: "prompt", message: { role: "user", content: "Review", timestamp: 1 } },
				{
					type: "message",
					entryId: "tool-call",
					message: {
						...assistant,
						content: [{ type: "toolCall", id: "read-call", name: "read", arguments: { path: "brief.md" } }],
					},
				},
				{
					type: "message",
					entryId: "tool-result",
					message: {
						role: "toolResult",
						toolCallId: "read-call",
						toolName: "read",
						content: [{ type: "text", text: "contents" }],
						isError: false,
						timestamp: 2,
					},
				},
				{
					type: "message",
					entryId: "private-final",
					message: { ...assistant, content: [{ type: "text", text: "Done" }] },
				},
			],
			publications: [
				{
					customType: "agent-team.publication-operation.v1",
					operationId: "publication",
					workItemId: "work-item",
					sourceParticipantConversationId: "runtime-reviewer",
					sourceTurnId: "reviewer-turn",
					sourceMessageEntryId: "private-final",
					publicMessageEntryId: "public-result",
					state: "completed",
					generation: 1,
				},
			],
		});

		expect(display.toolExecutions).toEqual([
			expect.objectContaining({
				messageId: "public-result",
				toolCallId: "read-call",
				result: { content: [{ type: "text", text: "contents" }], details: undefined, isError: false },
			}),
		]);
	});
});
