import { createAssistantMessage } from "@vetta/ai";
import type { HistoryEntry } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { collectPublishedToolExecutions } from "./team-conversation-display.js";
import { findTeamAttemptResult } from "./team-member-result.js";

const assistant = createAssistantMessage(
	{ api: "openai-responses", provider: "openai", model: "model" },
	{ timestamp: 1 },
);

describe("Team attempt result identity", () => {
	it("finds the new durable response after private context compaction", () => {
		const history: HistoryEntry[] = [
			{ type: "message", entryId: "old", message: assistant },
			{ type: "compaction", entryId: "compacted", summary: "Earlier history", tokensBefore: 100, timestamp: "1" },
			{ type: "message", entryId: "new", message: { ...assistant, content: [{ type: "text", text: "Done" }] } },
			{ type: "custom_marker", customType: "turn-end", timestamp: "2" },
		];
		expect(findTeamAttemptResult(history, new Set(["old", "discarded-from-model-context"]))).toMatchObject({
			entryId: "new",
			message: { content: [{ type: "text", text: "Done" }] },
		});
	});

	it("does not republish historical or unpersisted assistant responses", () => {
		expect(
			findTeamAttemptResult(
				[
					{ type: "message", entryId: "old", message: assistant },
					{ type: "message", message: assistant },
				],
				new Set(["old"]),
			),
		).toBeUndefined();
	});

	it("preserves the last error envelope instead of selecting earlier successful-looking text", () => {
		const error = { ...assistant, stopReason: "error" as const };
		expect(
			findTeamAttemptResult(
				[
					{ type: "message", entryId: "intermediate", message: assistant },
					{ type: "message", entryId: "terminal", message: error },
				],
				new Set(),
			),
		).toEqual({ entryId: "terminal", message: error });
	});

	it("collects raw tool results for the renderer while keeping the public message filtered", () => {
		const history: HistoryEntry[] = [
			{ type: "message", entryId: "prompt", message: { role: "user", content: "Read", timestamp: 1 } },
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
					content: [{ type: "text", text: "file contents" }],
					isError: false,
					timestamp: 2,
				},
			},
			{ type: "message", entryId: "final", message: { ...assistant, content: [{ type: "text", text: "Done" }] } },
		];
		expect(collectPublishedToolExecutions(history, "final", "public-final")).toMatchObject([
			{
				messageId: "public-final",
				toolCallId: "read-call",
				toolName: "read",
				args: { path: "brief.md" },
				result: { content: [{ type: "text", text: "file contents" }] },
				isError: false,
			},
		]);
	});
});
